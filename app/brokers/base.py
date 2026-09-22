"""Broker client contract: the shape every broker integration must expose.

`TradeRecord` / `HoldingRecord` are the normalized shapes app.brokers.service
upserts into BrokerTrade / BrokerHoldingSnapshot — broker-specific field
names get mapped onto these before they ever reach the DB layer.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Protocol


@dataclass
class TradeRecord:
    broker_trade_id: str
    broker_order_id: str | None
    exchange_trade_id: str | None
    exchange: str
    segment: str
    product: str
    tradingsymbol: str
    isin: str | None
    side: str  # "BUY" / "SELL", see app.models.TRADE_SIDES
    quantity: int
    price: float
    trade_ts: datetime  # tz-aware, IST
    raw: dict = field(default_factory=dict)


@dataclass
class HoldingRecord:
    isin: str
    tradingsymbol: str
    quantity: int
    t1_quantity: int | None
    average_price: float
    last_price: float | None
    raw: dict = field(default_factory=dict)


class BrokerClient(Protocol):
    broker: str

    def authenticate(self) -> None: ...

    def fetch_trades(self, day: date) -> list[TradeRecord]: ...

    def fetch_holdings(self) -> list[HoldingRecord]: ...
