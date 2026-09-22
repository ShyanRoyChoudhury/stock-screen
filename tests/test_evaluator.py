"""Unit tests for the pure rule engine in app.positions.evaluator.

No DB: only decide() and chandelier_since() are exercised, against synthetic
inputs / synthetic OHLCV frames.
"""

from datetime import date

import pandas as pd
import pytest

from app.indicators.core import calc_atr
from app.market_calendar import IST
from app.positions.evaluator import EvalInputs, chandelier_since, decide

DEFAULT_HORIZON = 30


def _inputs(**overrides) -> EvalInputs:
    """EvalInputs with a neutral baseline (no rule fires, verdict HOLD).
    Tests override only the fields relevant to the rule under test."""
    base = dict(
        close=100.0,
        high=101.0,
        low=99.0,
        bar_date=date(2026, 9, 22),
        as_of=date(2026, 9, 22),
        frozen_stop=90.0,
        frozen_target_1=110.0,
        frozen_target_2=120.0,
        is_unmatched=False,
        trail=80.0,
        supertrend_dir=1,
        atr=2.0,
        demerger_in_window=False,
        qty_mismatch=False,
        broker_qty=None,
        platform_qty=None,
        upcoming_action=None,
        volume_divergence=False,
        days_held=5,
        unrealized_pnl_pct=0.05,
        stale=False,
        no_data=False,
        horizon_sessions=DEFAULT_HORIZON,
    )
    base.update(overrides)
    return EvalInputs(**base)


# ---- decide() --------------------------------------------------------------

def test_stop_hit_exits():
    i = _inputs(close=85.0, frozen_stop=90.0, trail=70.0)

    result = decide(i)

    assert result.verdict == "EXIT"
    assert result.reasons == [
        {"code": "STOP_HIT", "detail": "close 85.0 < stop 90.0"}
    ]
    assert result.stop_level == 90.0


def test_supertrend_flip_exits():
    i = _inputs(close=100.0, frozen_stop=90.0, trail=80.0, supertrend_dir=-1)

    result = decide(i)

    assert result.verdict == "EXIT"
    assert {"code": "SUPERTREND_FLIP", "detail": None} in result.reasons


def test_trail_hit_for_unmatched_uses_trail_as_stop_level():
    # Unmatched positions have no frozen signal stop: the effective stop
    # level IS the trail, so breaching the trail also reads as a stop hit.
    i = _inputs(
        close=85.0,
        is_unmatched=True,
        frozen_stop=999.0,  # must be ignored -- unmatched
        trail=90.0,
        supertrend_dir=1,
    )

    result = decide(i)

    assert result.verdict == "EXIT"
    assert result.stop_level == 90.0
    assert result.trail_level == 90.0
    codes = [r["code"] for r in result.reasons]
    assert "TRAIL_HIT" in codes


def test_t1_hit_is_partial():
    i = _inputs(close=112.0, frozen_target_1=110.0, frozen_target_2=120.0)

    result = decide(i)

    assert result.verdict == "PARTIAL"
    assert result.reasons == [{"code": "T1_HIT", "detail": None}]


def test_t2_hit_exits_and_also_reports_t1():
    i = _inputs(close=125.0, frozen_target_1=110.0, frozen_target_2=120.0)

    result = decide(i)

    assert result.verdict == "EXIT"
    codes = [r["code"] for r in result.reasons]
    assert codes == ["T2_HIT", "T1_HIT"]


def test_demerger_review_takes_precedence_over_stop_hit():
    i = _inputs(close=50.0, frozen_stop=90.0, trail=40.0, demerger_in_window=True)

    result = decide(i)

    assert result.verdict == "REVIEW"
    codes = [r["code"] for r in result.reasons]
    assert codes[0] == "DEMERGER_CLIFF"
    assert "STOP_HIT" in codes  # still recorded, just doesn't win precedence


def test_low_breach_is_a_warning_only_verdict_stays_hold():
    i = _inputs(close=95.0, low=88.0, frozen_stop=90.0, trail=80.0)

    result = decide(i)

    assert result.verdict == "HOLD"
    assert result.reasons == []
    assert result.warnings == [{"code": "LOW_BREACH", "detail": None}]


def test_stale_bar_warning():
    i = _inputs(stale=True, bar_date=date(2026, 9, 18))

    result = decide(i)

    assert result.verdict == "HOLD"
    assert {"code": "STALE_BAR", "detail": "bar_date 2026-09-18"} in result.warnings


def test_upcoming_action_warning():
    i = _inputs(upcoming_action="split ex 2026-10-01: 1:2")

    result = decide(i)

    assert result.verdict == "HOLD"
    assert result.warnings == [{
        "code": "UPCOMING_ACTION",
        "detail": "split ex 2026-10-01: 1:2; broker may cancel your GTT; "
                  "re-place the stop after the ex-date",
    }]


def test_horizon_warning_at_31_days_but_not_at_30():
    at_horizon = decide(_inputs(days_held=30, horizon_sessions=30))
    past_horizon = decide(_inputs(days_held=31, horizon_sessions=30))

    assert at_horizon.verdict == "HOLD"
    assert {"code": "HORIZON", "detail": None} not in at_horizon.warnings

    assert past_horizon.verdict == "HOLD"
    assert {"code": "HORIZON", "detail": None} in past_horizon.warnings


def test_no_data_returns_review():
    i = _inputs(no_data=True)

    result = decide(i)

    assert result.verdict == "REVIEW"
    assert result.reasons == [{"code": "NO_DATA", "detail": None}]
    assert result.warnings == []
    assert result.stop_level is None
    assert result.trail_level is None


# ---- chandelier_since() -----------------------------------------------------

def _synthetic_ohlcv(n: int = 40) -> pd.DataFrame:
    """n-bar frame with a rising-then-falling high (peak at bar 19)."""
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz=IST)
    highs = [100.0 + i if i <= 19 else 100.0 + 19 - (i - 19) for i in range(n)]
    highs = pd.Series(highs, index=idx)
    lows = highs - 2.0
    closes = highs - 1.0
    opens = highs - 1.5
    volume = pd.Series(1000, index=idx)
    return pd.DataFrame({
        "open": opens, "high": highs, "low": lows, "close": closes,
        "volume": volume,
    })


def test_chandelier_since_never_decreases_and_matches_full_history_atr():
    df = _synthetic_ohlcv(40)
    entry_ts = df.index[15]  # past the ~10-bar ATR warm-up, still pre-peak

    trail = chandelier_since(df, entry_ts, atr_multiple=2.5)

    # Never trails down.
    diffs = trail.diff().dropna()
    assert (diffs >= -1e-9).all()

    # Matches cummax(high) - 2.5*ATR at the last bar, with ATR computed on
    # the FULL frame (not re-derived from the since-entry slice, which
    # would carry warm-up garbage from a shorter EWM history).
    atr_full = calc_atr(df)
    since = df[df.index >= entry_ts]
    expected_last = (since["high"].cummax() - 2.5 * atr_full.loc[since.index]).cummax().iloc[-1]

    assert trail.iloc[-1] == pytest.approx(expected_last)
