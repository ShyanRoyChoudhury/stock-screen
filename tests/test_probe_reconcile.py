"""Unit tests for the pure functions in scripts.probe_intraday_source:
aggregate_1min_to_hourly (1-min -> 7 session-anchored hourly bins) and
reconcile_day (hourly bars vs a bhavcopy row). Both are plain
DataFrame-in/dict-out functions with no I/O, so nothing here touches the
DB -- these are exactly the two pieces the plan (Step 3) later moves into
app/ingest/resample.py and app/ingest/reconcile.py. Also
compare_adjustment_basis (a Fyers pre-split bar vs bhavcopy's raw prices).
"""

from datetime import date, datetime, timedelta

import pandas as pd
import pytest

from app.market_calendar import IST
from scripts.probe_intraday_source import (
    aggregate_1min_to_hourly,
    compare_adjustment_basis,
    reconcile_day,
)

DAY = date(2026, 9, 21)  # Monday, plain trading day


# --- helpers -------------------------------------------------------------

def _ts(hh: int, mm: int) -> datetime:
    return datetime(DAY.year, DAY.month, DAY.day, hh, mm, tzinfo=IST)


def _hourly_frame(rows: list[tuple[int, int, float, float, float, float, int]]) -> pd.DataFrame:
    """rows: (hh, mm, open, high, low, close, volume)."""
    index = [_ts(hh, mm) for hh, mm, *_ in rows]
    data = {
        "open": [r[2] for r in rows], "high": [r[3] for r in rows],
        "low": [r[4] for r in rows], "close": [r[5] for r in rows],
        "volume": [r[6] for r in rows],
    }
    return pd.DataFrame(data, index=pd.DatetimeIndex(index, name="ts"))


def _pass_frame() -> pd.DataFrame:
    """7 clean hourly bars: open=100 at 09:15, day high 107, day low 99,
    last close 106.5, total volume 7000 (1000/bar)."""
    slots = [(9, 15), (10, 15), (11, 15), (12, 15), (13, 15), (14, 15), (15, 15)]
    rows = []
    for i, (hh, mm) in enumerate(slots):
        rows.append((hh, mm, 100 + i, 101 + i, 99 + i, 100.5 + i, 1000))
    return _hourly_frame(rows)


def _pass_bhav_row() -> dict:
    return {
        "OpnPric": 100.0, "HghPric": 107.0, "LwPric": 99.0,
        "LastPric": 106.5, "ClsPric": 106.6, "TtlTradgVol": 7000.0,
    }


def _minute_frame(count: int, start: datetime, extra: list[tuple[datetime, float]] = ()):
    """`count` 1-min bars starting at `start`, one per minute, each with
    open=high=low=close=volume=its offset from `start` (bar 0 -> 0, bar 1
    -> 1, ...). `extra` adds arbitrary extra (ts, value) rows (same OHLC=
    volume=value convention) -- used for the out-of-session and duplicate-
    timestamp cases."""
    index = [start + timedelta(minutes=i) for i in range(count)]
    values = list(range(count))
    for ts, v in extra:
        index.append(ts)
        values.append(v)
    data = {c: values for c in ("open", "high", "low", "close")}
    data["volume"] = values
    return pd.DataFrame(data, index=pd.DatetimeIndex(index, name="ts"))


# --- aggregate_1min_to_hourly ---------------------------------------------

def test_aggregate_full_day_produces_seven_bins_with_correct_ohlcv():
    # 375 one-minute bars, 09:15..15:29, value/volume = minute offset.
    df = _minute_frame(375, _ts(9, 15))
    out = aggregate_1min_to_hourly(df)

    assert len(out) == 7
    assert list(out.index) == [
        _ts(9, 15), _ts(10, 15), _ts(11, 15), _ts(12, 15),
        _ts(13, 15), _ts(14, 15), _ts(15, 15),
    ]
    # first bin: minutes 0-59
    first = out.loc[_ts(9, 15)]
    assert (first["open"], first["high"], first["low"], first["close"]) == (0, 59, 0, 59)
    assert first["volume"] == sum(range(0, 60))


