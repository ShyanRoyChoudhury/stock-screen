"""Groww broker client, built on the `growwapi` SDK.

Auth is TOTP-based: `GrowwAPI.get_access_token()` takes the account's API
key plus a freshly generated `pyotp` code and returns a short-lived bearer
token, which is then wrapped in a `GrowwAPI(token)` instance for every
later call. Groww's order/trade endpoints only ever return the same
trading day's activity, so `fetch_trades()` treats `day` as a guard rather
than a query filter. `get_order_list()` silently ignores its `page_size`
argument (only `segment` and `page` are actually sent), so order pages are
walked until one comes back empty; `get_trade_list_for_order()` does honor
`page_size`, so trade pages use page_size=50.
"""

from datetime import date, datetime, time, timezone
from typing import Any

import pyotp
from growwapi import GrowwAPI
from growwapi.groww.exceptions import GrowwAPIException

from app.brokers.base import BrokerAuthError, HoldingRecord, TradeRecord
from app.brokers.crypto import encrypt_json
from app.brokers.registry import register
from app.config import settings
from app.market_calendar import IST, now_ist
from app.models import BrokerAccount

_MAX_ORDER_PAGES = 50
_MAX_TRADE_PAGES = 20
_TRADE_TS_KEYS = ("trade_date_time", "created_at", "exchange_time", "trade_date")
_FALLBACK_TRADE_TIME = time(15, 29)


def _first_list(payload: dict, preferred_key: str) -> list:
    """Return `payload[preferred_key]` if it's a list, else the first
    list-valued entry in `payload`, else []. The SDK's response shape for
    list key names isn't guaranteed across endpoints/versions."""
    value = payload.get(preferred_key)
    if isinstance(value, list):
        return value
    for value in payload.values():
        if isinstance(value, list):
            return value
    return []


def _extract_ts(trade: dict) -> Any:
    for key in _TRADE_TS_KEYS:
        value = trade.get(key)
        if value not in (None, ""):
            return value
    return None


def _parse_ts(value: Any, day: date) -> datetime:
    """Normalize a broker timestamp to a tz-aware IST datetime. Naive
    strings are assumed to already be IST; epoch milliseconds are assumed
    UTC; a missing value falls back to `day` at 15:29 IST (just before the
    close), which keeps a trade without a timestamp inside its own day."""
    if value is None or value == "":
        return datetime.combine(day, _FALLBACK_TRADE_TIME, tzinfo=IST)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).astimezone(IST)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return datetime.combine(day, _FALLBACK_TRADE_TIME, tzinfo=IST)
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                epoch_ms = float(text)
            except ValueError:
                return datetime.combine(day, _FALLBACK_TRADE_TIME, tzinfo=IST)
            return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).astimezone(
                IST
            )
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=IST)
        return parsed.astimezone(IST)
    return datetime.combine(day, _FALLBACK_TRADE_TIME, tzinfo=IST)


@register("groww")
def build_groww_client(account: BrokerAccount, creds: dict) -> "GrowwClient":
    return GrowwClient(account, api_key=creds["api_key"], totp_secret=creds["totp_secret"])


