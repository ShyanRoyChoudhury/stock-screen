"""FIFO application of broker fills into Position / SellAllocation rows.

BUY fills open new positions; SELL fills are allocated oldest-lot-first
against a symbol's open positions in the same broker account (allocate_fifo,
PURE). Both directions first restate the broker's raw fill price into the
candle series' stored (splits_only) terms via
app.positions.matcher.fill_price_in_stored_terms, so a fill from years ago
is comparable to today's split/bonus-adjusted prices.

apply_unapplied_trades is the DB entry point: it walks BrokerTrade rows with
applied_at IS NULL in trade order, applies each independently (one bad trade
doesn't sour the batch — it is rolled back and recorded, not raised), and
marks each one applied as it commits.
"""

import logging
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.market_calendar import last_trading_day, now_ist
from app.models import BrokerTrade, Position, SellAllocation
from app.positions.matcher import (
    apply_match,
    fill_price_in_stored_terms,
    match_signal,
)

logger = logging.getLogger(__name__)


def allocate_fifo(
    open_positions: list[tuple[int, date, int]], sell_qty: int
) -> tuple[list[tuple[int, int]], int]:
    """Consume `sell_qty` from `open_positions` (position_id, opened_on,
    qty_open), oldest lot first. Returns (allocations [(position_id, qty)],
    leftover) — leftover > 0 means the sell exceeds all known open quantity.
    """
    ordered = sorted(open_positions, key=lambda p: (p[1], p[0]))
    allocations: list[tuple[int, int]] = []
    remaining = sell_qty
    for position_id, _opened_on, qty_open in ordered:
        if remaining <= 0:
            break
        take = min(qty_open, remaining)
        if take <= 0:
            continue
        allocations.append((position_id, take))
        remaining -= take
    return allocations, remaining


def _close_if_flat(session: Session, pos: Position, trade: BrokerTrade) -> None:
    """Close `pos` and stamp its realized P&L once qty_open hits zero."""
    if pos.qty_open != 0:
        return
    pos.status = "closed"
    pos.closed_on = trade.trade_date
    pos.exit_trade_id = trade.id
    total_pnl = session.scalar(
        select(func.sum(SellAllocation.realized_pnl)).where(
            SellAllocation.position_id == pos.id
        )
    ) or 0.0
    pos.realized_pnl = total_pnl
    pos.realized_pnl_pct = total_pnl / (pos.avg_entry_price * pos.qty_total)


def _apply_buy(session: Session, trade: BrokerTrade) -> None:
    as_of = last_trading_day()
    fill_stored, factor = fill_price_in_stored_terms(
        session, trade.symbol_id, trade.price, trade.trade_date, as_of=as_of
    )
    qty_now = round(trade.quantity / factor)
    position = Position(
        user_id=trade.user_id,
        broker_account_id=trade.broker_account_id,
        symbol_id=trade.symbol_id,
        status="open",
        opened_on=trade.trade_date,
        entry_trade_id=trade.id,
        qty_open=qty_now,
        qty_total=qty_now,
        avg_entry_price=fill_stored,
        avg_entry_price_raw=trade.price,
        structural_factor_applied=factor,
        # Every action effective on or before as_of is already folded into
        # `factor` above; restate_for_actions picks up anything with a
        # later ex-date.
        last_restated_on=as_of,
    )
    session.add(position)
    session.flush()

    match = match_signal(session, trade.symbol_id, trade.price, trade.trade_date)
    apply_match(position, match)

    trade.position_id = position.id
    trade.applied_at = now_ist()
    session.commit()


def _apply_sell(session: Session, trade: BrokerTrade) -> int:
    """Apply a SELL trade via FIFO allocation. Returns the leftover quantity
    (0 when every share sold matched an open position)."""
    sell_stored, factor = fill_price_in_stored_terms(
        session, trade.symbol_id, trade.price, trade.trade_date,
        as_of=last_trading_day(),
    )
    sell_qty_now = round(trade.quantity / factor)

    open_positions = list(
        session.scalars(
            select(Position).where(
                Position.broker_account_id == trade.broker_account_id,
                Position.symbol_id == trade.symbol_id,
                Position.status == "open",
            )
        )
    )
    by_id = {p.id: p for p in open_positions}
    allocations, leftover = allocate_fifo(
        [(p.id, p.opened_on, p.qty_open) for p in open_positions], sell_qty_now
    )

    first_position_id: int | None = None
    for position_id, qty in allocations:
        if first_position_id is None:
            first_position_id = position_id
        pos = by_id[position_id]
        realized_pnl = (sell_stored - pos.avg_entry_price) * qty
        session.add(
            SellAllocation(
                sell_trade_id=trade.id,
                position_id=pos.id,
                quantity=qty,
                price=sell_stored,
                realized_pnl=realized_pnl,
                is_manual=False,
            )
        )
        pos.qty_open -= qty
        _close_if_flat(session, pos, trade)

    trade.position_id = first_position_id
    trade.applied_at = now_ist()
    session.commit()
    return leftover


