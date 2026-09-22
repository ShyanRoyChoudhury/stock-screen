from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.brokers.crypto import MasterKeyMissing, encrypt_json
from app.brokers.registry import client_for
from app.brokers.service import import_tradebook_csv, sync_account
from app.db import get_session
from app.market_calendar import last_trading_day
from app.models import BROKERS, BrokerAccount, BrokerTrade, Symbol, User
from app.schemas import (
    BrokerAccountCreate,
    BrokerAccountOut,
    SyncRequest,
    TradeOut,
)

router = APIRouter(prefix="/broker-accounts", tags=["brokers"])


def _get_owned_account(session: Session, user: User, account_id: int) -> BrokerAccount:
    account = session.get(BrokerAccount, account_id)
    if account is None or account.user_id != user.id:
        raise HTTPException(404, "Broker account not found")
    return account


# --- Literal routes registered before "/{account_id}..." so FastAPI's path
# matching (which validates {account_id} as int only after routing, not via
# a URL regex) can't accidentally swallow them. See app/routers/positions.py
# for the same concern. ---


@router.get("/trades", response_model=list[TradeOut])
def list_trades(
    from_date: date | None = None,
    to_date: date | None = None,
    symbol: str | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    stmt = (
        select(BrokerTrade, Symbol.symbol)
        .outerjoin(Symbol, Symbol.id == BrokerTrade.symbol_id)
        .where(BrokerTrade.user_id == user.id)
        .order_by(BrokerTrade.trade_ts.desc())
    )
    if from_date:
        stmt = stmt.where(BrokerTrade.trade_date >= from_date)
    if to_date:
        stmt = stmt.where(BrokerTrade.trade_date <= to_date)
    if symbol:
        stmt = stmt.where(Symbol.symbol == symbol.upper())

    out = []
    for trade, sym in session.execute(stmt).all():
        out.append(
            TradeOut(
                id=trade.id,
                broker=trade.broker,
                tradingsymbol=trade.tradingsymbol,
                symbol=sym,
                isin=trade.isin,
                side=trade.side,
                quantity=trade.quantity,
                price=trade.price,
                trade_ts=trade.trade_ts,
                trade_date=trade.trade_date,
                position_id=trade.position_id,
                applied_at=trade.applied_at,
            )
        )
    return out


@router.post("/sync-all")
def sync_all(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
):
    accounts = list(
        session.scalars(
            select(BrokerAccount).where(
                BrokerAccount.user_id == user.id, BrokerAccount.active.is_(True)
            )
        )
    )
    day = last_trading_day()
    results = []
    for account in accounts:
        try:
            result = sync_account(session, account, day)
            results.append({"account_id": account.id, "ok": True, "result": result})
        except Exception as e:
            results.append({"account_id": account.id, "ok": False, "error": str(e)})
    return {"accounts": len(accounts), "results": results}


@router.post("", response_model=BrokerAccountOut, status_code=201)
def create_account(
    req: BrokerAccountCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if req.broker not in BROKERS:
        raise HTTPException(422, f"broker must be one of {BROKERS}")
    try:
        creds_enc = encrypt_json(
            {"api_key": req.api_key, "totp_secret": req.totp_secret}
        )
    except MasterKeyMissing as e:
        raise HTTPException(503, str(e)) from e

    account = BrokerAccount(
        user_id=user.id,
        broker=req.broker,
        label=req.label,
        credentials_enc=creds_enc,
    )
    session.add(account)
    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise HTTPException(
            409, "A broker account with this broker/label already exists"
        ) from e
    session.refresh(account)
    return account


@router.get("", response_model=list[BrokerAccountOut])
def list_accounts(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
):
    return list(
        session.scalars(
            select(BrokerAccount)
            .where(BrokerAccount.user_id == user.id)
            .order_by(BrokerAccount.id)
        )
    )


@router.delete("/{account_id}", response_model=BrokerAccountOut)
def deactivate_account(
    account_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    account = _get_owned_account(session, user, account_id)
    account.active = False
    session.commit()
    session.refresh(account)
    return account


@router.post("/{account_id}/test")
def test_account(
    account_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    account = _get_owned_account(session, user, account_id)
    client = client_for(account)
    client.authenticate()
    holdings = client.fetch_holdings()
    return {"ok": True, "holdings": len(holdings)}


@router.post("/{account_id}/sync")
def sync(
    account_id: int,
    req: SyncRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    account = _get_owned_account(session, user, account_id)
    day = req.day or last_trading_day()
    return sync_account(session, account, day)


@router.post("/{account_id}/import-tradebook")
async def import_tradebook(
    account_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    account = _get_owned_account(session, user, account_id)
    data = await file.read()
    return import_tradebook_csv(session, account, data)
