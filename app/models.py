from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

TIMEFRAMES = ("1h", "4h", "1d")


class Symbol(Base):
    __tablename__ = "symbols"

    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(256))
    industry: Mapped[str | None] = mapped_column(String(128))
    isin: Mapped[str | None] = mapped_column(String(24))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    candles: Mapped[list["Candle"]] = relationship(back_populates="symbol_ref")


class Candle(Base):
    __tablename__ = "candles"
    __table_args__ = (
        UniqueConstraint("symbol_id", "timeframe", "ts", name="uq_candle"),
        Index("ix_candles_timeframe_ts", "timeframe", "ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    symbol_id: Mapped[int] = mapped_column(ForeignKey("symbols.id"), index=True)
    timeframe: Mapped[str] = mapped_column(String(4))
    # Candle START time, timezone-aware (IST for NSE sessions).
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[int] = mapped_column(BigInteger)
    source: Mapped[str] = mapped_column(String(16), default="yfinance")
    inserted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    symbol_ref: Mapped[Symbol] = relationship(back_populates="candles")


class IndicatorValue(Base):
    """Per-candle indicator values, one wide row per (symbol, timeframe, ts).

    Column names encode the gist's default parameters. Recomputed in full
    per symbol on every run — EWM-based indicators depend on the entire
    history, so partial/tail updates would drift.
    NULL = not defined yet (rolling-window warm-up).
    """

    __tablename__ = "indicator_values"
    __table_args__ = (
        UniqueConstraint("symbol_id", "timeframe", "ts", name="uq_indicator"),
        Index("ix_indicators_timeframe_ts", "timeframe", "ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    symbol_id: Mapped[int] = mapped_column(ForeignKey("symbols.id"), index=True)
    timeframe: Mapped[str] = mapped_column(String(4))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    atr_10: Mapped[float | None] = mapped_column(Float)
    supertrend_10_3: Mapped[float | None] = mapped_column(Float)
    supertrend_dir: Mapped[int | None] = mapped_column()  # +1 / -1
    macd_12_26: Mapped[float | None] = mapped_column(Float)
    macd_signal_9: Mapped[float | None] = mapped_column(Float)
    macd_hist: Mapped[float | None] = mapped_column(Float)
    ema_50: Mapped[float | None] = mapped_column(Float)
    ema_200: Mapped[float | None] = mapped_column(Float)
    adx_14: Mapped[float | None] = mapped_column(Float)
    bb_upper_20_2: Mapped[float | None] = mapped_column(Float)
    bb_middle_20_2: Mapped[float | None] = mapped_column(Float)
    bb_lower_20_2: Mapped[float | None] = mapped_column(Float)
    bb_bandwidth: Mapped[float | None] = mapped_column(Float)
    volume_ma_20: Mapped[float | None] = mapped_column(Float)
    kc_upper_20_15: Mapped[float | None] = mapped_column(Float)
    kc_middle_20: Mapped[float | None] = mapped_column(Float)
    kc_lower_20_15: Mapped[float | None] = mapped_column(Float)
    ttm_squeeze_on: Mapped[bool | None] = mapped_column(Boolean)
    ttm_squeeze_off: Mapped[bool | None] = mapped_column(Boolean)
    ttm_momentum: Mapped[float | None] = mapped_column(Float)
    rvol_20: Mapped[float | None] = mapped_column(Float)

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class IngestRun(Base):
    __tablename__ = "ingest_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    mode: Mapped[str] = mapped_column(String(16))  # backfill | incremental
    status: Mapped[str] = mapped_column(String(16), default="running")
    timeframes: Mapped[list] = mapped_column(JSONB, default=list)
    symbols_total: Mapped[int] = mapped_column(default=0)
    symbols_ok: Mapped[int] = mapped_column(default=0)
    symbols_failed: Mapped[int] = mapped_column(default=0)
    candles_written: Mapped[int] = mapped_column(BigInteger, default=0)
    message: Mapped[str | None] = mapped_column(String(512))
    errors: Mapped[list] = mapped_column(JSONB, default=list)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
