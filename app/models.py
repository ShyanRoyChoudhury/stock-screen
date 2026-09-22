from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

TIMEFRAMES = ("1h", "4h", "1d")

# Broker-positions domain constants.
BROKERS = ("groww", "zerodha")
TRADE_SIDES = ("BUY", "SELL")
POSITION_STATUSES = ("open", "closed")
VERDICTS = ("HOLD", "PARTIAL", "EXIT", "REVIEW")

# Adjustment conventions a stored price series can be on.
#   splits_only  — split/bonus adjusted, dividends left in the price.
#                  yfinance auto_adjust=False, and TradingView's native basis.
#   unadjusted   — raw traded prices, nothing applied. NSE bhavcopy.
#   total_return — splits and dividends both removed (yfinance auto_adjust=True).
#                  Not stored: Yahoo re-scales it retroactively on every
#                  ex-dividend date, so stored rows drift out of date.
PRICE_BASES = ("splits_only", "unadjusted", "total_return")
PRICE_BASIS_DEFAULT = "splits_only"

# Corporate action types that move the price. NSE publishes many more
# (AGM, EGM, interest payments); those are filtered out at ingest.
#   split / bonus  — self-contained, price_factor derivable from the action.
#   dividend       — factor is 1 - value/prior_close, so needs a price.
#   rights         — factor needs the theoretical ex-rights price.
#   demerger       — NSE publishes no ratio; needs an external valuation.
ACTION_TYPES = ("dividend", "split", "bonus", "rights", "demerger")


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
    # Which adjustment convention these prices are on. NOT part of uq_candle:
    # one basis is canonical at a time, and re-ingesting on a different basis
    # should overwrite rather than duplicate. The column exists so a partially
    # completed re-ingest can be detected instead of silently mixing bases.
    price_basis: Mapped[str] = mapped_column(
        String(16), default=PRICE_BASIS_DEFAULT, server_default=PRICE_BASIS_DEFAULT
    )
    inserted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    symbol_ref: Mapped[Symbol] = relationship(back_populates="candles")


