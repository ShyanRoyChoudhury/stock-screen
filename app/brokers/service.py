"""Broker sync orchestration: symbol mapping, trade/holding upserts, and the
tradebook CSV import path used before a live broker client exists.

`apply_unapplied_trades` (app.positions.ledger) is imported lazily wherever
it's used: that module is being written in parallel and may not exist yet.

`sync_account` commits after trades and again after holdings rather than
once at the end: a broker's same-day trade window is precious and easy to
miss on a retry, so trades that were already fetched must survive even if
a later step (holdings, ledger) fails. On failure, the session is rolled
back first (which expires `account`), so the account row is re-fetched
before recording the failure status.
"""

import csv
import hashlib
import io
import re
from datetime import date, datetime
from datetime import time as dt_time

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.brokers.base import HoldingRecord, TradeRecord
from app.brokers.registry import client_for
from app.ingest.service import _resolve_symbols
from app.market_calendar import IST
from app.models import (
    TRADE_SIDES,
    BrokerAccount,
    BrokerHoldingSnapshot,
    BrokerTrade,
    Symbol,
)

_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y")


def _find_symbol(session: Session, isin: str | None, symbol_str: str) -> Symbol | None:
    if isin:
        sym = session.scalar(select(Symbol).where(Symbol.isin == isin))
        if sym is not None:
            return sym
    return session.scalar(select(Symbol).where(Symbol.symbol == symbol_str))


def map_symbol(session: Session, isin: str | None, tradingsymbol: str) -> Symbol:
    """Resolve a broker's (isin, tradingsymbol) pair to our Symbol, creating
    one on demand via app.ingest.service._resolve_symbols if neither matches.
    """
    symbol_str = tradingsymbol.upper()
    sym = _find_symbol(session, isin, symbol_str)
    if sym is None:
        sym = _resolve_symbols(session, [symbol_str])[0]
    if isin and sym.isin != isin:
        sym.isin = isin
    return sym


def upsert_trades(
    session: Session, account: BrokerAccount, records: list[TradeRecord]
) -> dict:
    unmapped: list[str] = []
    rows = []
    for r in records:
        symbol_str = r.tradingsymbol.upper()
        existed = _find_symbol(session, r.isin, symbol_str) is not None
        sym = map_symbol(session, r.isin, r.tradingsymbol)
        if not existed and symbol_str not in unmapped:
            unmapped.append(symbol_str)
        rows.append(
            {
                "broker_account_id": account.id,
                "user_id": account.user_id,
                "broker": account.broker,
                "broker_trade_id": r.broker_trade_id,
                "broker_order_id": r.broker_order_id,
                "exchange_trade_id": r.exchange_trade_id,
                "exchange": r.exchange,
                "segment": r.segment,
                "product": r.product,
                "tradingsymbol": r.tradingsymbol,
                "isin": r.isin,
                "symbol_id": sym.id,
                "side": r.side,
                "quantity": r.quantity,
                "price": r.price,
                "trade_ts": r.trade_ts,
                "trade_date": r.trade_ts.astimezone(IST).date(),
                "raw": r.raw,
            }
        )

    upserted = 0
    if rows:
        stmt = pg_insert(BrokerTrade).values(rows)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_broker_trade",
            set_={
                c: stmt.excluded[c]
                for c in ("price", "quantity", "raw", "symbol_id", "isin")
            },
        )
        session.execute(stmt)
        session.flush()
        upserted = len(rows)

    return {"received": len(records), "upserted": upserted, "unmapped": unmapped}


def upsert_holdings(
    session: Session,
    account: BrokerAccount,
    as_of: date,
    records: list[HoldingRecord],
) -> int:
    if not records:
        return 0
    rows = []
    for r in records:
        sym = map_symbol(session, r.isin, r.tradingsymbol)
        rows.append(
            {
                "broker_account_id": account.id,
                "user_id": account.user_id,
                "as_of": as_of,
                "isin": r.isin,
                "tradingsymbol": r.tradingsymbol,
                "symbol_id": sym.id,
                "quantity": r.quantity,
                "t1_quantity": r.t1_quantity,
                "average_price": r.average_price,
                "last_price": r.last_price,
                "raw": r.raw,
            }
        )
    stmt = pg_insert(BrokerHoldingSnapshot).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_holding_snapshot",
        set_={
            c: stmt.excluded[c]
            for c in (
                "tradingsymbol",
                "symbol_id",
                "quantity",
                "t1_quantity",
                "average_price",
                "last_price",
                "raw",
            )
        },
    )
    session.execute(stmt)
    session.flush()
    return len(rows)


