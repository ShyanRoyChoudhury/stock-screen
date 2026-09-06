"""Ingestion orchestration: fetch → resample → upsert, with run bookkeeping.

Designed to be called from a FastAPI background task now and a daily cron
later. Idempotent: candles are upserted on (symbol, timeframe, ts), so
re-runs and source revisions are safe.
"""

import logging
import time
from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.ingest.fetcher import fetch_ohlcv
from app.ingest.resample import resample_1h_to_4h
from app.market_calendar import IST, is_trading_day, now_ist
from app.models import Candle, IngestRun, Symbol

logger = logging.getLogger(__name__)

UPSERT_CHUNK = 5000
SESSION_OPEN_OFFSET = timedelta(hours=9, minutes=15)


def upsert_candles(
    session: Session, symbol_id: int, timeframe: str, df: pd.DataFrame
) -> int:
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
            "source": "yfinance",
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
                for c in ("open", "high", "low", "close", "volume", "source")
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

        want_1h = "1h" in timeframes
        want_4h = "4h" in timeframes
        want_1d = "1d" in timeframes
        need_hourly = want_1h or want_4h

        syms = _resolve_symbols(session, symbols)
        run.symbols_total = len(syms)
        session.commit()

        for sym in syms:
            wrote = 0
            try:
                if need_hourly:
                    start = (
                        _incremental_start(session, sym.id, "1h")
                        if mode == "incremental"
                        else None
                    )
                    if start is None:
                        start = (
                            now_ist().date()
                            - timedelta(days=settings.hourly_backfill_days)
                        )
                    hourly = fetch_ohlcv(sym.symbol, "60m", start=start)
                    if want_1h:
                        wrote += upsert_candles(session, sym.id, "1h", hourly)
                    if want_4h:
                        four_h = resample_1h_to_4h(hourly)
                        wrote += upsert_candles(session, sym.id, "4h", four_h)

                if want_1d:
                    start = (
                        _incremental_start(session, sym.id, "1d")
                        if mode == "incremental"
                        else None
                    )
                    daily = fetch_ohlcv(
                        sym.symbol,
                        "1d",
                        period=None if start else settings.daily_backfill_period,
                        start=start,
                    )
                    # Daily candle ts = session open (09:15 IST), matching the
                    # "ts is candle start" convention of the other timeframes.
                    daily.index = daily.index.normalize() + SESSION_OPEN_OFFSET
                    wrote += upsert_candles(session, sym.id, "1d", daily)

                run.symbols_ok += 1
                run.candles_written += wrote
            except Exception as e:
                logger.exception("Ingest failed for %s", sym.symbol)
                run.symbols_failed += 1
                run.errors = run.errors + [{"symbol": sym.symbol, "error": str(e)}]
            session.commit()
            time.sleep(settings.fetch_delay_seconds)

        run.status = "completed"
        run.message = (
            f"{run.symbols_ok}/{run.symbols_total} symbols ok, "
            f"{run.candles_written} candles written"
        )
    except Exception as e:
        logger.exception("Ingest run %s crashed", run_id)
        run.status = "failed"
        run.message = str(e)
    finally:
        run.finished_at = now_ist()
        session.commit()
        session.close()
