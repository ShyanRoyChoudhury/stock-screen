from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.ingest.corporate_actions import load_actions
from app.models import ACTION_TYPES, CorporateAction, Symbol
from app.schemas import CorporateActionLoadRequest

router = APIRouter(prefix="/corporate-actions", tags=["corporate-actions"])


@router.post("/load")
def load(
    req: CorporateActionLoadRequest, session: Session = Depends(get_session)
):
    """Pull NSE corporate actions for a date range and upsert them.

    Synchronous: NSE returns the whole range in one call, so this is seconds,
    not the minutes an OHLCV backfill takes.
    """
    frm = req.from_date or (date.today() - timedelta(days=365 * 5))
    to = req.to_date or date.today()
    if frm > to:
        raise HTTPException(422, "from_date must not be after to_date")
    try:
        return load_actions(session, frm, to, req.symbols)
    except Exception as e:
        raise HTTPException(502, f"NSE fetch failed: {e}") from e


@router.get("")
def list_actions(
    symbol: str | None = None,
    action_type: str | None = None,
    limit: int = Query(50, le=500),
    session: Session = Depends(get_session),
):
    if action_type and action_type not in ACTION_TYPES:
        raise HTTPException(422, f"action_type must be one of {ACTION_TYPES}")
    q = (
        select(CorporateAction, Symbol.symbol)
        .join(Symbol, Symbol.id == CorporateAction.symbol_id)
        .order_by(CorporateAction.ex_date.desc())
        .limit(limit)
    )
    if symbol:
        q = q.where(Symbol.symbol == symbol)
    if action_type:
        q = q.where(CorporateAction.action_type == action_type)
    return [
        {
            "symbol": sym,
            "action_type": a.action_type,
            "ex_date": a.ex_date,
            "record_date": a.record_date,
            "value": a.value,
            "ratio_from": a.ratio_from,
            "ratio_to": a.ratio_to,
            "price_factor": a.price_factor,
            "is_extraordinary": a.is_extraordinary,
            "affects_share_count": a.affects_share_count,
            "subject": a.subject,
        }
        for a, sym in session.execute(q).all()
    ]