def _apply_unapplied_trades_lazy(session: Session, user_id: int) -> dict | None:
    try:
        from app.positions.ledger import apply_unapplied_trades
    except ImportError:
        return None
    return apply_unapplied_trades(session, user_id=user_id)


def sync_account(session: Session, account: BrokerAccount, day: date) -> dict:
    client = client_for(account)
    try:
        client.authenticate()
        trades = client.fetch_trades(day)
        trade_result = upsert_trades(session, account, trades)
        session.commit()  # trades are precious: keep them even if holdings fail below

        holdings = client.fetch_holdings()
        holdings_count = upsert_holdings(session, account, day, holdings)
        session.commit()

        ledger_result = _apply_unapplied_trades_lazy(session, account.user_id)

        account.last_sync_on = day
        account.last_sync_status = "ok"
        account.last_sync_message = None
        session.commit()
        return {
            "trades": trade_result,
            "holdings": holdings_count,
            "ledger": ledger_result,
        }
    except Exception as e:
        message = str(e)
        session.rollback()  # first: clears any partial, uncommitted work...
        account = session.get(BrokerAccount, account.id)  # ...which expired `account`
        account.last_sync_status = (
            "auth_failed" if re.search("auth|token", message, re.I) else "error"
        )
        account.last_sync_message = message[:512]
        session.commit()
        raise


def _parse_csv_date(raw: str, row_idx: int) -> date:
    raw = raw.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise HTTPException(422, f"row {row_idx}: invalid date {raw!r}")


def import_tradebook_csv(
    session: Session, account: BrokerAccount, data: bytes
) -> dict:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise HTTPException(422, f"CSV is not valid UTF-8: {e}") from e

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(422, "CSV has no header row")
    field_map = {name.strip().lower(): name for name in reader.fieldnames}

    def get(row: dict, *names: str) -> str | None:
        for name in names:
            key = field_map.get(name)
            if key is not None and row.get(key) not in (None, ""):
                return row[key]
        return None

    records: list[TradeRecord] = []
    for idx, row in enumerate(reader, start=1):
        date_str = get(row, "trade_date", "date")
        if not date_str:
            raise HTTPException(422, f"row {idx}: missing trade_date/date")
        trade_date = _parse_csv_date(date_str, idx)

        symbol_raw = get(row, "symbol")
        isin = get(row, "isin")
        if not symbol_raw and not isin:
            raise HTTPException(
                422, f"row {idx}: at least one of symbol/isin is required"
            )
        symbol_str = (symbol_raw or isin).strip().upper()
        isin_val = isin.strip().upper() if isin else None

        side_raw = get(row, "side", "trade_type")
        if not side_raw:
            raise HTTPException(422, f"row {idx}: missing side/trade_type")
        side = side_raw.strip().upper()
        if side not in TRADE_SIDES:
            raise HTTPException(
                422, f"row {idx}: side must be one of {TRADE_SIDES}, got {side_raw!r}"
            )

        qty_raw = get(row, "quantity")
        price_raw = get(row, "price")
        if qty_raw is None or price_raw is None:
            raise HTTPException(422, f"row {idx}: missing quantity/price")
        try:
            quantity = int(float(qty_raw))
            price = float(price_raw)
        except ValueError:
            raise HTTPException(422, f"row {idx}: quantity/price must be numeric")

        exchange = (get(row, "exchange") or "NSE").strip().upper()
        segment = (get(row, "segment") or "CASH").strip().upper()
        product = (get(row, "product") or "CNC").strip().upper()
        time_str = (get(row, "time") or "15:29").strip()
        try:
            hh, mm = time_str.split(":")
            trade_time = dt_time(int(hh), int(mm))
        except Exception:
            raise HTTPException(422, f"row {idx}: invalid time {time_str!r}")

        trade_ts = datetime.combine(trade_date, trade_time, tzinfo=IST)

        trade_id = get(row, "trade_id")
        if not trade_id:
            basis = f"{trade_date}|{symbol_str}|{side}|{quantity}|{price}|{idx}"
            trade_id = "csv:" + hashlib.sha1(basis.encode()).hexdigest()[:16]

        records.append(
            TradeRecord(
                broker_trade_id=trade_id,
                broker_order_id=None,
                exchange_trade_id=None,
                exchange=exchange,
                segment=segment,
                product=product,
                tradingsymbol=symbol_str,
                isin=isin_val,
                side=side,
                quantity=quantity,
                price=price,
                trade_ts=trade_ts,
                raw=dict(row),
            )
        )

    result = upsert_trades(session, account, records)
    ledger_result = _apply_unapplied_trades_lazy(session, account.user_id)
    session.commit()

    return {
        "rows": len(records),
        "upserted": result["upserted"],
        "unmapped": result["unmapped"],
        "ledger": ledger_result,
    }
