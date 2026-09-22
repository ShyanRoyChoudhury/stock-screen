"""Daily verdict evaluation for open positions.

`decide()` is a PURE rule engine over a snapshot of one position's state
(`EvalInputs`) — no DB access, unit-tested with synthetic inputs. Everything
else in this module is a thin DB layer that assembles those inputs from
candles, indicators, and corporate-action state, then upserts the result.

`app.positions.restate` (restating a position's price levels across a later
split/bonus) is written in parallel by another agent, so it is imported
lazily inside `evaluate_all` — this module must import cleanly even before
that file exists.
"""

import logging
from dataclasses import dataclass
from datetime import date

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.indicators.core import calc_atr, check_volume_divergence
from app.indicators.service import load_candles
from app.market_calendar import (
    IST,
    last_trading_day,
    session_open_dt,
    sessions_between,
    shift_sessions,
)
from app.models import (
    BrokerHoldingSnapshot,
    BrokerTrade,
    CorporateAction,
    IndicatorValue,
    Position,
    PositionEvaluation,
    Symbol,
)

logger = logging.getLogger(__name__)

# PositionEvaluation columns refreshed on a re-run of the same (position, as_of).
_UPSERT_SET_COLS = (
    "bar_ts", "close", "high", "low", "stop_level", "trail_level",
    "target_1", "target_2", "supertrend_dir", "atr", "verdict",
    "reasons", "warnings", "unrealized_pnl_pct", "days_held",
)


def chandelier_since(
    df_full: pd.DataFrame, entry_ts, atr_multiple: float = 2.5
) -> pd.Series:
    """Chandelier long trailing stop: rolling max high since `entry_ts`
    minus `atr_multiple` x ATR, cumulative-maxed so it never trails down.
    ATR is computed on the FULL history passed in (`df_full`), not on the
    since-entry slice, to avoid ~10 bars of EWM warm-up garbage."""
    atr = calc_atr(df_full)
    since = df_full[df_full.index >= entry_ts]
    return (since["high"].cummax() - atr_multiple * atr.loc[since.index]).cummax()


@dataclass
class EvalInputs:
    close: float
    high: float
    low: float
    bar_date: date
    as_of: date
    frozen_stop: float | None
    frozen_target_1: float | None
    frozen_target_2: float | None
    is_unmatched: bool
    trail: float | None
    supertrend_dir: int | None
    atr: float | None
    demerger_in_window: bool
    qty_mismatch: bool
    broker_qty: int | None
    platform_qty: int | None
    upcoming_action: str | None
    volume_divergence: bool
    days_held: int
    unrealized_pnl_pct: float
    stale: bool
    no_data: bool
    horizon_sessions: int = 30


@dataclass
class EvalResult:
    verdict: str
    reasons: list[dict]
    warnings: list[dict]
    stop_level: float | None
    trail_level: float | None


def decide(i: EvalInputs) -> EvalResult:
    """Pure rule engine. Precedence: the first rule (in listed order) whose
    condition is true sets the verdict; every rule that fires — even after
    the verdict is already set — still contributes its reason. Warnings
    never change the verdict."""
    if i.no_data:
        return EvalResult(
            verdict="REVIEW",
            reasons=[{"code": "NO_DATA", "detail": None}],
            warnings=[],
            stop_level=None,
            trail_level=None,
        )

    # Unmatched positions have no frozen signal stop, so the trailing stop
    # itself is the effective stop.
    stop_level = (
        i.frozen_stop
        if (not i.is_unmatched and i.frozen_stop is not None)
        else i.trail
    )
    matched = not i.is_unmatched

    reasons: list[dict] = []
    verdict: str | None = None

    if i.demerger_in_window:
        reasons.append({
            "code": "DEMERGER_CLIFF",
            "detail": "stored prices are not demerger-adjusted; levels unreliable",
        })
        verdict = verdict or "REVIEW"

    if i.qty_mismatch:
        reasons.append({"code": "QTY_MISMATCH", "detail": None})
        verdict = verdict or "REVIEW"

    if stop_level is not None and i.close < stop_level:
        reasons.append({
            "code": "STOP_HIT",
            "detail": f"close {i.close} < stop {stop_level}",
        })
        verdict = verdict or "EXIT"

    if i.supertrend_dir == -1:
        reasons.append({"code": "SUPERTREND_FLIP", "detail": None})
        verdict = verdict or "EXIT"

    if i.trail is not None and i.close < i.trail:
        reasons.append({"code": "TRAIL_HIT", "detail": None})
        verdict = verdict or "EXIT"

    if matched and i.frozen_target_2 and i.close >= i.frozen_target_2:
        reasons.append({"code": "T2_HIT", "detail": None})
        verdict = verdict or "EXIT"

    if matched and i.frozen_target_1 and i.close >= i.frozen_target_1:
        reasons.append({"code": "T1_HIT", "detail": None})
        verdict = verdict or "PARTIAL"

    if verdict is None:
        verdict = "HOLD"

    warnings: list[dict] = []
    if stop_level is not None and i.low < stop_level <= i.close:
        warnings.append({"code": "LOW_BREACH", "detail": None})
    if i.volume_divergence:
        warnings.append({"code": "VOLUME_DIVERGENCE", "detail": None})
    if i.upcoming_action:
        warnings.append({
            "code": "UPCOMING_ACTION",
            "detail": f"{i.upcoming_action}; broker may cancel your GTT; "
                      f"re-place the stop after the ex-date",
        })
    if (
        i.broker_qty is not None
        and i.platform_qty is not None
        and i.broker_qty != i.platform_qty
    ):
        warnings.append({"code": "QTY_DIFFERS_FROM_BROKER", "detail": None})
    if i.days_held > i.horizon_sessions:
        warnings.append({"code": "HORIZON", "detail": None})
    if i.stale:
        warnings.append({"code": "STALE_BAR", "detail": f"bar_date {i.bar_date}"})

    return EvalResult(
        verdict=verdict,
        reasons=reasons,
        warnings=warnings,
        stop_level=stop_level,
        trail_level=i.trail,
    )


