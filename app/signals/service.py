"""Signal computation runs: load candles -> run strategies -> store signals.

Regeneration semantics: for each (symbol, timeframe, strategy) in the run,
existing signals are deleted and re-inserted in one transaction — data
revisions can therefore never leave stale signals behind.
"""

import logging
import math

import numpy as np
import pandas as pd
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.indicators.service import load_candles
from app.market_calendar import now_ist
from app.models import TIMEFRAMES, IngestRun, Signal, Symbol
from app.signals.core import STRATEGY_FUNCS

logger = logging.getLogger(__name__)

COMMON_FIELDS = ("entry", "stop_loss", "target_1", "target_2",
                 "risk_pct", "rr_ratio", "entry_mode")


def _jsonable(v):
    """Make gist-emitted values JSONB-safe (numpy types, NaN, nested dicts)."""
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        v = float(v)
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def signal_to_row(sig: dict, symbol_id: int, timeframe: str) -> dict:
    details = {k: _jsonable(v) for k, v in sig.items()
               if k not in COMMON_FIELDS + ("symbol", "date", "strategy")}
    return {
        "symbol_id": symbol_id,
        "timeframe": timeframe,
        "strategy": sig["strategy"],
        "ts": pd.Timestamp(sig["date"]).to_pydatetime(),
        "entry_mode": sig.get("entry_mode"),
        "entry": _jsonable(sig["entry"]),
        "stop_loss": _jsonable(sig["stop_loss"]),
        "target_1": _jsonable(sig["target_1"]),
        "target_2": _jsonable(sig["target_2"]),
        "risk_pct": _jsonable(sig.get("risk_pct")),
        "rr_ratio": _jsonable(sig.get("rr_ratio")),
        "details": details,
    }


def run_signals(run_id: int, timeframes: list[str] | None,
                symbols: list[str] | None,
                strategies: list[str] | None) -> None:
    """Executed in a background thread; opens its own DB session."""
    session = SessionLocal()
    run = session.get(IngestRun, run_id)
    try:
        tfs = timeframes or list(TIMEFRAMES)
        strats = strategies or list(STRATEGY_FUNCS)

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
                    rows = []
                    for name in strats:
                        for sig in STRATEGY_FUNCS[name](df):
                            rows.append(signal_to_row(sig, sym.id, tf))
                    # regenerate atomically per symbol+timeframe
                    session.execute(
                        delete(Signal).where(
                            Signal.symbol_id == sym.id,
                            Signal.timeframe == tf,
                            Signal.strategy.in_(strats),
                        )
                    )
                    if rows:
                        session.bulk_insert_mappings(Signal, rows)
                    wrote += len(rows)
                run.symbols_ok += 1
                run.candles_written += wrote
            except Exception as e:
                session.rollback()
                logger.exception("Signal compute failed for %s", sym.symbol)
                run.symbols_failed += 1
                run.errors = run.errors + [{"symbol": sym.symbol, "error": str(e)}]
            session.commit()

        run.status = "completed"
        run.message = (
            f"{run.symbols_ok}/{run.symbols_total} symbols ok, "
            f"{run.candles_written} signals written"
        )
    except Exception as e:
        logger.exception("Signal run %s crashed", run_id)
        run.status = "failed"
        run.message = str(e)
    finally:
        run.finished_at = now_ist()
        session.commit()
        session.close()