class CorporateAction(Base):
    """A price-affecting corporate action, as published by NSE.

    Stored structurally (amount, ratio) rather than as a finished price
    factor, because a dividend's factor depends on the prior close and a
    rights issue's on the market price — both are read-time context. Splits
    and bonuses are self-contained, so `price_factor` is filled for those.

    `subject` keeps NSE's raw text: the parser is heuristic over free-form
    English, so every row must remain auditable against what NSE actually
    said. One row per (symbol, ex_date, action_type); a compound record such
    as "Interim Dividend - Rs 9 Per Share Special Dividend - Rs 18 Per Share"
    is summed, which is correct for adjustment since Rs 27 goes ex that day.
    """

    __tablename__ = "corporate_actions"
    __table_args__ = (
        UniqueConstraint(
            "symbol_id", "ex_date", "action_type", name="uq_corp_action"
        ),
        Index("ix_corp_actions_ex_date", "ex_date"),
        Index("ix_corp_actions_symbol_ex", "symbol_id", "ex_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    symbol_id: Mapped[int] = mapped_column(ForeignKey("symbols.id"), index=True)
    action_type: Mapped[str] = mapped_column(String(16))  # see ACTION_TYPES
    ex_date: Mapped[date] = mapped_column(Date)
    record_date: Mapped[date | None] = mapped_column(Date)

    # Dividend: total rupees per share going ex on this date.
    value: Mapped[float | None] = mapped_column(Float)
    # Split: face value before/after. Bonus and rights: the a:b terms.
    ratio_from: Mapped[float | None] = mapped_column(Float)
    ratio_to: Mapped[float | None] = mapped_column(Float)
    # Multiply prior prices by this. NULL when it needs price context
    # (dividend, rights) or external valuation (demerger).
    price_factor: Mapped[float | None] = mapped_column(Float)
    # NSE adjusts F&O strikes and lot sizes for splits, bonuses and
    # extraordinary dividends, but not ordinary ones.
    is_extraordinary: Mapped[bool] = mapped_column(Boolean, default=False)
    # True when the action affects share count, so volume needs adjusting too.
    affects_share_count: Mapped[bool] = mapped_column(Boolean, default=False)

    subject: Mapped[str] = mapped_column(String(512))
    source: Mapped[str] = mapped_column(String(16), default="nse")
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


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


class Signal(Base):
    """A strategy signal on one candle. Signals are regenerated per run
    (delete + insert per symbol/timeframe/strategy) so revised source data
    can't leave stale signals behind. `details` holds the strategy-specific
    fields (score, conviction, rvol, momentum, ...) exactly as the gist
    emits them.

    Deliberately NOT unique on (symbol, timeframe, strategy, ts): the
    pipeline can emit a RETEST and an IMMEDIATE signal on the same bar
    (a retest bar that is itself a fresh breakout) — that is spec output.
    Idempotency comes from delete-then-insert regeneration, not a key."""

    __tablename__ = "signals"
    __table_args__ = (
        Index("ix_signals_sym_tf_strat_ts", "symbol_id", "timeframe",
              "strategy", "ts"),
        Index("ix_signals_ts", "ts"),
        Index("ix_signals_strategy_ts", "strategy", "ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    symbol_id: Mapped[int] = mapped_column(ForeignKey("symbols.id"), index=True)
    timeframe: Mapped[str] = mapped_column(String(4))
    strategy: Mapped[str] = mapped_column(String(24))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    entry_mode: Mapped[str | None] = mapped_column(String(16))  # pipeline only
    entry: Mapped[float] = mapped_column(Float)
    stop_loss: Mapped[float] = mapped_column(Float)
    target_1: Mapped[float] = mapped_column(Float)
    target_2: Mapped[float] = mapped_column(Float)
    risk_pct: Mapped[float | None] = mapped_column(Float)
    rr_ratio: Mapped[float | None] = mapped_column(Float)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
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


class User(Base):
    """An operator who owns broker accounts and positions.

    `api_key_hash` authenticates API requests (see app.auth): the raw key is
    generated once by scripts/create_user.py, shown to the operator exactly
    that once, and never stored.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    email: Mapped[str | None] = mapped_column(String(256), unique=True)
    api_key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class BrokerAccount(Base):
    """One linked broker login for a user.

    `credentials_enc` holds the broker's login/API secrets as Fernet-
    encrypted JSON (see app.brokers.crypto); `access_token_enc` is the
    short-lived session token minted from those credentials. `last_sync_*`
    tracks the most recent trade/holdings pull for this account.
    """

    __tablename__ = "broker_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "broker", "label", name="uq_broker_account"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    broker: Mapped[str] = mapped_column(String(16))  # see BROKERS
    label: Mapped[str] = mapped_column(String(64))
    credentials_enc: Mapped[str] = mapped_column(Text)
    access_token_enc: Mapped[str | None] = mapped_column(Text)
    token_minted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_sync_on: Mapped[date | None] = mapped_column(Date)
    last_sync_status: Mapped[str | None] = mapped_column(String(16))
    last_sync_message: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Position(Base):
    """A position built from matched broker fills, sized in stored
    (splits_only) terms.

    `entry_trade_id` / `exit_trade_id` point at the BrokerTrade fills that
    opened and closed it. `matched_*` records which strategy signal (if any)
    this position was matched to; `is_unmatched` is True when no signal fit
    within app.config's match window/price-gap tolerance. `frozen_*` holds
    that signal's original entry/stop/targets so they survive later
    corporate-action restatement of `avg_entry_price`.

    Declared before BrokerTrade so `entry_trade_id`/`exit_trade_id` can carry
    the `use_alter` foreign keys that break the positions<->broker_trades
    circular reference for create_all.
    """

    __tablename__ = "positions"
    __table_args__ = (
        Index("ix_positions_user_status", "user_id", "status"),
        Index("ix_positions_symbol_status", "symbol_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    broker_account_id: Mapped[int] = mapped_column(ForeignKey("broker_accounts.id"))
    symbol_id: Mapped[int] = mapped_column(ForeignKey("symbols.id"), index=True)
    status: Mapped[str] = mapped_column(String(8), default="open")  # POSITION_STATUSES
    opened_on: Mapped[date] = mapped_column(Date)
    entry_trade_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "broker_trades.id", use_alter=True, name="fk_positions_entry_trade"
        ),
        unique=True,
    )
    qty_open: Mapped[int] = mapped_column()
    qty_total: Mapped[int] = mapped_column()
    avg_entry_price: Mapped[float] = mapped_column(Float)
    avg_entry_price_raw: Mapped[float] = mapped_column(Float)
    structural_factor_applied: Mapped[float] = mapped_column(Float, default=1.0)
    last_restated_on: Mapped[date | None] = mapped_column(Date)
    matched_strategy: Mapped[str | None] = mapped_column(String(24))
    matched_signal_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    matched_timeframe: Mapped[str] = mapped_column(String(4), default="1d")
    match_confidence: Mapped[float | None] = mapped_column(Float)
    match_reason: Mapped[str | None] = mapped_column(String(128))
    is_unmatched: Mapped[bool] = mapped_column(Boolean, default=True)
    frozen_entry: Mapped[float | None] = mapped_column(Float)
    frozen_stop: Mapped[float | None] = mapped_column(Float)
    frozen_target_1: Mapped[float | None] = mapped_column(Float)
    frozen_target_2: Mapped[float | None] = mapped_column(Float)
    frozen_details: Mapped[dict] = mapped_column(JSONB, default=dict)
    closed_on: Mapped[date | None] = mapped_column(Date)
    exit_trade_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "broker_trades.id", use_alter=True, name="fk_positions_exit_trade"
        ),
    )
    realized_pnl: Mapped[float | None] = mapped_column(Float)
    realized_pnl_pct: Mapped[float | None] = mapped_column(Float)
    last_evaluated_on: Mapped[date | None] = mapped_column(Date)
    last_verdict: Mapped[str | None] = mapped_column(String(8))  # see VERDICTS
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BrokerTrade(Base):
    """One raw fill pulled from a broker's trade book.

    `raw` is the broker's untouched payload, kept for audit. `applied_at` is
    set once the fill has been folded into a Position via FIFO matching (see
    app.positions); a BUY that hasn't been applied yet is still a loose fill.
    `position_id` links a SELL fill back to the position(s) it closed —
    see SellAllocation for the split when one sell spans multiple lots.
    """

    __tablename__ = "broker_trades"
    __table_args__ = (
        UniqueConstraint(
            "broker_account_id", "broker_trade_id", name="uq_broker_trade"
        ),
        Index("ix_broker_trades_user_date", "user_id", "trade_date"),
        Index("ix_broker_trades_symbol_date", "symbol_id", "trade_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    broker_account_id: Mapped[int] = mapped_column(
        ForeignKey("broker_accounts.id"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    broker: Mapped[str] = mapped_column(String(16))  # see BROKERS
    broker_trade_id: Mapped[str] = mapped_column(String(64))
    broker_order_id: Mapped[str | None] = mapped_column(String(64))
    exchange_trade_id: Mapped[str | None] = mapped_column(String(64))
    exchange: Mapped[str] = mapped_column(String(8))
    segment: Mapped[str] = mapped_column(String(8))
    product: Mapped[str] = mapped_column(String(8))
    tradingsymbol: Mapped[str] = mapped_column(String(32))
    isin: Mapped[str | None] = mapped_column(String(24))
    symbol_id: Mapped[int | None] = mapped_column(
        ForeignKey("symbols.id"), index=True
    )
    side: Mapped[str] = mapped_column(String(4))  # see TRADE_SIDES
    quantity: Mapped[int] = mapped_column()
    price: Mapped[float] = mapped_column(Float)  # raw fill price, as paid
    trade_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    trade_date: Mapped[date] = mapped_column(Date)
    raw: Mapped[dict] = mapped_column(JSONB, default=dict)
    position_id: Mapped[int | None] = mapped_column(ForeignKey("positions.id"))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class BrokerHoldingSnapshot(Base):
    """A point-in-time broker holdings snapshot, one row per ISIN per
    `as_of` date. Used to reconcile computed positions against what the
    broker reports it actually holds, independent of the trade-derived
    Position bookkeeping.
    """

    __tablename__ = "broker_holdings_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "broker_account_id", "as_of", "isin", name="uq_holding_snapshot"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    broker_account_id: Mapped[int] = mapped_column(
        ForeignKey("broker_accounts.id"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    as_of: Mapped[date] = mapped_column(Date)
    isin: Mapped[str] = mapped_column(String(24))
    tradingsymbol: Mapped[str] = mapped_column(String(32))
    symbol_id: Mapped[int | None] = mapped_column(ForeignKey("symbols.id"))
    quantity: Mapped[int] = mapped_column()
    t1_quantity: Mapped[int | None] = mapped_column()
    average_price: Mapped[float] = mapped_column(Float)
    last_price: Mapped[float | None] = mapped_column(Float)
    raw: Mapped[dict] = mapped_column(JSONB, default=dict)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SellAllocation(Base):
    """FIFO allocation of a SELL trade's quantity against one or more open
    positions in the same symbol. Realized P&L is computed per allocation
    so a single sell that closes multiple lots attributes P&L correctly;
    `is_manual` flags an allocation an operator corrected by hand.
    """

    __tablename__ = "sell_allocations"
    __table_args__ = (
        UniqueConstraint(
            "sell_trade_id", "position_id", name="uq_sell_allocation"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    sell_trade_id: Mapped[int] = mapped_column(
        ForeignKey("broker_trades.id"), index=True
    )
    position_id: Mapped[int] = mapped_column(ForeignKey("positions.id"), index=True)
    quantity: Mapped[int] = mapped_column()
    price: Mapped[float] = mapped_column(Float)  # stored terms
    realized_pnl: Mapped[float] = mapped_column(Float)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PositionEvaluation(Base):
    """The daily verdict computed for an open position: where its stop/
    trail/target levels currently sit and whether to HOLD, take a PARTIAL
    exit, EXIT outright, or flag for manual REVIEW. One row per (position,
    as_of) — re-running a day's evaluation overwrites it rather than
    accumulating duplicates.
    """

    __tablename__ = "position_evaluations"
    __table_args__ = (
        UniqueConstraint("position_id", "as_of", name="uq_position_eval"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    position_id: Mapped[int] = mapped_column(
        ForeignKey("positions.id"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    as_of: Mapped[date] = mapped_column(Date)
    bar_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    close: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    stop_level: Mapped[float | None] = mapped_column(Float)
    trail_level: Mapped[float | None] = mapped_column(Float)
    target_1: Mapped[float | None] = mapped_column(Float)
    target_2: Mapped[float | None] = mapped_column(Float)
    supertrend_dir: Mapped[int | None] = mapped_column()  # +1 / -1
    atr: Mapped[float | None] = mapped_column(Float)
    verdict: Mapped[str] = mapped_column(String(8))  # see VERDICTS
    reasons: Mapped[list] = mapped_column(JSONB, default=list)
    warnings: Mapped[list] = mapped_column(JSONB, default=list)
    unrealized_pnl_pct: Mapped[float] = mapped_column(Float)
    days_held: Mapped[int] = mapped_column()
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
