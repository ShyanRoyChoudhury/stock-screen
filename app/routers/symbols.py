from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Symbol
from app.schemas import SymbolOut
from app.universe import refresh_universe

router = APIRouter(prefix="/symbols", tags=["symbols"])


@router.get("", response_model=list[SymbolOut])
def list_symbols(active_only: bool = True, session: Session = Depends(get_session)):
    stmt = select(Symbol).order_by(Symbol.symbol)
    if active_only:
        stmt = stmt.where(Symbol.active.is_(True))
    return list(session.scalars(stmt))


@router.post("/refresh")
def refresh(session: Session = Depends(get_session)):
    return refresh_universe(session)
