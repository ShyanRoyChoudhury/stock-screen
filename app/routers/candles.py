from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import TIMEFRAMES, Candle, Symbol
from app.schemas import CandleOut

router = APIRouter(prefix="/candles", tags=["candles"])


@router.get("/{symbol}", response_model=list[CandleOut])
def get_candles(
    symbol: str,
    timeframe: str = Query("1d", pattern="^(1h|4h|1d)$"),
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(500, le=10000),
    session: Session = Depends(get_session),
):
    if timeframe not in TIMEFRAMES:
        raise HTTPException(422, f"timeframe must be one of {TIMEFRAMES}")
    sym = session.scalar(select(Symbol).where(Symbol.symbol == symbol.upper()))
    if sym is None:
        raise HTTPException(404, f"Unknown symbol {symbol!r}")

    stmt = (
        select(Candle)
        .where(Candle.symbol_id == sym.id, Candle.timeframe == timeframe)
        .order_by(Candle.ts.desc())
        .limit(limit)
    )
    if start:
        stmt = stmt.where(Candle.ts >= start)
    if end:
        stmt = stmt.where(Candle.ts <= end)

    rows = list(session.scalars(stmt))
    rows.reverse()  # return oldest → newest
    return rows
