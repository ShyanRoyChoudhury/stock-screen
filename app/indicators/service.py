"""Compute indicators for stored candles and persist them.

Full recompute per (symbol, timeframe) on every run: the EWM-based
indicators (ATR, EMA, MACD, ADX, Supertrend, TTM momentum) depend on the
whole history, so incremental tail updates would drift from the spec.
A full run over 500 symbols x 3 timeframes is minutes, not hours.
"""

import logging
import math

import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.indicators import core
from app.market_calendar import now_ist
from app.models import TIMEFRAMES, Candle, IndicatorValue, IngestRun, Symbol

logger = logging.getLogger(__name__)

UPSERT_CHUNK = 2000

INDICATOR_COLUMNS = [
    "atr_10", "supertrend_10_3", "supertrend_dir",
    "macd_12_26", "macd_signal_9", "macd_hist",
    "ema_50", "ema_200", "adx_14",
    "bb_upper_20_2", "bb_middle_20_2", "bb_lower_20_2", "bb_bandwidth",
    "volume_ma_20",
    "kc_upper_20_15", "kc_middle_20", "kc_lower_20_15",
    "ttm_squeeze_on", "ttm_squeeze_off", "ttm_momentum",
    "rvol_20",
]


def compute_indicator_frame(df: pd.DataFrame) -> pd.DataFrame:
    """df: OHLCV with DatetimeIndex, oldest first. Returns a frame indexed
    like df with one column per stored indicator (gist default params)."""
    out = pd.DataFrame(index=df.index)

    out["atr_10"] = core.calc_atr(df)
    st_line, st_dir = core.calc_supertrend(df)
    out["supertrend_10_3"] = st_line
    out["supertrend_dir"] = st_dir
    macd, signal, hist = core.calc_macd(df)
    out["macd_12_26"] = macd
    out["macd_signal_9"] = signal
    out["macd_hist"] = hist
    out["ema_50"] = core.calc_ema(df["close"], 50)
    out["ema_200"] = core.calc_ema(df["close"], 200)
    out["adx_14"] = core.calc_adx(df)
    bb_u, bb_m, bb_l, bb_bw = core.calc_bollinger(df)
    out["bb_upper_20_2"] = bb_u
    out["bb_middle_20_2"] = bb_m
    out["bb_lower_20_2"] = bb_l
    out["bb_bandwidth"] = bb_bw
    out["volume_ma_20"] = core.calc_volume_ma(df)
    kc_u, kc_m, kc_l = core.calc_keltner_channels(df)
    out["kc_upper_20_15"] = kc_u
    out["kc_middle_20"] = kc_m
    out["kc_lower_20_15"] = kc_l
    sq_on, sq_off, momentum = core.calc_ttm_squeeze(df)
    out["ttm_squeeze_on"] = sq_on
    out["ttm_squeeze_off"] = sq_off
    out["ttm_momentum"] = momentum
    out["rvol_20"] = core.calc_rvol(df)

    return out


def _clean(v):
    """NaN/inf -> None for DB storage."""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def load_candles(session: Session, symbol_id: int, timeframe: str) -> pd.DataFrame:
    rows = session.execute(
        select(Candle.ts, Candle.open, Candle.high, Candle.low,
               Candle.close, Candle.volume)
        .where(Candle.symbol_id == symbol_id, Candle.timeframe == timeframe)
        .order_by(Candle.ts)
    ).all()
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    if df.empty:
        return df
    df["volume"] = df["volume"].astype(float)
    return df.set_index("ts")


def upsert_indicators(session: Session, symbol_id: int, timeframe: str,
                      values: pd.DataFrame) -> int:
    if values.empty:
        return 0
    rows = []
    for ts, r in values.iterrows():
        row = {"symbol_id": symbol_id, "timeframe": timeframe, "ts": ts}
        for col in INDICATOR_COLUMNS:
            v = _clean(r[col])
            if col == "supertrend_dir" and v is not None:
                v = int(v)
            elif col in ("ttm_squeeze_on", "ttm_squeeze_off") and v is not None:
                v = bool(v)
            row[col] = v
        rows.append(row)

    for i in range(0, len(rows), UPSERT_CHUNK):
        chunk = rows[i : i + UPSERT_CHUNK]
        stmt = pg_insert(IndicatorValue).values(chunk)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_indicator",
            set_={c: stmt.excluded[c] for c in INDICATOR_COLUMNS},
        )
        session.execute(stmt)
    return len(rows)


def run_compute(run_id: int, timeframes: list[str] | None,
                symbols: list[str] | None) -> None:
    """Executed in a background thread; opens its own DB session."""
    session = SessionLocal()
    run = session.get(IngestRun, run_id)
    try:
        tfs = timeframes or list(TIMEFRAMES)
        stmt = select(Symbol).where(Symbol.active.is_(True)).order_by(Symbol.symbol)
        if symbols:
            stmt = select(Symbol).where(Symbol.symbol.in_(symbols)).order_by(Symbol.symbol)
        syms = list(session.scalars(stmt))
        run.symbols_total = len(syms)
        session.commit()

        for sym in syms:
            wrote = 0
            try:
                for tf in tfs:
                    df = load_candles(session, sym.id, tf)
                    if df.empty:
                        continue
                    values = compute_indicator_frame(df)
                    wrote += upsert_indicators(session, sym.id, tf, values)
                run.symbols_ok += 1
                run.candles_written += wrote
            except Exception as e:
                logger.exception("Indicator compute failed for %s", sym.symbol)
                run.symbols_failed += 1
                run.errors = run.errors + [{"symbol": sym.symbol, "error": str(e)}]
            session.commit()

        run.status = "completed"
        run.message = (
            f"{run.symbols_ok}/{run.symbols_total} symbols ok, "
            f"{run.candles_written} indicator rows written"
        )
    except Exception as e:
        logger.exception("Indicator run %s crashed", run_id)
        run.status = "failed"
        run.message = str(e)
    finally:
        run.finished_at = now_ist()
        session.commit()
        session.close()
