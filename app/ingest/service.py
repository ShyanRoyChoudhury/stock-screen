"""Ingestion orchestration: fetch → resample → upsert, with run bookkeeping.

Designed to be called from a FastAPI background task now and a daily cron
later. Idempotent: candles are upserted on (symbol, timeframe, ts), so
re-runs and source revisions are safe.
"""

import logging
import re
from datetime import date, datetime, timedelta

import pandas as pd
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.ingest.fyers_fetcher import FyersFetchError, FyersFetcher
from app.ingest.fyers_session import FyersLoginRequired
from app.ingest.resample import resample_1h_to_4h
from app.market_calendar import IST, is_trading_day, now_ist
from app.models import (
    BarCheck, Candle, IndicatorValue, IngestRun, Symbol,
)

logger = logging.getLogger(__name__)

UPSERT_CHUNK = 5000
SESSION_OPEN_OFFSET = timedelta(hours=9, minutes=15)

FYERS_SOURCE = "fyers"
FYERS_BASIS = "fyers_adjusted"
# One tick (Rs 0.05): a stored daily bar differing from a fresh Fyers fetch by
# more than this means Fyers re-adjusted the stock's history.
REDOWNLOAD_TICK = 0.05
MESSAGE_MAX = 512


def period_to_start(period: str, today: date) -> date:
    """Turn a period string ("5y", "6mo", "730d") into a start date."""
    m = re.fullmatch(r"\s*(\d+)\s*(y|mo|d)\s*", period.lower())
    if not m:
        raise ValueError(f"unsupported period {period!r}; use e.g. 5y, 6mo, 730d")
    n, unit = int(m.group(1)), m.group(2)
    if unit == "d":
        return today - timedelta(days=n)
    offset = pd.DateOffset(years=n) if unit == "y" else pd.DateOffset(months=n)
    return (pd.Timestamp(today) - offset).date()


def round_volume(df: pd.DataFrame) -> pd.DataFrame:
    """Fyers returns float volumes (16771221.0); round (not truncate) to int."""
    if df.empty:
        return df
    out = df.copy()
    out["volume"] = out["volume"].fillna(0).round().astype("int64")
    return out


