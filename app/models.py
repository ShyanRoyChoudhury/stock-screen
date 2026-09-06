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