def test_aggregate_last_bin_is_short_fifteen_minutes():
    df = _minute_frame(375, _ts(9, 15))
    out = aggregate_1min_to_hourly(df)

    last = out.loc[_ts(15, 15)]  # minutes 360-374 (15 minutes)
    assert (last["open"], last["high"], last["low"], last["close"]) == (360, 374, 360, 374)
    assert last["volume"] == sum(range(360, 375))
    # the bin before it is a full 60 minutes (345-359 -> wait 300-359)
    prev = out.loc[_ts(14, 15)]
    assert prev["volume"] == sum(range(300, 360))


def test_aggregate_drops_bars_outside_the_session():
    in_session = _minute_frame(375, _ts(9, 15))
    before_open = (_ts(9, 14), 999)
    at_close = (_ts(15, 30), 999)  # 15:30 is the boundary, not part of any bin
    df = _minute_frame(375, _ts(9, 15), extra=[before_open, at_close])
    out = aggregate_1min_to_hourly(df)

    assert len(out) == 7
    total_volume = out["volume"].sum()
    assert total_volume == in_session["volume"].sum()  # the 2 extra rows excluded


def test_aggregate_duplicate_timestamp_is_summed_into_its_bin():
    df = _minute_frame(375, _ts(9, 15))
    # A duplicate 09:20 bar (the known Fyers duplicate-09:15-family bug) --
    # de-duplication is the fetcher's job (plan Step 1); aggregation itself
    # just folds every row it's given into its bin.
    dup_ts = _ts(9, 20)
    df_with_dup = pd.concat([df, pd.DataFrame(
        {"open": [500], "high": [500], "low": [500], "close": [500], "volume": [500]},
        index=pd.DatetimeIndex([dup_ts], name="ts"),
    )])
    out = aggregate_1min_to_hourly(df_with_dup)

    assert len(out) == 7  # still 7 bins -- the duplicate lands inside bin 0
    first = out.loc[_ts(9, 15)]
    assert first["volume"] == sum(range(0, 60)) + 500
    assert first["high"] == 500  # the duplicate's inflated high wins the bin


def test_aggregate_empty_input_returns_empty_frame():
    empty = pd.DataFrame(
        columns=["open", "high", "low", "close", "volume"],
        index=pd.DatetimeIndex([], tz=IST, name="ts"),
    )
    out = aggregate_1min_to_hourly(empty)
    assert out.empty
    assert list(out.columns) == ["open", "high", "low", "close", "volume"]


# --- reconcile_day: pass case ---------------------------------------------

def test_reconcile_day_pass_case():
    result = reconcile_day(_pass_frame(), _pass_bhav_row())

    assert result["has_data"] is True
    assert result["bar_count"] == 7
    assert result["bar_count_ok"] is True
    assert result["high_ok"] is True
    assert result["low_ok"] is True
    assert result["open_ok"] is True
    assert result["last_close_ok"] is True
    assert result["vol_ok"] is True
    assert result["all_rules_pass"] is True
    assert result["duplicate_ts_count"] == 0
    assert result["zero_volume_bar_count"] == 0
    assert result["vol_share_0915"] == pytest.approx(1000 / 7000)
    assert result["vol_share_1515"] == pytest.approx(1000 / 7000)
    # ClsPric diff is informational only -- must not affect the pass rules.
    assert result["close_vs_clspric_diff"] == pytest.approx(106.5 - 106.6)


# --- reconcile_day: each rule failing, one at a time ----------------------

def test_reconcile_day_high_fails_when_beyond_one_tick():
    bhav = _pass_bhav_row()
    bhav["HghPric"] = 107.2  # actual day high is 107.0 -> 0.2 off, > 0.05 tick
    result = reconcile_day(_pass_frame(), bhav)

    assert result["high_ok"] is False
    assert result["low_ok"] is True
    assert result["all_rules_pass"] is False


def test_reconcile_day_low_fails_when_beyond_one_tick():
    bhav = _pass_bhav_row()
    bhav["LwPric"] = 98.5  # actual day low is 99.0
    result = reconcile_day(_pass_frame(), bhav)

    assert result["low_ok"] is False
    assert result["high_ok"] is True
    assert result["all_rules_pass"] is False


def test_reconcile_day_open_fails_when_beyond_one_tick():
    bhav = _pass_bhav_row()
    bhav["OpnPric"] = 101.0  # actual first-bar open is 100.0
    result = reconcile_day(_pass_frame(), bhav)

    assert result["open_ok"] is False
    assert result["all_rules_pass"] is False


