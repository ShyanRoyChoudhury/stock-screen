"""Restates an already-open Position across a later split/bonus.

A Position is created with all corporate actions known at fill time already
folded into avg_entry_price (see app.positions.ledger._apply_buy). A split
or bonus discovered afterwards moves the goalposts: the candle series'
stored prices drop by the action's price_factor and its share count rises
by 1/price_factor, so a position's price levels and quantities must move
the same way to stay comparable — otherwise a stop level frozen from a
matched signal would sit at the wrong multiple of the current price.

restate() is the PURE arithmetic; restate_for_actions() is the DB wrapper
that finds the actions to fold in and writes the result back onto the ORM
object (the caller commits).
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CorporateAction, Position


def restate(
    avg_entry_price: float,
    frozen: dict,
    qty_open: int,
    qty_total: int,
    factor: float,
) -> dict:
    """Apply a cumulative split/bonus price `factor` to one position's price
    levels and share counts.

    `factor` multiplies prior prices to bring them to current share terms
    (e.g. a 5:1 bonus, six shares for one, is 1/6); share counts move
    inversely, qty / factor. `frozen` holds a matched signal's original
    entry/stop/target_1/target_2 (any subset of keys; None values pass
    through unchanged) alongside avg_entry_price, since both are price
    levels on the same series.

    Returns a dict with keys avg_entry_price, frozen, qty_open, qty_total.
    """
    return {
        "avg_entry_price": avg_entry_price * factor,
        "frozen": {
            k: (v * factor if v is not None else None) for k, v in frozen.items()
        },
        "qty_open": round(qty_open / factor),
        "qty_total": round(qty_total / factor),
    }


def restate_for_actions(session: Session, position: Position, up_to: date) -> list[str]:
    """Fold every split/bonus for `position`'s symbol dated after its last
    restatement (or its opening, if never restated) and on/before `up_to`
    into the position's price levels and quantities.

    Sell allocations are left untouched — they are historical fills, not a
    live position size, and stay denominated in the share terms of the sell
    that produced them. Does not commit; the caller does (session.flush()
    only, so the changes are visible within the same transaction).
    """
    since = position.last_restated_on or position.opened_on
    actions = session.scalars(
        select(CorporateAction)
        .where(
            CorporateAction.symbol_id == position.symbol_id,
            CorporateAction.action_type.in_(("split", "bonus")),
            CorporateAction.price_factor.isnot(None),
            CorporateAction.ex_date > since,
            CorporateAction.ex_date <= up_to,
        )
        .order_by(CorporateAction.ex_date)
    ).all()

    if not actions:
        return []

    combined_factor = 1.0
    descriptions: list[str] = []
    for a in actions:
        combined_factor *= a.price_factor
        descriptions.append(
            f"{a.action_type} {a.ex_date.isoformat()} x{a.price_factor:.4f}"
        )

    frozen = {
        "entry": position.frozen_entry,
        "stop": position.frozen_stop,
        "target_1": position.frozen_target_1,
        "target_2": position.frozen_target_2,
    }
    result = restate(
        position.avg_entry_price,
        frozen,
        position.qty_open,
        position.qty_total,
        combined_factor,
    )

    position.avg_entry_price = result["avg_entry_price"]
    position.frozen_entry = result["frozen"]["entry"]
    position.frozen_stop = result["frozen"]["stop"]
    position.frozen_target_1 = result["frozen"]["target_1"]
    position.frozen_target_2 = result["frozen"]["target_2"]
    position.qty_open = result["qty_open"]
    position.qty_total = result["qty_total"]
    position.structural_factor_applied = (
        position.structural_factor_applied * combined_factor
    )
    position.last_restated_on = up_to

    session.flush()
    return descriptions
