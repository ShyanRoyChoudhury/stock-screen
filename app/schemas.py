from datetime import datetime

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
