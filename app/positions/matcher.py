"""Matches a broker fill to the strategy signal that likely produced it.

Candles are stored split/bonus-adjusted ("splits_only"); broker fills are RAW
prices in the share terms of their own trade date. A fill is first restated
into stored terms (fill_price_in_stored_terms, via
app.indicators.adjust.structural_factor_after) so it is comparable to a
Signal's entry price, then scored against nearby '1d' signals purely on
price proximity, strategy type (event-like vs. state-like Confluence) and
recency (score_candidates).

score_candidates is PURE (no DB) so it is unit-testable in isolation; the
DB-touching functions below it are thin wrappers that load the inputs and
call it.
"""

from dataclasses import dataclass
from datetime import date, datetime

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.indicators.adjust import structural_factor_after
from app.market_calendar import (
    IST,
    last_trading_day,
    session_close_dt,
    session_open_dt,
    sessions_between,
    shift_sessions,
)
from app.models import CorporateAction, Position, Signal

# Strategies that fire on a discrete event (a breakout, a flip, a squeeze
# firing) rather than describing ongoing state. Confluence fires on most
# bars, so it is weighted lower as a match candidate.
EVENT_STRATEGIES = frozenset(
    {"PIPELINE", "S1_ST_Flip", "S2_MACD_Zero", "S3_BB_Squeeze", "TTM_Squeeze"}
)

_SCORE_EPS = 1e-9


@dataclass(frozen=True)
class Candidate:
    strategy: str
    ts: datetime
    entry: float
    stop_loss: float
    target_1: float
    target_2: float
    details: dict


@dataclass(frozen=True)
class Match:
    strategy: str
    ts: datetime
    confidence: float
    reason: str
    entry: float
    stop_loss: float
    target_1: float
    target_2: float
    details: dict


def _beats(score: float, is_event: bool, ts: datetime, current: tuple) -> bool:
    """True when a new (score, is_event, ts) candidate outranks the current
    winner. Scores within _SCORE_EPS are treated as tied: event-like beats
    state-like, then the later signal wins."""
    cur_score, cur_is_event, cur_ts = current[0], current[1], current[2]
    if abs(score - cur_score) > _SCORE_EPS:
        return score > cur_score
    if is_event != cur_is_event:
        return is_event
    return ts > cur_ts


def score_candidates(
    fill_stored: float,
    fill_date: date,
    candidates: list[Candidate],
    *,
    window_sessions: int = 5,
    max_gap_pct: float = 5.0,
) -> Match | None:
    """Pick the best-matching candidate signal for a fill, or None.

    A candidate is eligible when its signal date is on or before the fill
    date, within `window_sessions` trading sessions of it, and its entry
    price is within `max_gap_pct` percent of `fill_stored`. Eligible
    candidates are scored 0.5*price_proximity + 0.3*strategy_weight +
    0.2*recency; the highest-scoring one with score >= 0.5 wins, ties broken
    by preferring event-like strategies then the more recent signal.
    """
    winner: tuple | None = None  # (score, is_event, ts, candidate, gap, sig_date)
    for c in candidates:
        sig_date = c.ts.astimezone(IST).date()
        if sig_date > fill_date:
            continue
        if sessions_between(sig_date, fill_date) > window_sessions:
            continue
        gap = abs(fill_stored - c.entry) / c.entry * 100
        if gap > max_gap_pct:
            continue

        price_prox = 1 - gap / max_gap_pct
        is_event = c.strategy in EVENT_STRATEGIES
        strategy_w = 1.0 if is_event else 0.5
        recency = 1 - sessions_between(sig_date, fill_date) / window_sessions
        score = 0.5 * price_prox + 0.3 * strategy_w + 0.2 * recency
        if score < 0.5:
            continue

        if winner is None or _beats(score, is_event, c.ts, winner):
            winner = (score, is_event, c.ts, c, gap, sig_date)

    if winner is None:
        return None

    score, _is_event, _ts, c, gap, sig_date = winner
    reason = f"{c.strategy} @{sig_date.isoformat()}, fill {gap:.1f}% from entry"
    return Match(
        strategy=c.strategy,
        ts=c.ts,
        confidence=round(score, 4),
        reason=reason,
        entry=c.entry,
        stop_loss=c.stop_loss,
        target_1=c.target_1,
        target_2=c.target_2,
        details=c.details,
    )