def evaluate_position(session: Session, position: Position, as_of: date) -> PositionEvaluation:
    """Assemble EvalInputs for one open position as of `as_of`, run `decide`,
    and upsert the resulting PositionEvaluation row."""
    df = load_candles(session, position.symbol_id, "1d")

    no_data = df.empty
    bar_ts = None
    bar_date = as_of
    close = high = low = 0.0
    stale = False
    supertrend_dir = None
    atr = None
    trail = None
    demerger_in_window = False
    qty_mismatch = False
    broker_qty = None
    platform_qty = None
    upcoming_action = None
    volume_divergence = False

    if not no_data:
        dates = df.index.tz_convert(IST).date
        valid_positions = [p for p, d in enumerate(dates) if d <= as_of]
        if not valid_positions:
            no_data = True
        else:
            pos = valid_positions[-1]
            bar_ts = df.index[pos]
            bar_date = dates[pos]
            stale = bar_date < as_of
            bar_row = df.iloc[pos]
            close = float(bar_row["close"])
            high = float(bar_row["high"])
            low = float(bar_row["low"])

            ind = session.scalar(
                select(IndicatorValue).where(
                    IndicatorValue.symbol_id == position.symbol_id,
                    IndicatorValue.timeframe == "1d",
                    IndicatorValue.ts == bar_ts.to_pydatetime(),
                )
            )
            if ind is not None:
                supertrend_dir = ind.supertrend_dir
                atr = ind.atr_10
            else:
                atr = float(calc_atr(df).iloc[pos])

            entry_positions = [p for p, d in enumerate(dates) if d >= position.opened_on]
            if entry_positions:
                entry_ts = df.index[entry_positions[0]]
                trail_series = chandelier_since(
                    df.loc[:bar_ts], entry_ts, settings.chandelier_atr_multiple
                )
                trail = float(trail_series.iloc[-1])

            demerger_in_window = session.scalar(
                select(CorporateAction.id)
                .where(
                    CorporateAction.symbol_id == position.symbol_id,
                    CorporateAction.action_type == "demerger",
                    CorporateAction.ex_date > position.opened_on,
                    CorporateAction.ex_date <= as_of,
                )
                .limit(1)
            ) is not None

            scaled_qty = position.qty_total * position.structural_factor_applied
            qty_mismatch = abs(scaled_qty - round(scaled_qty)) > 1e-6

            symbol = session.get(Symbol, position.symbol_id)
            isin = symbol.isin if symbol and symbol.isin else None
            if isin is None:
                entry_trade = session.get(BrokerTrade, position.entry_trade_id)
                isin = entry_trade.isin if entry_trade else None
            if isin is not None:
                snap = session.scalar(
                    select(BrokerHoldingSnapshot)
                    .where(
                        BrokerHoldingSnapshot.broker_account_id == position.broker_account_id,
                        BrokerHoldingSnapshot.isin == isin,
                        BrokerHoldingSnapshot.as_of <= as_of,
                    )
                    .order_by(BrokerHoldingSnapshot.as_of.desc())
                    .limit(1)
                )
                broker_qty = snap.quantity if snap is not None else None

            platform_qty = session.scalar(
                select(func.sum(Position.qty_open)).where(
                    Position.broker_account_id == position.broker_account_id,
                    Position.symbol_id == position.symbol_id,
                    Position.status == "open",
                )
            )

            upcoming = session.scalar(
                select(CorporateAction)
                .where(
                    CorporateAction.symbol_id == position.symbol_id,
                    CorporateAction.ex_date > as_of,
                    CorporateAction.ex_date <= shift_sessions(
                        as_of, settings.upcoming_action_warn_sessions
                    ),
                )
                .order_by(CorporateAction.ex_date.asc())
                .limit(1)
            )
            if upcoming is not None:
                upcoming_action = (
                    f"{upcoming.action_type} ex {upcoming.ex_date}: {upcoming.subject}"
                )

            volume_divergence = check_volume_divergence(df.loc[:bar_ts])

    days_held = sessions_between(position.opened_on, as_of)
    unrealized_pnl_pct = 0.0 if no_data else close / position.avg_entry_price - 1

    inputs = EvalInputs(
        close=close,
        high=high,
        low=low,
        bar_date=bar_date,
        as_of=as_of,
        frozen_stop=position.frozen_stop,
        frozen_target_1=position.frozen_target_1,
        frozen_target_2=position.frozen_target_2,
        is_unmatched=position.is_unmatched,
        trail=trail,
        supertrend_dir=supertrend_dir,
        atr=atr,
        demerger_in_window=demerger_in_window,
        qty_mismatch=qty_mismatch,
        broker_qty=broker_qty,
        platform_qty=platform_qty,
        upcoming_action=upcoming_action,
        volume_divergence=volume_divergence,
        days_held=days_held,
        unrealized_pnl_pct=unrealized_pnl_pct,
        stale=stale,
        no_data=no_data,
        horizon_sessions=settings.swing_review_after_sessions,
    )
    result = decide(inputs)

    stored_bar_ts = bar_ts.to_pydatetime() if bar_ts is not None else session_open_dt(as_of)

    stmt = pg_insert(PositionEvaluation).values(
        user_id=position.user_id,
        position_id=position.id,
        as_of=as_of,
        bar_ts=stored_bar_ts,
        close=close,
        high=high,
        low=low,
        stop_level=result.stop_level,
        trail_level=result.trail_level,
        target_1=position.frozen_target_1,
        target_2=position.frozen_target_2,
        supertrend_dir=supertrend_dir,
        atr=atr,
        verdict=result.verdict,
        reasons=result.reasons,
        warnings=result.warnings,
        unrealized_pnl_pct=unrealized_pnl_pct,
        days_held=days_held,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_position_eval",
        set_={c: stmt.excluded[c] for c in _UPSERT_SET_COLS},
    )
    session.execute(stmt)

    position.last_evaluated_on = as_of
    position.last_verdict = result.verdict

    return session.scalar(
        select(PositionEvaluation).where(
            PositionEvaluation.position_id == position.id,
            PositionEvaluation.as_of == as_of,
        )
    )


def evaluate_all(
    session: Session, as_of: date | None = None, user_id: int | None = None
) -> dict:
    """Restate and evaluate every open position as of `as_of` (default: the
    last trading day). Each position is isolated in its own try/except and
    committed independently, so one bad position can't block the rest."""
    from app.positions.restate import restate_for_actions  # lazy: written in parallel

    as_of = as_of or last_trading_day()

    stmt = select(Position).where(Position.status == "open")
    if user_id is not None:
        stmt = stmt.where(Position.user_id == user_id)
    positions = list(session.scalars(stmt))

    evaluated = 0
    by_verdict: dict[str, int] = {}
    errors: list[dict] = []

    for position in positions:
        try:
            restate_for_actions(session, position, as_of)
            row = evaluate_position(session, position, as_of)
            session.commit()
            evaluated += 1
            by_verdict[row.verdict] = by_verdict.get(row.verdict, 0) + 1
        except Exception as e:
            session.rollback()
            logger.exception("Evaluation failed for position %s", position.id)
            errors.append({"position_id": position.id, "error": str(e)})

    return {
        "as_of": as_of,
        "evaluated": evaluated,
        "by_verdict": by_verdict,
        "errors": errors,
    }