def apply_unapplied_trades(session: Session, user_id: int | None = None) -> dict:
    """Fold every un-applied BrokerTrade (applied_at IS NULL) into
    Position/SellAllocation rows, oldest trade first. Trades with no
    symbol_id (unmapped tradingsymbol) are left untouched and counted in
    `skipped_unmapped`; any other per-trade failure is rolled back, logged
    and recorded in `errors` rather than aborting the whole batch."""
    result = {
        "buys_opened": 0,
        "sells_allocated": 0,
        "orphan_sells": [],
        "skipped_unmapped": 0,
        "errors": [],
    }

    stmt = select(BrokerTrade).where(BrokerTrade.applied_at.is_(None))
    if user_id is not None:
        stmt = stmt.where(BrokerTrade.user_id == user_id)
    stmt = stmt.order_by(BrokerTrade.trade_ts, BrokerTrade.id)
    trades = session.scalars(stmt).all()

    for trade in trades:
        if trade.symbol_id is None:
            result["skipped_unmapped"] += 1
            continue
        try:
            if trade.side == "BUY":
                _apply_buy(session, trade)
                result["buys_opened"] += 1
            else:
                leftover = _apply_sell(session, trade)
                result["sells_allocated"] += 1
                if leftover > 0:
                    result["orphan_sells"].append(
                        {"trade_id": trade.id, "leftover": leftover}
                    )
        except Exception as e:  # noqa: BLE001 - isolate one bad trade
            session.rollback()
            logger.exception("Failed to apply broker trade %s", trade.id)
            result["errors"].append({"trade_id": trade.id, "error": str(e)})

    return result


def reattribute_sell(
    session: Session, sell_trade_id: int, allocations: list[tuple[int, int]]
) -> dict:
    """Manually re-split a SELL trade's quantity across `allocations`
    ([(position_id, qty), ...]), replacing whatever FIFO produced.

    Validates the trade is a SELL, that the allocation quantities sum to its
    fill quantity (in stored share terms) and that every named position
    belongs to the trade's broker account and symbol. Existing allocations
    for this trade are reversed (qty restored, and a position this trade
    had closed is reopened) before the new ones are applied with
    is_manual=True under the same closing rules as FIFO.
    """
    trade = session.get(BrokerTrade, sell_trade_id)
    if trade is None:
        raise ValueError(f"broker trade {sell_trade_id} not found")
    if trade.side != "SELL":
        raise ValueError(f"broker trade {sell_trade_id} is not a SELL")

    _, factor = fill_price_in_stored_terms(
        session, trade.symbol_id, trade.price, trade.trade_date,
        as_of=last_trading_day(),
    )
    sell_qty_now = round(trade.quantity / factor)
    total_qty = sum(qty for _pid, qty in allocations)
    if total_qty != sell_qty_now:
        raise ValueError(
            f"allocation quantities sum to {total_qty}, expected {sell_qty_now}"
        )

    positions: dict[int, Position] = {}
    for position_id, _qty in allocations:
        pos = session.get(Position, position_id)
        if pos is None:
            raise ValueError(f"position {position_id} not found")
        if (
            pos.broker_account_id != trade.broker_account_id
            or pos.symbol_id != trade.symbol_id
        ):
            raise ValueError(
                f"position {position_id} does not belong to broker account "
                f"{trade.broker_account_id} / symbol {trade.symbol_id}"
            )
        positions[position_id] = pos

    # Reverse whatever this trade previously allocated.
    existing = list(
        session.scalars(
            select(SellAllocation).where(
                SellAllocation.sell_trade_id == sell_trade_id
            )
        )
    )
    reopened: list[int] = []
    for alloc in existing:
        pos = session.get(Position, alloc.position_id)
        pos.qty_open += alloc.quantity
        if pos.exit_trade_id == sell_trade_id:
            pos.status = "open"
            pos.closed_on = None
            pos.exit_trade_id = None
            pos.realized_pnl = None
            pos.realized_pnl_pct = None
            reopened.append(pos.id)
        session.delete(alloc)
    session.flush()

    sell_stored, _factor = fill_price_in_stored_terms(
        session, trade.symbol_id, trade.price, trade.trade_date,
        as_of=last_trading_day(),
    )
    first_position_id: int | None = None
    for position_id, qty in allocations:
        if first_position_id is None:
            first_position_id = position_id
        pos = positions[position_id]
        realized_pnl = (sell_stored - pos.avg_entry_price) * qty
        session.add(
            SellAllocation(
                sell_trade_id=sell_trade_id,
                position_id=pos.id,
                quantity=qty,
                price=sell_stored,
                realized_pnl=realized_pnl,
                is_manual=True,
            )
        )
        pos.qty_open -= qty
        _close_if_flat(session, pos, trade)

    trade.position_id = first_position_id
    session.commit()

    return {
        "trade_id": trade.id,
        "allocations": [
            {"position_id": pid, "quantity": qty} for pid, qty in allocations
        ],
        "reopened_position_ids": reopened,
    }
