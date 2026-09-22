from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class SymbolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    name: str | None
    industry: str | None
    isin: str | None
    active: bool


class CandleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ts: datetime
    timeframe: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class IngestRequest(BaseModel):
    mode: str = "incremental"  # backfill | incremental
    timeframes: list[str] = ["1h", "4h", "1d"]
    # Optional subset for testing; default = full active universe.
    symbols: list[str] | None = None


class IngestRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    mode: str
    status: str
    timeframes: list
    symbols_total: int
    symbols_ok: int
    symbols_failed: int
    candles_written: int
    message: str | None
    errors: list
    started_at: datetime
    finished_at: datetime | None


class CorporateActionLoadRequest(BaseModel):
    # Default range is set by the router: five years back to today.
    from_date: date | None = None
    to_date: date | None = None
    symbols: list[str] | None = None


# --- Broker / positions domain (app.routers.users/brokers/positions) ---


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str | None
    created_at: datetime


class BrokerAccountCreate(BaseModel):
    broker: str
    label: str
    api_key: str
    totp_secret: str


class BrokerAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    broker: str
    label: str
    active: bool
    last_sync_on: date | None
    last_sync_status: str | None
    last_sync_message: str | None
    created_at: datetime


class SyncRequest(BaseModel):
    day: date | None = None


class TradeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    broker: str
    tradingsymbol: str
    symbol: str | None = None
    isin: str | None
    side: str
    quantity: int
    price: float
    trade_ts: datetime
    trade_date: date
    position_id: int | None
    applied_at: datetime | None


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    position_id: int
    as_of: date
    bar_ts: datetime
    close: float
    high: float
    low: float
    stop_level: float | None
    trail_level: float | None
    target_1: float | None
    target_2: float | None
    supertrend_dir: int | None
    atr: float | None
    verdict: str
    reasons: list
    warnings: list
    unrealized_pnl_pct: float
    days_held: int


class PositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    broker_account_id: int
    symbol_id: int
    symbol: str
    status: str
    opened_on: date
    entry_trade_id: int
    qty_open: int
    qty_total: int
    avg_entry_price: float
    avg_entry_price_raw: float
    structural_factor_applied: float
    last_restated_on: date | None
    matched_strategy: str | None
    matched_signal_ts: datetime | None
    matched_timeframe: str
    match_confidence: float | None
    match_reason: str | None
    is_unmatched: bool
    frozen_entry: float | None
    frozen_stop: float | None
    frozen_target_1: float | None
    frozen_target_2: float | None
    frozen_details: dict
    closed_on: date | None
    exit_trade_id: int | None
    realized_pnl: float | None
    realized_pnl_pct: float | None
    last_evaluated_on: date | None
    last_verdict: str | None
    created_at: datetime
    updated_at: datetime
    latest_evaluation: EvaluationOut | None = None


class MatchRequest(BaseModel):
    strategy: str
    ts: datetime


class AllocationIn(BaseModel):
    position_id: int
    quantity: int


class ReattributeRequest(BaseModel):
    allocations: list[AllocationIn]


class EvaluateRequest(BaseModel):
    as_of: date | None = None
