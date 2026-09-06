from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.indicators.service import run_compute
from app.models import TIMEFRAMES, IndicatorValue, IngestRun, Symbol
from app.schemas import IngestRunOut

router = APIRouter(prefix="/indicators", tags=["indicators"])


class ComputeRequest(BaseModel):
    timeframes: list[str] | None = None  # default: all
    symbols: list[str] | None = None  # default: full active universe


@router.post("/run", response_model=IngestRunOut, status_code=202)
def start_compute(
    req: ComputeRequest,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
):
    if req.timeframes:
        bad = [tf for tf in req.timeframes if tf not in TIMEFRAMES]
        if bad:
            raise HTTPException(422, f"timeframes must be a subset of {TIMEFRAMES}")

    running = session.scalar(
        select(IngestRun).where(IngestRun.status == "running").limit(1)
    )
    if running:
        raise HTTPException(409, f"Run {running.id} is already in progress")

    run = IngestRun(mode="indicators", timeframes=req.timeframes or list(TIMEFRAMES))
    session.add(run)
    session.commit()

    background.add_task(run_compute, run.id, req.timeframes, req.symbols)
    return run


@router.get("/{symbol}")
def get_indicators(
    symbol: str,
    timeframe: str = Query("1d", pattern="^(1h|4h|1d)$"),
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(500, le=10000),
    session: Session = Depends(get_session),
):
    sym = session.scalar(select(Symbol).where(Symbol.symbol == symbol.upper()))
    if sym is None:
        raise HTTPException(404, f"Unknown symbol {symbol!r}")

    stmt = (
        select(IndicatorValue)
        .where(IndicatorValue.symbol_id == sym.id,
               IndicatorValue.timeframe == timeframe)
        .order_by(IndicatorValue.ts.desc())
        .limit(limit)
    )
    if start:
        stmt = stmt.where(IndicatorValue.ts >= start)
    if end:
        stmt = stmt.where(IndicatorValue.ts <= end)

    rows = list(session.scalars(stmt))
    rows.reverse()
    return [
        {c.name: getattr(r, c.name) for c in IndicatorValue.__table__.columns
         if c.name not in ("id", "symbol_id")}
        for r in rows
    ]
