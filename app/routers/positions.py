from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_session
from app.market_calendar import last_trading_day
from app.models import (
    POSITION_STATUSES,
    BrokerTrade,
    Position,
    PositionEvaluation,
    Signal,
    Symbol,
    User,
)
from app.schemas import (
    EvaluateRequest,
    EvaluationOut,
    MatchRequest,
    PositionOut,
    ReattributeRequest,
)

router = APIRouter(prefix="/positions", tags=["positions"])

_POSITION_COLUMNS = [c.name for c in Position.__table__.columns]


def _position_out(session: Session, position: Position, symbol: str) -> PositionOut:
    data = {c: getattr(position, c) for c in _POSITION_COLUMNS}
    latest = session.scalar(
        select(PositionEvaluation)
        .where(PositionEvaluation.position_id == position.id)
        .order_by(PositionEvaluation.as_of.desc())
        .limit(1)
    )
    return PositionOut(
        **data,
        symbol=symbol,
        latest_evaluation=EvaluationOut.model_validate(latest) if latest else None,
    )


def _get_owned_position(session: Session, user: User, position_id: int) -> Position:
    position = session.get(Position, position_id)
    if position is None or position.user_id != user.id:
        raise HTTPException(404, "Position not found")
    return position


# --- Literal routes ("/evaluations", "/evaluate") are registered before the
# "/{position_id}" routes: FastAPI only validates {position_id} as int AFTER
# matching the path shape, so a literal segment of the same shape must come
# first or it never gets a chance to match. ---


@router.get("", response_model=list[PositionOut])
def list_positions(
    status: str | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if status is not None and status not in POSITION_STATUSES:
        raise HTTPException(422, f"status must be one of {POSITION_STATUSES}")
    stmt = (
        select(Position, Symbol.symbol)
        .join(Symbol, Symbol.id == Position.symbol_id)
        .where(Position.user_id == user.id)
        .order_by(Position.opened_on.desc())
    )
    if status:
        stmt = stmt.where(Position.status == status)
    return [_position_out(session, p, sym) for p, sym in session.execute(stmt).all()]


@router.get("/evaluations", response_model=list[EvaluationOut])
def list_evaluations(
    as_of: date | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    day = as_of or last_trading_day()
    stmt = (
        select(PositionEvaluation)
        .where(
            PositionEvaluation.user_id == user.id, PositionEvaluation.as_of == day
        )
        .order_by(PositionEvaluation.position_id)
    )
    return list(session.scalars(stmt))


@router.post("/evaluate")
def evaluate(
    req: EvaluateRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    from app.positions.evaluator import evaluate_all

    return evaluate_all(session, req.as_of, user_id=user.id)


@router.get("/{position_id}", response_model=PositionOut)
def get_position(
    position_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    position = _get_owned_position(session, user, position_id)
    symbol = session.scalar(
        select(Symbol.symbol).where(Symbol.id == position.symbol_id)
    )
    return _position_out(session, position, symbol)


@router.get("/{position_id}/evaluations", response_model=list[EvaluationOut])
def position_evaluations(
    position_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _get_owned_position(session, user, position_id)
    stmt = (
        select(PositionEvaluation)
        .where(PositionEvaluation.position_id == position_id)
        .order_by(PositionEvaluation.as_of.desc())
    )
    return list(session.scalars(stmt))


@router.post("/{position_id}/match", response_model=PositionOut)
def match_position(
    position_id: int,
    req: MatchRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    from app.positions.matcher import Match, apply_match

    position = _get_owned_position(session, user, position_id)
    signal = session.scalar(
        select(Signal).where(
            Signal.symbol_id == position.symbol_id,
            Signal.timeframe == "1d",
            Signal.strategy == req.strategy,
            Signal.ts == req.ts,
        )
    )
    if signal is None:
        raise HTTPException(404, "No matching signal found")

    match = Match(
        strategy=signal.strategy,
        ts=signal.ts,
        confidence=1.0,
        reason="manual",
        entry=signal.entry,
        stop_loss=signal.stop_loss,
        target_1=signal.target_1,
        target_2=signal.target_2,
        details=signal.details,
    )
    apply_match(position, match)
    session.commit()
    session.refresh(position)
    symbol = session.scalar(
        select(Symbol.symbol).where(Symbol.id == position.symbol_id)
    )
    return _position_out(session, position, symbol)


@router.post("/trades/{sell_id}/reattribute")
def reattribute(
    sell_id: int,
    req: ReattributeRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    from app.positions.ledger import reattribute_sell

    trade = session.get(BrokerTrade, sell_id)
    if trade is None or trade.user_id != user.id:
        raise HTTPException(404, "Trade not found")

    allocations = [(a.position_id, a.quantity) for a in req.allocations]
    try:
        return reattribute_sell(session, sell_id, allocations)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