def _bar_dates(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Calendar (IST) dates of an index as tz-naive midnights."""
    if idx.tz is not None:
        idx = idx.tz_convert(IST)
    return idx.normalize().tz_localize(None)


def needs_redownload(
    stored: pd.DataFrame,
    fetched: pd.DataFrame,
    tick: float = REDOWNLOAD_TICK,
    today: date | None = None,
) -> tuple[bool, float]:
    """Compare stored vs freshly fetched DAILY bars on their overlapping dates.

    Returns (True, max_abs_diff) if any of open/high/low/close differs by more
    than `tick`, i.e. Fyers has re-adjusted the history. Bars dated `today` or
    later are ignored (the live session can still change). Daily only: hourly
    closes get patched separately, which would give false positives.
    """
    if stored.empty or fetched.empty:
        return False, 0.0
    cols = ["open", "high", "low", "close"]
    s = stored[cols].astype(float).copy()
    f = fetched[cols].astype(float).copy()
    s.index = _bar_dates(s.index)
    f.index = _bar_dates(f.index)
    s = s[~s.index.duplicated(keep="last")]
    f = f[~f.index.duplicated(keep="last")]
    common = s.index.intersection(f.index)
    if today is not None:
        common = common[common < pd.Timestamp(today)]
    if len(common) == 0:
        return False, 0.0
    max_diff = float((s.loc[common] - f.loc[common]).abs().to_numpy().max())
    return max_diff > tick, max_diff


def upsert_candles(
    session: Session,
    symbol_id: int,
    timeframe: str,
    df: pd.DataFrame,
    source: str = FYERS_SOURCE,
    price_basis: str = FYERS_BASIS,
) -> int:
    """Upsert candles for one (symbol, timeframe).

    `source` and `price_basis` are stored per row so a series can be audited:
    prices from different providers, or on different adjustment conventions,
    are not interchangeable. Both are in the ON CONFLICT set,
    so a re-ingest on a new basis restamps the rows it rewrites — leaving any
    rows it did NOT reach still showing the old basis, which is exactly the
    signal that a partial re-ingest happened."""
    if df.empty:
        return 0
    rows = [
        {
            "symbol_id": symbol_id,
            "timeframe": timeframe,
            "ts": ts.to_pydatetime(),
            "open": float(r.open),
            "high": float(r.high),
            "low": float(r.low),
            "close": float(r.close),
            "volume": int(r.volume) if pd.notna(r.volume) else 0,
            "source": source,
            "price_basis": price_basis,
        }
        for ts, r in df.iterrows()
    ]
    for i in range(0, len(rows), UPSERT_CHUNK):
        chunk = rows[i : i + UPSERT_CHUNK]
        stmt = pg_insert(Candle).values(chunk)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_candle",
            set_={
                c: stmt.excluded[c]
                for c in ("open", "high", "low", "close", "volume",
                          "source", "price_basis")
            },
        )
        session.execute(stmt)
    return len(rows)


def _last_ts(session: Session, symbol_id: int, timeframe: str) -> datetime | None:
    return session.scalar(
        select(func.max(Candle.ts)).where(
            Candle.symbol_id == symbol_id, Candle.timeframe == timeframe
        )
    )


def _incremental_start(session: Session, symbol_id: int, timeframe: str):
    """Date to fetch from: a couple of days before the last stored candle so
    full sessions are re-covered (needed for 4h bins) and revisions heal.
    Returns None when there's no data yet (caller falls back to backfill).
    """
    last = _last_ts(session, symbol_id, timeframe)
    if last is None:
        return None
    return (
        last.astimezone(IST) - timedelta(days=settings.incremental_overlap_days)
    ).date()


def _resolve_symbols(session: Session, requested: list[str] | None) -> list[Symbol]:
    if requested:
        out = []
        for name in requested:
            sym = session.scalar(select(Symbol).where(Symbol.symbol == name))
            if sym is None:
                sym = Symbol(symbol=name, active=True)
                session.add(sym)
                session.flush()
            out.append(sym)
        session.commit()
        return out
    return list(
        session.scalars(
            select(Symbol).where(Symbol.active.is_(True)).order_by(Symbol.symbol)
        )
    )


def _load_stored_daily(session: Session, symbol_id: int, since: date) -> pd.DataFrame:
    """Stored 1d OHLC from `since` on, indexed by ts."""
    rows = session.execute(
        select(Candle.ts, Candle.open, Candle.high, Candle.low, Candle.close)
        .where(
            Candle.symbol_id == symbol_id,
            Candle.timeframe == "1d",
            Candle.ts >= datetime.combine(since, datetime.min.time(), tzinfo=IST),
        )
        .order_by(Candle.ts)
    ).all()
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close"])
    if df.empty:
        return df
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df.set_index("ts")


def _wipe_symbol(session: Session, symbol_id: int) -> None:
    """Delete a symbol's candles (all timeframes) and indicator rows.

    Indicators are dropped so no row survives at a timestamp the rebuilt
    history no longer has; run_compute recomputes them in full anyway."""
    session.execute(delete(Candle).where(Candle.symbol_id == symbol_id))
    session.execute(
        delete(IndicatorValue).where(IndicatorValue.symbol_id == symbol_id)
    )
    # Old bar_checks describe replaced data; stale 'fail' rows re-checked
    # against the raw bhavcopy could never pass after a re-adjustment, which
    # would hold the symbol's signals for the whole lookback.
    session.execute(delete(BarCheck).where(BarCheck.symbol_id == symbol_id))


def rebuild_symbol_history(
    session: Session, sym: Symbol, fetcher: FyersFetcher, today: date,
) -> int:
    """Replace a symbol's whole stored history with a fresh Fyers download:
    full daily (daily_backfill_period) and hourly (hourly_backfill_days), 4h
    built from hourly. Everything is fetched BEFORE anything is wiped, so a
    fetch failure leaves the old data intact. The caller commits (and rolls
    back on error). Returns candles written."""
    daily_start = period_to_start(settings.daily_backfill_period, today)
    hourly_start = today - timedelta(days=settings.hourly_backfill_days)
    full_daily = round_volume(fetcher.fetch_bars(sym.symbol, "1d", daily_start))
    full_hourly = round_volume(fetcher.fetch_bars(sym.symbol, "60m", hourly_start))
    # An empty answer (renamed/delisted symbol, Fyers outage) must not wipe
    # the stored history and replace it with nothing.
    if full_daily.empty or full_hourly.empty:
        raise FyersFetchError(
            f"Fyers returned no {'daily' if full_daily.empty else 'hourly'} "
            f"bars for {sym.symbol}; stored history left untouched")
    full_daily.index = full_daily.index.normalize() + SESSION_OPEN_OFFSET
    _wipe_symbol(session, sym.id)
    wrote = _write_fyers(session, sym.id, full_hourly, True, True)
    wrote += upsert_candles(session, sym.id, "1d", full_daily,
                            FYERS_SOURCE, FYERS_BASIS)
    return wrote


def _ingest_symbol_fyers(
    session: Session,
    sym: Symbol,
    fetcher: FyersFetcher,
    mode: str,
    timeframes: list[str],
    today: date,
) -> tuple[int, float | None]:
    """Fetch + store one symbol from Fyers. Returns (candles_written,
    redownload_max_diff) where the second is None unless the symbol's history
    was found re-adjusted and rebuilt. FyersLoginRequired propagates."""
    want_1h, want_4h, want_1d = "1h" in timeframes, "4h" in timeframes, "1d" in timeframes
    need_hourly = want_1h or want_4h
    daily_full_start = period_to_start(settings.daily_backfill_period, today)
    hourly_full_start = today - timedelta(days=settings.hourly_backfill_days)
    incremental = mode == "incremental"

    daily = None
    if want_1d:
        start = _incremental_start(session, sym.id, "1d") if incremental else None
        daily = round_volume(fetcher.fetch_bars(sym.symbol, "1d", start or daily_full_start))
        if incremental and start is not None:
            stored = _load_stored_daily(session, sym.id, start)
            redo, max_diff = needs_redownload(stored, daily, REDOWNLOAD_TICK, today)
            if redo:
                logger.info(
                    "Fyers re-adjusted %s: stored daily bars differ by up to %.2f "
                    "from a fresh fetch; re-downloading full history",
                    sym.symbol, max_diff,
                )
                wrote = rebuild_symbol_history(session, sym, fetcher, today)
                return wrote, max_diff

    wrote = 0
    if need_hourly:
        start = _incremental_start(session, sym.id, "1h") if incremental else None
        hourly = round_volume(
            fetcher.fetch_bars(sym.symbol, "60m", start or hourly_full_start))
        wrote += _write_fyers(session, sym.id, hourly, want_1h, want_4h)
    if daily is not None:
        daily.index = daily.index.normalize() + SESSION_OPEN_OFFSET
        wrote += upsert_candles(session, sym.id, "1d", daily, FYERS_SOURCE, FYERS_BASIS)
    return wrote, None


def _write_fyers(session, symbol_id, hourly, want_1h, want_4h) -> int:
    wrote = 0
    if want_1h:
        wrote += upsert_candles(session, symbol_id, "1h", hourly,
                                FYERS_SOURCE, FYERS_BASIS)
    if want_4h:
        wrote += upsert_candles(session, symbol_id, "4h", resample_1h_to_4h(hourly),
                                FYERS_SOURCE, FYERS_BASIS)
    return wrote


def run_ingest(
    run_id: int,
    mode: str,
    timeframes: list[str],
    symbols: list[str] | None,
) -> None:
    """Executed in a background thread; opens its own DB session."""
    session = SessionLocal()
    run = session.get(IngestRun, run_id)
    try:
        today = now_ist().date()
        if mode == "incremental" and not is_trading_day(today):
            # Holiday/weekend guard for the future daily cron. An incremental
            # run still proceeds if there could be an unstored prior session,
            # so only short-circuit, never error.
            logger.info("Not a trading day (%s); incremental run continues "
                        "to catch any missed prior session.", today)

        syms = _resolve_symbols(session, symbols)
        run.symbols_total = len(syms)
        session.commit()

        redownloaded: list[str] = []
        login_lost = False
        try:
            fetcher = FyersFetcher.from_session(session)
        except FyersLoginRequired:
            logger.warning("Fyers login needed; ingest run %s not started", run_id)
            run.status = "failed"
            run.message = "Fyers login needed"
            return

        for sym in syms:
            try:
                wrote, redo_diff = _ingest_symbol_fyers(
                    session, sym, fetcher, mode, timeframes, today)
                if redo_diff is not None:
                    redownloaded.append(sym.symbol)
                run.symbols_ok += 1
                run.candles_written += wrote
            except FyersLoginRequired:
                session.rollback()
                login_lost = True
                break
            except Exception as e:
                session.rollback()
                logger.exception("Ingest failed for %s", sym.symbol)
                run.symbols_failed += 1
                run.errors = run.errors + [{"symbol": sym.symbol, "error": str(e)}]
            session.commit()

        done = f"{run.symbols_ok}/{run.symbols_total} symbols ok, " \
               f"{run.candles_written} candles written"
        if redownloaded:
            done += (f"; re-adjusted, re-downloaded {len(redownloaded)}: "
                     + ", ".join(redownloaded))
        if login_lost:
            run.status = "failed"
            run.message = f"Fyers login needed (stopped mid-run; {done}"[:MESSAGE_MAX - 1] + ")"
        else:
            run.status = "completed"
            run.message = done[:MESSAGE_MAX]
    except Exception as e:
        logger.exception("Ingest run %s crashed", run_id)
        run.status = "failed"
        run.message = str(e)
    finally:
        run.finished_at = now_ist()
        session.commit()
        session.close()