def test_reconcile_day_last_close_fails_against_lastpric_not_clspric():
    bhav = _pass_bhav_row()
    bhav["LastPric"] = 110.0  # actual last-bar close is 106.5
    result = reconcile_day(_pass_frame(), bhav)

    assert result["last_close_ok"] is False
    assert result["all_rules_pass"] is False
    # ClsPric is still just informational, independent of the LastPric rule.
    assert "close_vs_clspric_diff" in result


def test_reconcile_day_volume_fails_when_beyond_one_percent():
    bhav = _pass_bhav_row()
    bhav["TtlTradgVol"] = 5000.0  # actual total volume is 7000 -> 40% off
    result = reconcile_day(_pass_frame(), bhav)

    assert result["vol_ok"] is False
    assert result["vol_diff_pct"] == pytest.approx((7000 - 5000) / 5000)
    assert result["all_rules_pass"] is False


def test_reconcile_day_bar_count_fails_when_a_bar_is_missing():
    frame = _pass_frame().iloc[:-1]  # drop the 15:15 bar -> only 6 bars
    result = reconcile_day(frame, _pass_bhav_row())

    assert result["bar_count"] == 6
    assert result["bar_count_ok"] is False
    assert result["all_rules_pass"] is False
    # the other rules are computed on whatever bars are present -- the open
    # (09:15) and day high/low are unaffected by losing the last bar here.
    assert result["open_ok"] is True


# --- reconcile_day: duplicate timestamps and edge cases -------------------

def test_reconcile_day_reports_duplicate_timestamps():
    frame = _pass_frame()
    dup_row = frame.iloc[[0]]  # duplicate the 09:15 bar
    frame_with_dup = pd.concat([frame, dup_row])
    result = reconcile_day(frame_with_dup, _pass_bhav_row())

    assert result["bar_count"] == 8
    assert result["duplicate_ts_count"] == 1
    assert result["bar_count_ok"] is False  # 8 != 7
    assert result["all_rules_pass"] is False


def test_reconcile_day_counts_zero_volume_bars():
    frame = _pass_frame().copy()
    frame.iloc[0, frame.columns.get_loc("volume")] = 0  # 09:15 bar, like Yahoo
    result = reconcile_day(frame, _pass_bhav_row())

    assert result["zero_volume_bar_count"] == 1
    assert result["vol_share_0915"] == 0.0


def test_reconcile_day_empty_frame_fails_everything_without_raising():
    empty = pd.DataFrame(
        columns=["open", "high", "low", "close", "volume"],
        index=pd.DatetimeIndex([], tz=IST, name="ts"),
    )
    result = reconcile_day(empty, _pass_bhav_row())

    assert result["has_data"] is False
    assert result["bar_count"] == 0
    assert result["all_rules_pass"] is False
    assert result["high_diff"] is None


def test_reconcile_day_missing_bhav_row_fails_without_raising():
    result = reconcile_day(_pass_frame(), None)

    assert result["has_data"] is False
    assert result["all_rules_pass"] is False


# --- compare_adjustment_basis: Fyers pre-split bar vs bhavcopy raw -----------

def test_adjustment_basis_matching_the_raw_bhavcopy_is_unadjusted():
    assert compare_adjustment_basis(200.0, 190.0, 200.0, 190.0) == "unadjusted (raw)"
    # within one tick still counts as a match
    assert compare_adjustment_basis(200.04, 189.96, 200.0, 190.0) == "unadjusted (raw)"


def test_adjustment_basis_differing_from_raw_bhavcopy_is_adjusted():
    # e.g. a 1:1 bonus: raw 200/190 became 100/95 in an adjusted series
    assert compare_adjustment_basis(100.0, 95.0, 200.0, 190.0) == (
        "adjusted (differs from bhavcopy raw)")
    # high matches but low does not -> still a miss
    assert compare_adjustment_basis(200.0, 95.0, 200.0, 190.0) == (
        "adjusted (differs from bhavcopy raw)")


def test_adjustment_basis_without_a_bhavcopy_row_is_unknown():
    assert compare_adjustment_basis(100.0, 95.0, None, None) == "unknown (no bhavcopy row)"
    assert compare_adjustment_basis(100.0, 95.0, 200.0, None) == "unknown (no bhavcopy row)"