def load_actions_df(session: Session, symbol_id: int) -> pd.DataFrame:
    """Corporate actions for `symbol_id` as a DataFrame with the columns
    structural_factor_after expects. Empty (but correctly shaped) frame
    when there are none."""
    cols = ["action_type", "ex_date", "value", "price_factor"]
    rows = session.execute(
        select(
            CorporateAction.action_type,
            CorporateAction.ex_date,
            CorporateAction.value,
            CorporateAction.price_factor,
        ).where(CorporateAction.symbol_id == symbol_id)
    ).all()
    if not rows:
        return pd.DataFrame(columns=cols)
    return pd.DataFrame(rows, columns=cols)


def bounded_structural_factor(
    actions_df: pd.DataFrame, when: date, as_of: date
) -> float:
    """structural_factor_after(when), restricted to actions already
    effective by `as_of`.

    NSE publishes a split/bonus up to ~30 days before its ex-date, and the
    daily job loads it that early, so structural_factor_after alone would
    fold in actions whose ex-date is still in the future. That is wrong
    twice over: the stored candle series only becomes adjusted for the
    action from its ex-date onward, so an unbounded factor would put a fill
    out of step with the series until then; and restate_for_actions folds
    every action with last_restated_on < ex_date <= up_to as its ex-date
    arrives, so the same action would be applied a second time. Dropping
    not-yet-effective rows before calling structural_factor_after avoids
    both.
    """
    if actions_df.empty:
        return structural_factor_after(actions_df, when)
    bounded = actions_df[actions_df["ex_date"] <= as_of]
    return structural_factor_after(bounded, when)


def fill_price_in_stored_terms(
    session: Session,
    symbol_id: int,
    fill_price_raw: float,
    fill_date: date,
    as_of: date | None = None,
) -> tuple[float, float]:
    """Restate a raw broker fill into the candle series' stored
    (splits_only) terms. Returns (fill_stored, factor).

    Only actions already effective by `as_of` (default: the last trading
    day) are folded in — see bounded_structural_factor for why a
    not-yet-effective action must be excluded here."""
    as_of = as_of or last_trading_day()
    actions_df = load_actions_df(session, symbol_id)
    factor = bounded_structural_factor(actions_df, fill_date, as_of)
    return fill_price_raw * factor, factor


def fetch_candidates(
    session: Session, symbol_id: int, fill_date: date, window_sessions: int
) -> list[Candidate]:
    """'1d' Signal rows within `window_sessions` trading sessions before
    (and including) `fill_date`, as Candidates."""
    start = shift_sessions(fill_date, -window_sessions)
    rows = session.scalars(
        select(Signal).where(
            Signal.symbol_id == symbol_id,
            Signal.timeframe == "1d",
            Signal.ts >= session_open_dt(start),
            Signal.ts <= session_close_dt(fill_date),
        )
    ).all()
    return [
        Candidate(
            strategy=r.strategy,
            ts=r.ts,
            entry=r.entry,
            stop_loss=r.stop_loss,
            target_1=r.target_1,
            target_2=r.target_2,
            details=r.details or {},
        )
        for r in rows
    ]


def match_signal(
    session: Session, symbol_id: int, fill_price_raw: float, fill_date: date
) -> Match | None:
    """Restate a raw fill and match it against nearby signals, using the
    match window/gap tolerance from app.config.settings."""
    fill_stored, _factor = fill_price_in_stored_terms(
        session, symbol_id, fill_price_raw, fill_date
    )
    window = settings.match_window_sessions
    candidates = fetch_candidates(session, symbol_id, fill_date, window)
    return score_candidates(
        fill_stored,
        fill_date,
        candidates,
        window_sessions=window,
        max_gap_pct=settings.match_max_price_gap_pct,
    )


def apply_match(position: Position, match: Match | None) -> None:
    """Stamp (or clear) a Position's matched-signal fields from a Match."""
    if match is None:
        position.matched_strategy = None
        position.matched_signal_ts = None
        position.matched_timeframe = "1d"
        position.match_confidence = None
        position.match_reason = None
        position.is_unmatched = True
        position.frozen_entry = None
        position.frozen_stop = None
        position.frozen_target_1 = None
        position.frozen_target_2 = None
        position.frozen_details = {}
        return

    position.matched_strategy = match.strategy
    position.matched_signal_ts = match.ts
    position.matched_timeframe = "1d"
    position.match_confidence = match.confidence
    position.match_reason = match.reason
    position.is_unmatched = False
    position.frozen_entry = match.entry
    position.frozen_stop = match.stop_loss
    position.frozen_target_1 = match.target_1
    position.frozen_target_2 = match.target_2
    position.frozen_details = dict(match.details)
