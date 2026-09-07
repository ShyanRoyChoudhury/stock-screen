from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.market_calendar import now_ist
from app.models import TIMEFRAMES, IngestRun, Signal, Symbol
from app.schemas import IngestRunOut
from app.signals.core import STRATEGY_FUNCS
from app.signals.service import run_signals

router = APIRouter(prefix="/signals", tags=["signals"])


class SignalRunRequest(BaseModel):
    timeframes: list[str] | None = None  # default: all
    symbols: list[str] | None = None  # default: full active universe
    strategies: list[str] | None = None  # default: all


def _signal_out(s: Signal, symbol: str) -> dict:
    return {
        "symbol": symbol,
        "strategy": s.strategy,
        "timeframe": s.timeframe,
        "ts": s.ts,
        "entry_mode": s.entry_mode,
        "entry": s.entry,
        "stop_loss": s.stop_loss,
        "target_1": s.target_1,
        "target_2": s.target_2,
        "risk_pct": s.risk_pct,
        "rr_ratio": s.rr_ratio,
        "details": s.details,
    }


@router.post("/run", response_model=IngestRunOut, status_code=202)
def start_signal_run(
    req: SignalRunRequest,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
):
    if req.timeframes:
        bad = [tf for tf in req.timeframes if tf not in TIMEFRAMES]
        if bad:
            raise HTTPException(422, f"timeframes must be a subset of {TIMEFRAMES}")
    if req.strategies:
        bad = [s for s in req.strategies if s not in STRATEGY_FUNCS]
        if bad:
            raise HTTPException(
                422, f"unknown strategies {bad}; valid: {list(STRATEGY_FUNCS)}"
            )

    running = session.scalar(
        select(IngestRun).where(IngestRun.status == "running").limit(1)
    )
    if running:
        raise HTTPException(409, f"Run {running.id} is already in progress")

    run = IngestRun(mode="signals", timeframes=req.timeframes or list(TIMEFRAMES))
    session.add(run)
    session.commit()

    background.add_task(run_signals, run.id, req.timeframes, req.symbols,
                        req.strategies)
    return run


@router.get("")
def list_signals(
    symbol: str | None = None,
    strategy: str | None = None,
    timeframe: str | None = Query(None, pattern="^(1h|4h|1d)$"),
    since: datetime | None = None,
    limit: int = Query(200, le=5000),
    session: Session = Depends(get_session),
):
    stmt = (
        select(Signal, Symbol.symbol)
        .join(Symbol, Symbol.id == Signal.symbol_id)
        .order_by(Signal.ts.desc())
        .limit(limit)
    )
    if symbol:
        stmt = stmt.where(Symbol.symbol == symbol.upper())
    if strategy:
        stmt = stmt.where(Signal.strategy == strategy)
    if timeframe:
        stmt = stmt.where(Signal.timeframe == timeframe)
    if since:
        stmt = stmt.where(Signal.ts >= since)

    return [_signal_out(s, name) for s, name in session.execute(stmt)]


@router.get("/fresh")
def fresh_signals(
    days: int = Query(3, ge=1, le=30),
    strategy: str | None = None,
    timeframe: str | None = Query(None, pattern="^(1h|4h|1d)$"),
    session: Session = Depends(get_session),
):
    """Signals within the last `days` days — the scanner's freshness view."""
    since = now_ist() - timedelta(days=days)
    stmt = (
        select(Signal, Symbol.symbol)
        .join(Symbol, Symbol.id == Signal.symbol_id)
        .where(Signal.ts >= since)
        .order_by(Signal.ts.desc())
    )
    if strategy:
        stmt = stmt.where(Signal.strategy == strategy)
    if timeframe:
        stmt = stmt.where(Signal.timeframe == timeframe)

    return [_signal_out(s, name) for s, name in session.execute(stmt)]
