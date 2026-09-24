"""Unit tests for the pure matching logic in app.positions.matcher.

No DB: only score_candidates (and the Candidate/Match dataclasses) are
exercised. Candidate.ts is built from app.market_calendar.session_open_dt so
every signal date lines up with a real tz-aware 09:15 IST candle start, and
all dates below (2026-09-15 .. 2026-09-25) are plain trading-day weekdays
with no NSE holiday in between, so sessions_between()/shift_sessions() give
predictable, easy-to-hand-check session counts.
"""

from datetime import date

import pandas as pd

from app.market_calendar import session_open_dt
from app.positions.matcher import Candidate, bounded_structural_factor, score_candidates

FILL_DATE = date(2026, 9, 22)  # Tuesday


def _cand(strategy: str, sig_date: date, entry: float = 100.0, **overrides) -> Candidate:
    fields = dict(
        strategy=strategy,
        ts=session_open_dt(sig_date),
        entry=entry,
        stop_loss=entry * 0.95,
        target_1=entry * 1.05,
        target_2=entry * 1.10,
        details={},
    )
    fields.update(overrides)
    return Candidate(**fields)


def test_event_like_beats_confluence_at_equal_price_and_recency():
    sig_date = date(2026, 9, 21)  # 1 session before the fill
    confluence = _cand("Confluence", sig_date)
    event = _cand("S1_ST_Flip", sig_date)

    match = score_candidates(100.0, FILL_DATE, [confluence, event])

    assert match is not None
    assert match.strategy == "S1_ST_Flip"


def test_gap_over_max_pct_is_rejected():
    # entry=100, fill=106 -> 6% gap, over the 5% default ceiling.
    candidates = [_cand("S1_ST_Flip", date(2026, 9, 21), entry=100.0)]

    match = score_candidates(106.0, FILL_DATE, candidates)

    assert match is None


def test_two_event_like_candidates_differing_only_in_recency_newer_wins():
    older = _cand("S1_ST_Flip", date(2026, 9, 15))  # 5 sessions before fill
    newer = _cand("S1_ST_Flip", date(2026, 9, 21))  # 1 session before fill

    match = score_candidates(100.0, FILL_DATE, [older, newer])

    assert match is not None
    assert match.ts == newer.ts


def test_score_threshold_accepts_at_0_5_rejects_just_below():
    # Confluence (strategy_w=0.5) at the 5-session recency edge (recency=0),
    # so score = 0.5*price_prox + 0.15. price_prox=0.7 (gap=1.5%) lands
    # exactly on the 0.5 floor; price_prox=0.68 (gap=1.6%) lands at 0.49.
    sig_date = date(2026, 9, 15)  # sessions_between(sig_date, FILL_DATE) == 5

    at_threshold = score_candidates(
        101.5, FILL_DATE, [_cand("Confluence", sig_date, entry=100.0)]
    )
    just_below = score_candidates(
        101.6, FILL_DATE, [_cand("Confluence", sig_date, entry=100.0)]
    )

    assert at_threshold is not None
    assert round(at_threshold.confidence, 2) == 0.5
    assert just_below is None


def test_candidates_after_fill_date_are_ignored():
    # Even a perfect price match doesn't count if the signal postdates the fill.
    future = _cand("S1_ST_Flip", date(2026, 9, 23), entry=100.0)

    match = score_candidates(100.0, FILL_DATE, [future])

    assert match is None


def test_match_confidence_and_reason_formatting():
    # Mirrors the worked example from the spec: entry=100, fill 1.2% away,
    # signal 2 sessions before the fill (recency=0.6).
    sig_date = date(2026, 9, 18)
    candidates = [_cand("S1_ST_Flip", sig_date, entry=100.0)]

    match = score_candidates(101.2, FILL_DATE, candidates)

    assert match is not None
    assert match.confidence == 0.8
    assert match.reason == "S1_ST_Flip @2026-09-18, fill 1.2% from entry"


def _actions_df() -> pd.DataFrame:
    # A past bonus (already effective) and a future split (published early,
    # not yet effective on any `as_of` before its ex-date).
    return pd.DataFrame(
        [
            {
                "action_type": "bonus",
                "ex_date": date(2026, 6, 24),
                "value": None,
                "price_factor": 0.5,
            },
            {
                "action_type": "split",
                "ex_date": date(2026, 10, 5),
                "value": None,
                "price_factor": 0.1,
            },
        ]
    )


def test_bounded_structural_factor_excludes_future_action():
    # as_of is before the split's ex-date, so only the bonus applies.
    factor = bounded_structural_factor(
        _actions_df(), when=date(2026, 6, 1), as_of=date(2026, 9, 22)
    )

    assert factor == 0.5


def test_bounded_structural_factor_includes_action_once_effective():
    # as_of is now past the split's ex-date, so both actions apply.
    factor = bounded_structural_factor(
        _actions_df(), when=date(2026, 6, 1), as_of=date(2026, 10, 10)
    )

    assert factor == 0.05


def test_bounded_structural_factor_when_after_bonus_before_split():
    # `when` is after the bonus's ex-date (so it doesn't apply going
    # forward from `when`), and the split isn't effective yet either.
    factor = bounded_structural_factor(
        _actions_df(), when=date(2026, 7, 1), as_of=date(2026, 9, 22)
    )

    assert factor == 1.0


def test_bounded_structural_factor_empty_frame_returns_one():
    empty = pd.DataFrame(columns=["action_type", "ex_date", "value", "price_factor"])

    factor = bounded_structural_factor(empty, when=date(2026, 6, 1), as_of=date(2026, 9, 22))

    assert factor == 1.0