class GrowwClient:
    broker = "groww"

    def __init__(self, account: BrokerAccount, api_key: str, totp_secret: str) -> None:
        self.account = account
        self._api_key = api_key
        self._totp_secret = totp_secret
        self._api: GrowwAPI | None = None
        self._timeout = settings.groww_request_timeout

    def authenticate(self) -> None:
        try:
            totp = pyotp.TOTP(self._totp_secret).now()
            token = GrowwAPI.get_access_token(api_key=self._api_key, totp=totp)
        except Exception as e:
            # Never log e.args verbatim beyond the message text: the TOTP
            # secret and the minted token must never reach logs.
            raise BrokerAuthError(f"groww auth failed: {e}") from e
        self._api = GrowwAPI(token)
        self.account.access_token_enc = encrypt_json({"token": token})
        self.account.token_minted_at = now_ist()

    def fetch_trades(self, day: date) -> list[TradeRecord]:
        if self._api is None:
            self.authenticate()
        try:
            records: list[TradeRecord] = []
            for order in self._eligible_orders():
                trades = self._trades_for_order(order)
                for idx, trade in enumerate(trades):
                    status = trade.get("trade_status")
                    if status and status != "EXECUTED":
                        continue
                    record = self._to_trade_record(order, trade, idx, day)
                    if record.trade_ts.astimezone(IST).date() == day:
                        records.append(record)
            return records
        except GrowwAPIException as e:
            raise RuntimeError(f"groww api error: {e}") from e

    def fetch_holdings(self) -> list[HoldingRecord]:
        if self._api is None:
            self.authenticate()
        try:
            payload = self._api.get_holdings_for_user(timeout=self._timeout)
        except GrowwAPIException as e:
            raise RuntimeError(f"groww api error: {e}") from e
        records = []
        for row in _first_list(payload, "holdings"):
            t1_quantity = row.get("t1_quantity")
            last_price = row.get("last_price")
            records.append(
                HoldingRecord(
                    isin=row.get("isin"),
                    tradingsymbol=row.get("trading_symbol"),
                    quantity=int(row.get("quantity") or 0),
                    t1_quantity=int(t1_quantity) if t1_quantity is not None else None,
                    average_price=float(row.get("average_price") or 0.0),
                    last_price=float(last_price) if last_price is not None else None,
                    raw=row,
                )
            )
        return records

    # -- internals ---------------------------------------------------

    def _eligible_orders(self) -> list[dict]:
        """Delivery orders (CNC/MTF) with at least one filled unit. MIS
        (intraday) orders and unfilled orders are excluded."""
        eligible = []
        for order in self._all_orders():
            filled = int(order.get("filled_quantity") or 0)
            product = order.get("product")
            if filled > 0 and product in (GrowwAPI.PRODUCT_CNC, GrowwAPI.PRODUCT_MTF):
                eligible.append(order)
        return eligible

    def _all_orders(self) -> list[dict]:
        orders: list[dict] = []
        for page in range(_MAX_ORDER_PAGES):
            payload = self._api.get_order_list(
                page=page, segment=GrowwAPI.SEGMENT_CASH, timeout=self._timeout
            )
            batch = _first_list(payload, "order_list")
            if not batch:
                break
            orders.extend(batch)
        return orders

    def _trades_for_order(self, order: dict) -> list[dict]:
        order_id = order.get("groww_order_id")
        segment = order.get("segment") or GrowwAPI.SEGMENT_CASH
        trades: list[dict] = []
        for page in range(_MAX_TRADE_PAGES):
            payload = self._api.get_trade_list_for_order(
                order_id,
                segment=segment,
                page=page,
                page_size=50,
                timeout=self._timeout,
            )
            batch = _first_list(payload, "trade_list")
            if not batch:
                break
            trades.extend(batch)
        return trades

    def _to_trade_record(
        self, order: dict, trade: dict, idx: int, day: date
    ) -> TradeRecord:
        order_id = order.get("groww_order_id")
        trade_id = (
            trade.get("groww_trade_id")
            or trade.get("exchange_trade_id")
            or f"{order_id}:{idx}"
        )
        product = trade.get("product") or order.get("product")
        side = str(
            trade.get("transaction_type") or order.get("transaction_type") or ""
        ).upper()
        return TradeRecord(
            broker_trade_id=str(trade_id),
            broker_order_id=str(order_id) if order_id is not None else None,
            exchange_trade_id=trade.get("exchange_trade_id"),
            exchange=trade.get("exchange") or order.get("exchange") or GrowwAPI.EXCHANGE_NSE,
            segment=trade.get("segment") or order.get("segment") or GrowwAPI.SEGMENT_CASH,
            product=product,
            tradingsymbol=trade.get("trading_symbol") or order.get("trading_symbol"),
            isin=trade.get("isin"),
            side=side,
            quantity=int(trade.get("quantity") or 0),
            price=float(trade.get("price") or 0.0),
            trade_ts=_parse_ts(_extract_ts(trade), day),
            raw={**trade, "order": order},
        )
