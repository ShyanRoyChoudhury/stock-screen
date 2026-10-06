"""Step 5 tests: bhavcopy reconcile rules, gating, signal holds, scheduler
recheck wiring. Pure/fake only: no database, no network."""

import logging
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from app import settings_store
from app.ingest import reconcile as rc
from app.ingest import reconcile_service as rs
from app.ingest.bhavcopy import eq_row, parse_bhavcopy
from app.market_calendar import IST
from app.models import BarCheck, Symbol
from app.signals import service as signals_service
from scripts import daily_sync, scheduler_tick

FIXTURE = Path(__file__).parent / "fixtures" / "bhavcopy_20261001_sample.csv"

BHAV = {"OpnPric": 100.0, "HghPric": 110.0, "LwPric": 90.0, "ClsPric": 105.0,
        "LastPric": 106.0, "TtlTradgVol": 1_000_000}


# --- helpers ---------------------------------------------------------------

def ist_at(day: int, hh: int, mm: int = 0) -> datetime:
    """A tz-aware IST clock reading on 2026-10-`day` (Wed 10-07 is a session;
    Fri 10-02 is an NSE holiday)."""
    return datetime(2026, 10, day, hh, mm, tzinfo=IST)


def daily_bar(**kw):
    bar = {"open": 100.0, "high": 110.0, "low": 90.0, "close": 105.0,
           "volume": 1_000_000}
    bar.update(kw)
    return bar


def hourly(n=7, open_=100.0, high=110.0, low=90.0, last_close=106.0,
           vol_total=1_000_000, last_high=None, last_low=None):
    """n bars on 2026-10-01; extremes sit in the first bar, so the last bar's
    own high/low can be set independently."""
    ts = [datetime(2026, 10, 1, 9, 15, tzinfo=IST) + pd.Timedelta(hours=i)
          for i in range(n)]
    df = pd.DataFrame({
        "open": [open_] + [100.0] * (n - 1),
        "high": [high] + [101.0] * (n - 1),
        "low": [low] + [99.0] * (n - 1),
        "close": [100.0] * (n - 1) + [last_close],
        "volume": [vol_total / n] * n,
    }, index=pd.DatetimeIndex(ts))
    if last_high is not None:
        df.iloc[-1, df.columns.get_loc("high")] = last_high
    if last_low is not None:
        df.iloc[-1, df.columns.get_loc("low")] = last_low
    return df


# --- daily rules ---------------------------------------------------------

def test_daily_exact_match_passes():
    r = rc.check_daily(daily_bar(), BHAV)
    assert r.status == "pass" and r.note is None and r.bar_count == 1


@pytest.mark.parametrize("field,bhav_key", [
    ("open", "OpnPric"), ("high", "HghPric"), ("low", "LwPric"), ("close", "ClsPric")])
def test_daily_price_tolerance_edges(field, bhav_key):
    base = BHAV[bhav_key]
    assert rc.check_daily(daily_bar(**{field: base + 0.05}), BHAV).status == "pass"
    assert rc.check_daily(daily_bar(**{field: base - 0.05}), BHAV).status == "pass"
    r = rc.check_daily(daily_bar(**{field: base + 0.06}), BHAV)
    assert r.status == "fail" and field in r.note
    assert rc.check_daily(daily_bar(**{field: base - 0.06}), BHAV).status == "fail"


def test_daily_volume_must_match_exactly():
    assert rc.check_daily(daily_bar(volume=1_000_000), BHAV).status == "pass"
    r = rc.check_daily(daily_bar(volume=999_999), BHAV)
    assert r.status == "fail" and "volume" in r.note
    assert rc.check_daily(daily_bar(volume=1_000_001), BHAV).status == "fail"


def test_daily_missing_bar_or_bhav_row_fails():
    assert rc.check_daily(None, BHAV).status == "fail"
    r = rc.check_daily(daily_bar(), None)
    assert r.status == "fail" and r.note == "not in bhavcopy"


# --- hourly rules ---------------------------------------------------------

def test_hourly_clean_day_passes_without_patch():
    r = rc.check_hourly(hourly(last_close=106.0), BHAV)
    assert r.status == "pass" and r.patch is None and r.note is None
    assert r.bar_count == 7


@pytest.mark.parametrize("delta,expected", [(0.05, "pass"), (-0.05, "pass"),
                                            (0.06, "fail"), (-0.06, "fail")])
def test_hourly_high_low_open_tolerance(delta, expected):
    assert rc.check_hourly(hourly(high=110.0 + delta), BHAV).status == expected
    assert rc.check_hourly(hourly(low=90.0 + delta), BHAV).status == expected
    assert rc.check_hourly(hourly(open_=100.0 + delta), BHAV).status == expected


def test_hourly_bar_count_must_be_seven():
    assert rc.check_hourly(hourly(n=7), BHAV).status == "pass"
    for n in (6, 8):
        r = rc.check_hourly(hourly(n=n), BHAV)
        assert r.status == "fail" and "bars" in r.note and r.bar_count == n


def test_hourly_bar_count_rule_can_be_skipped_for_special_sessions():
    assert rc.check_hourly(hourly(n=2), BHAV, expected_bars=None).status == "pass"


@pytest.mark.parametrize("pct,expected", [(-5.0, "pass"), (-5.1, "fail"),
                                          (2.0, "pass"), (2.1, "fail"), (0.0, "pass")])
def test_hourly_volume_bounds(pct, expected):
    r = rc.check_hourly(hourly(vol_total=1_000_000 * (1 + pct / 100)), BHAV)
    assert r.status == expected
    assert r.vol_diff_pct == pytest.approx(pct, abs=1e-6)


def test_hourly_empty_or_missing_bhav_fails():
    assert rc.check_hourly(hourly().iloc[0:0], BHAV).status == "fail"
    assert rc.check_hourly(None, BHAV).status == "fail"
    assert rc.check_hourly(hourly(), None).note == "not in bhavcopy"


# --- last close patch -------------------------------------------------------

def test_close_within_tick_of_lastpric_is_not_patched():
    assert rc.check_hourly(hourly(last_close=106.05), BHAV).patch is None


def test_close_mismatch_is_patched_and_still_passes():
    r = rc.check_hourly(hourly(last_close=105.0), BHAV)
    assert r.status == "pass" and r.note == "close patched"
    assert r.patch == {"close": 106.0, "high": 106.0, "low": 99.0}
    assert r.close_diff == pytest.approx(-1.0)


def test_patch_widens_high_when_lastpric_above_bar_high():
    # last bar high 105.5, LastPric 106 -> high widens to 106
    r = rc.check_hourly(hourly(last_close=105.0, last_high=105.5, last_low=104.0), BHAV)
    assert r.patch["close"] == 106.0 and r.patch["high"] == 106.0
    assert r.patch["low"] == 104.0


def test_patch_widens_low_when_lastpric_below_bar_low():
    bhav = dict(BHAV, LastPric=98.0)
    r = rc.check_hourly(hourly(last_close=100.0, last_high=101.0, last_low=99.0), bhav)
    assert r.patch == {"close": 98.0, "high": 101.0, "low": 98.0}


def test_patch_keeps_bar_range_when_lastpric_inside_it():
    bhav = dict(BHAV, LastPric=100.5)
    r = rc.check_hourly(hourly(last_close=100.0, last_high=101.0, last_low=99.0), bhav)
    assert r.patch == {"close": 100.5, "high": 101.0, "low": 99.0}


def test_no_patch_on_a_failed_day():
    # close is off AND the day's high is off: fail wins, nothing patched
    r = rc.check_hourly(hourly(last_close=105.0, high=111.0), BHAV)
    assert r.status == "fail" and r.patch is None and r.note != "close patched"
    r = rc.check_hourly(hourly(n=6, last_close=105.0), BHAV)
    assert r.status == "fail" and r.patch is None


# --- bhavcopy fixture parsing --------------------------------------------

@pytest.fixture(scope="module")
def bhav_frame():
    return parse_bhavcopy(FIXTURE.read_bytes())


def test_eq_row_parses_real_bhavcopy(bhav_frame):
    row = eq_row(bhav_frame, "RELIANCE")
    assert row["SctySrs"] == "EQ"
    assert row["OpnPric"] == 1180.10 and row["HghPric"] == 1183.90
    assert row["LwPric"] == 1160.80 and row["ClsPric"] == 1167.70
    assert row["LastPric"] == 1167.70 and row["TtlTradgVol"] == 16771221


def test_eq_row_unknown_symbol_and_none_frame(bhav_frame):
    assert eq_row(bhav_frame, "NOSUCH") is None
    assert eq_row(None, "RELIANCE") is None


def test_eq_row_falls_back_to_be_and_bz_series(bhav_frame):
    assert eq_row(bhav_frame, "3IINFOLTD")["SctySrs"] == "BE"
    assert eq_row(bhav_frame, "AGSTRA")["SctySrs"] == "BZ"


def test_eq_row_prefers_eq_when_symbol_has_several_series():
    df = pd.DataFrame({"TckrSymb": ["X", "X"], "SctySrs": ["BE", "EQ"],
                       "OpnPric": [1.0, 2.0]}).set_index("TckrSymb")
    assert eq_row(df, "X")["SctySrs"] == "EQ"


def test_real_row_drives_the_rules(bhav_frame):
    row = eq_row(bhav_frame, "RELIANCE")
    bar = {"open": 1180.10, "high": 1183.90, "low": 1160.80, "close": 1167.70,
           "volume": 16771221}
    assert rc.check_daily(bar, row).status == "pass"
    assert rc.check_daily(dict(bar, volume=16771220), row).status == "fail"


def test_reconcile_step_sits_after_ingest_before_indicators():
    order = daily_sync.STEP_ORDER
    assert order.index("ingest") < order.index("reconcile") < order.index("indicators")
    assert daily_sync.parse_steps("signals,reconcile") == ["reconcile", "signals"]


def test_reconcile_step_warns_on_fail_or_pending(monkeypatch):
    base = {"day": "2026-10-01", "pass": 5, "fail": 0, "pending": 0, "patched": 1,
            "worst": []}
    monkeypatch.setattr(daily_sync, "run_reconcile", lambda d, s: base)
    assert daily_sync._step_reconcile(date(2026, 10, 1), None, [])["status"] == "ok"
    monkeypatch.setattr(daily_sync, "run_reconcile", lambda d, s: dict(base, fail=1))
    assert daily_sync._step_reconcile(date(2026, 10, 1), None, [])["status"] == "warning"


def test_reconcile_step_message_names_the_checked_day(monkeypatch):
    # A morning run is asked for Wed 10-07 but checks Tue 10-06: the message
    # reports what was checked (result["day"]), not what was requested.
    result = {"day": "2026-10-06", "pass": 1000, "fail": 0, "pending": 0,
              "patched": 3, "worst": []}
    monkeypatch.setattr(daily_sync, "run_reconcile", lambda d, s: result)
    step = daily_sync._step_reconcile(date(2026, 10, 7), None, [])
    assert step["message"] == "checked 2026-10-06: 1000 pass, 0 fail, 0 pending, 3 close-patched"
    assert step["detail"]["day"] == "2026-10-06"


# --- signal-hold selection --------------------------------------------------

CUTOFF = date(2026, 9, 3)


def test_held_pairs_selects_fail_and_pending_in_window_only():
    rows = [
        (1, "1d", date(2026, 10, 1), "fail"),
        (2, "1h", date(2026, 10, 1), "pending"),
        (3, "1d", date(2026, 10, 1), "pass"),
        (4, "1d", date(2026, 9, 2), "fail"),   # before cutoff
        (5, "1h", CUTOFF, "fail"),             # on cutoff: inside
    ]
    assert rc.held_pairs(rows, CUTOFF) == {(1, "1d"), (2, "1h"), (5, "1h")}


def test_held_pairs_latest_day_ignores_rows_after_it():
    latest = date(2026, 10, 6)
    rows = [
        (1, "1d", latest, "pending"),                # on latest_day: inside
        (2, "1h", date(2026, 10, 7), "pending"),     # the session that hasn't closed
        (3, "1d", date(2026, 10, 7), "fail"),
        (4, "1d", date(2026, 10, 5), "fail"),
        (5, "1h", CUTOFF, "fail"),                   # on cutoff: inside
        (6, "1d", date(2026, 9, 2), "fail"),         # before cutoff
        (7, "1d", date(2026, 10, 5), "pass"),
    ]
    assert rc.held_pairs(rows, CUTOFF, latest_day=latest) == {
        (1, "1d"), (4, "1d"), (5, "1h")}
    # Omitted: unchanged (backward compatible), later rows count.
    assert rc.held_pairs(rows, CUTOFF) == {
        (1, "1d"), (2, "1h"), (3, "1d"), (4, "1d"), (5, "1h")}
    assert rc.held_pairs(rows, CUTOFF, latest_day=None) == rc.held_pairs(rows, CUTOFF)


def test_held_window_anchors_on_the_last_closed_session_not_today(monkeypatch):
    monkeypatch.setattr(signals_service.settings, "signal_check_lookback_sessions", 3)
    # Wed 10-07 morning: Wed hasn't closed -> anchor Tue 10-06, window Thu 10-01
    # .. Tue 10-06 (3 sessions; Fri 10-02 is a holiday).
    assert signals_service.held_window(ist_at(7, 8, 30)) == (date(2026, 10, 1),
                                                           date(2026, 10, 6))
    # After the close the anchor is today.
    assert signals_service.held_window(ist_at(7, 19, 0)) == (date(2026, 10, 5),
                                                           date(2026, 10, 7))
    # Lookback 1 -> the window is the anchor session alone.
    monkeypatch.setattr(signals_service.settings, "signal_check_lookback_sessions", 1)
    assert signals_service.held_window(ist_at(7, 8, 30)) == (date(2026, 10, 6),
                                                           date(2026, 10, 6))


def test_held_window_default_now_is_the_ist_clock(monkeypatch):
    monkeypatch.setattr(signals_service.settings, "signal_check_lookback_sessions", 1)
    monkeypatch.setattr("app.market_calendar.now_ist", lambda: ist_at(7, 0, 13))
    assert signals_service.held_window() == (date(2026, 10, 6), date(2026, 10, 6))


class _FakeHeldSession:
    """Just enough Session for signals.service.load_held: records the
    statement, answers `.execute(stmt).all()` with canned bar_checks rows."""

    def __init__(self, rows):
        self.rows, self.stmts = list(rows), []

    def execute(self, stmt):
        self.stmts.append(stmt)
        return SimpleNamespace(all=lambda: list(self.rows))


def test_load_held_ignores_rows_for_a_session_that_has_not_closed(monkeypatch):
    # The morning-catch-up scenario: Wed 10-07 08:30, an older run left
    # 'pending' rows for Wed. They must hold nothing.
    monkeypatch.setattr(signals_service.settings, "signal_check_lookback_sessions", 3)
    monkeypatch.setattr(signals_service, "last_closed_session",
                        lambda now=None: date(2026, 10, 6))
    rows = [
        (1, "1d", date(2026, 10, 7), "pending"),   # unclosed session: ignored
        (1, "1h", date(2026, 10, 7), "pending"),
        (2, "1h", date(2026, 10, 6), "pending"),   # the anchor session: held
        (3, "1d", date(2026, 10, 1), "fail"),      # on the cutoff: held
        (4, "1d", date(2026, 9, 30), "fail"),      # before the cutoff
        (5, "1h", date(2026, 10, 6), "pass"),
    ]
    session = _FakeHeldSession(rows)
    assert signals_service.load_held(session) == {(2, "1h"), (3, "1d")}

    # The query itself is bounded on both sides, so the DB never returns the
    # unclosed session's rows (the Python filter is the second line of defence).
    (stmt,) = session.stmts
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "bar_checks.day >= '2026-10-01'" in sql
    assert "bar_checks.day <= '2026-10-06'" in sql
    assert "bar_checks.status IN ('fail', 'pending')" in sql


def test_load_held_after_the_close_includes_todays_rows(monkeypatch):
    monkeypatch.setattr(signals_service.settings, "signal_check_lookback_sessions", 3)
    monkeypatch.setattr(signals_service, "last_closed_session",
                        lambda now=None: date(2026, 10, 7))
    rows = [(1, "1d", date(2026, 10, 7), "pending"),
            (2, "1h", date(2026, 10, 8), "pending")]   # tomorrow's: ignored
    assert signals_service.load_held(_FakeHeldSession(rows)) == {(1, "1d")}


def test_is_held_maps_4h_to_the_1h_check():
    held = {(1, "1d"), (2, "1h")}
    assert rc.is_held(held, 1, "1d") and not rc.is_held(held, 1, "1h")
    assert not rc.is_held(held, 1, "4h")
    assert rc.is_held(held, 2, "1h") and rc.is_held(held, 2, "4h")
    assert not rc.is_held(held, 2, "1d")
    assert not rc.is_held(set(), 1, "1d")


def test_select_targets_newest_day_plus_open_rows():
    t = rs.select_targets(date(2026, 10, 1), {1, 2}, [
        (3, date(2026, 9, 28), "1h", "pending"),
        (1, date(2026, 9, 30), "1d", "fail"),
    ])
    assert t[date(2026, 10, 1)] == {(1, "1d"), (1, "1h"), (2, "1d"), (2, "1h")}
    assert t[date(2026, 9, 28)] == {(3, "1h")}
    # 09-30 is the previous session, which ingest always re-fetches, so it
    # is covered in full (not just by the open fail row).
    assert t[date(2026, 9, 30)] == {(1, "1d"), (1, "1h"), (2, "1d"), (2, "1h")}


def test_refetched_days_overlap_spans_weekend():
    # Mon 2026-10-12: ingest's last stored candle was Fri 10-09, so overlap 2
    # starts Wed 10-07 -> Wed, Thu, Fri, Mon (weekend skipped).
    assert rs.refetched_days(date(2026, 10, 12), 2) == [
        date(2026, 10, 7), date(2026, 10, 8), date(2026, 10, 9), date(2026, 10, 12)]
    # Wed 2026-10-07: previous session Tue 10-06, overlap 2 -> from Sun 10-04.
    assert rs.refetched_days(date(2026, 10, 7), 2) == [
        date(2026, 10, 5), date(2026, 10, 6), date(2026, 10, 7)]
    # overlap 0: previous session and newest only.
    assert rs.refetched_days(date(2026, 10, 12), 0) == [
        date(2026, 10, 9), date(2026, 10, 12)]


def test_select_targets_covers_overlap_days_for_all_symbols():
    t = rs.select_targets(date(2026, 10, 12), {1, 2}, [], overlap_days=2)
    full = {(1, "1d"), (1, "1h"), (2, "1d"), (2, "1h")}
    for d in (date(2026, 10, 7), date(2026, 10, 8), date(2026, 10, 9), date(2026, 10, 12)):
        assert t[d] == full
    assert date(2026, 10, 10) not in t


# --- which session a run checks: never one that hasn't closed ---------------

def test_check_day_default_before_the_close_is_the_previous_session():
    # Wed 10-07 08:30 (a catch-up run after a missed login the night before)
    # and 00:13 (the observed run that wrote pending rows for the day).
    assert rs.check_day(None, ist_at(7, 8, 30)) == date(2026, 10, 6)
    assert rs.check_day(None, ist_at(7, 0, 13)) == date(2026, 10, 6)
    assert rs.check_day(None, ist_at(7, 15, 29)) == date(2026, 10, 6)


def test_check_day_explicit_today_before_the_close_is_clamped(caplog):
    # daily_sync passes day=today on a trading day, whatever the time.
    with caplog.at_level(logging.INFO, logger=rs.logger.name):
        assert rs.check_day(date(2026, 10, 7), ist_at(7, 8, 30)) == date(2026, 10, 6)
    assert "session 2026-10-07 has not closed yet; checking 2026-10-06" in caplog.text


def test_check_day_explicit_future_day_is_clamped_to_the_newest_closed_session():
    assert rs.check_day(date(2026, 10, 9), ist_at(7, 19, 0)) == date(2026, 10, 7)


def test_check_day_explicit_past_day_is_unchanged(caplog):
    now = ist_at(7, 8, 30)
    with caplog.at_level(logging.INFO, logger=rs.logger.name):
        assert rs.check_day(date(2026, 10, 6), now) == date(2026, 10, 6)  # the newest closed
        assert rs.check_day(date(2026, 9, 25), now) == date(2026, 9, 25)  # older
        assert rs.check_day(date(2026, 10, 3), now) == date(2026, 10, 3)  # a non-session day, as given
    assert "has not closed yet" not in caplog.text


def test_check_day_default_after_the_close_is_today():
    assert rs.check_day(None, ist_at(7, 15, 30)) == date(2026, 10, 7)
    assert rs.check_day(None, ist_at(7, 19, 0)) == date(2026, 10, 7)
    assert rs.check_day(date(2026, 10, 7), ist_at(7, 19, 0)) == date(2026, 10, 7)


def test_check_day_weekend_and_holiday_runs_check_the_last_session():
    assert rs.check_day(None, ist_at(10, 10, 0)) == date(2026, 10, 9)   # Sat -> Fri
    assert rs.check_day(None, ist_at(2, 10, 0)) == date(2026, 10, 1)    # Gandhi Jayanti -> Thu


@pytest.mark.parametrize("requested,expected", [
    (None, date(2026, 10, 6)),
    (date(2026, 10, 7), date(2026, 10, 6)),
    (date(2026, 10, 1), date(2026, 10, 1)),
])
def test_run_reconcile_hands_the_checked_day_to_the_run(monkeypatch, requested, expected):
    """run_reconcile -> _run gets check_day(day, now_ist()), not day-or-today."""
    seen = []
    monkeypatch.setattr(rs, "_run", lambda session, day, symbols: seen.append(day) or {})
    monkeypatch.setattr(rs, "now_ist", lambda: ist_at(7, 8, 30))
    rs.run_reconcile(requested, None, session=object())  # a passed session is not closed
    assert seen == [expected]


# --- change tracking: what the recheck regenerates -------------------------

@pytest.mark.parametrize("prev,new,patched,resolved,changed", [
    ("pending", "pass", False, True, True),    # bhavcopy arrived: hold lifts
    ("fail", "pass", False, True, True),       # ingest re-fetch corrected the day
    ("pending", "pass", True, True, True),     # resolved AND patched
    ("pass", "pass", True, False, True),       # new close patch, no transition
    (None, "pass", True, False, True),
    ("pass", "pass", False, False, False),     # steady state
    (None, "pass", False, False, False),       # first check of a row: nothing was held
    ("pending", "pending", False, False, False),
    ("pending", "fail", False, False, False),  # still held
    ("fail", "fail", False, False, False),
    ("fail", "pending", False, False, False),
    ("pass", "fail", False, False, False),     # held rows are skipped by signals
    ("pass", "pending", False, False, False),
])
def test_resolved_and_changed_classification(prev, new, patched, resolved, changed):
    assert rs.is_resolved(prev, new) is resolved
    assert rs.classify_change(prev, new, patched) is changed


class _FakeRunSession:
    """Just enough Session for reconcile_service._run: answers the two
    selects it issues itself (symbols, open bar_checks rows), counts commits."""

    def __init__(self, symbols, open_rows=()):
        self.symbols, self.open_rows, self.commits = symbols, list(open_rows), 0

    def execute(self, stmt):
        entity = stmt.column_descriptions[0]["entity"]
        if entity is Symbol:
            return iter(self.symbols)
        if entity is BarCheck:
            return iter(self.open_rows)
        raise AssertionError(f"unexpected statement: {stmt}")

    def commit(self):
        self.commits += 1


DAY, PREV_DAY = date(2026, 10, 1), date(2026, 9, 30)
SYMBOLS = [(1, "AAA"), (2, "BBB"), (3, "CCC"), (4, "DDD")]
TARGETS = {DAY: {(sid, tf) for sid in (1, 2, 3) for tf in ("1d", "1h")},
           PREV_DAY: {(4, "1h")}}


def _run_with_fakes(monkeypatch, prev, results, published=True, open_rows=(),
                    targets=TARGETS):
    """rs._run with the DB, network and calendar-dependent targets faked out:
    only the transition bookkeeping is real. `open_rows` are the pending/fail
    bar_checks rows the fake session returns; `targets=None` runs the real
    select_targets over them instead of the fixed TARGETS. -> (summary,
    session, upserts, patched symbol ids)."""
    upserts, patches = [], []
    session = _FakeRunSession(SYMBOLS, open_rows)
    if targets is not None:
        monkeypatch.setattr(rs, "select_targets", lambda *a, **k: targets)
    monkeypatch.setattr(rs, "fetch_bhavcopy", lambda d: object() if published else None)
    monkeypatch.setattr(rs, "_load_day_candles", lambda s, d, ids: {})
    monkeypatch.setattr(rs, "_load_prev_checks", lambda s, d, ids: prev.get(d, {}))
    monkeypatch.setattr(rs, "eq_row", lambda b, name: {"SctySrs": "EQ", "name": name})
    monkeypatch.setattr(rs, "evaluate",
                        lambda tf, bars, row, expected: results[(row["name"], tf)])
    monkeypatch.setattr(rs, "_apply_patch", lambda s, sid, bars, patch: patches.append(sid))
    monkeypatch.setattr(rs, "_upsert_check",
                        lambda s, sid, d, tf, res: upserts.append(
                            (sid, d, tf, res.status, res.note)))
    return rs._run(session, DAY, None), session, upserts, patches


def test_run_counts_resolved_rows_and_lists_changed_symbols(monkeypatch):
    prev = {
        DAY: {(1, "1d"): ("pending", rc.NOTE_NO_BHAV),   # resolved
            (1, "1h"): ("pending", rc.NOTE_NO_BHAV),   # resolved
            (2, "1d"): ("pass", None),                 # unchanged
            (2, "1h"): ("pass", rc.NOTE_PATCHED),      # unchanged, note carried over
            (3, "1d"): ("fail", "close +0.50"),        # still failing
            (3, "1h"): ("pass", None)},                # freshly patched
        PREV_DAY: {(4, "1h"): ("fail", "bars 6!=7")},    # resolved, an older day
    }
    results = {
        ("AAA", "1d"): rc.CheckResult(rc.PASS), ("AAA", "1h"): rc.CheckResult(rc.PASS),
        ("BBB", "1d"): rc.CheckResult(rc.PASS), ("BBB", "1h"): rc.CheckResult(rc.PASS),
        ("CCC", "1d"): rc.CheckResult(rc.FAIL, "close +0.50"),
        ("CCC", "1h"): rc.CheckResult(rc.PASS, rc.NOTE_PATCHED,
                                      patch={"close": 1.0, "high": 1.0, "low": 1.0}),
        ("DDD", "1h"): rc.CheckResult(rc.PASS),
    }
    summary, session, upserts, patches = _run_with_fakes(monkeypatch, prev, results)

    assert summary["resolved"] == 3  # AAA 1d, AAA 1h, DDD 1h (a day older than `day`)
    assert summary["changed_symbols"] == ["AAA", "CCC", "DDD"]  # sorted; BBB untouched
    assert summary["patched"] == 1 and patches == [3]
    assert (summary["pass"], summary["fail"], summary["pending"]) == (6, 1, 0)
    assert summary["worst"] == [f"CCC 1d {DAY}: close +0.50"]
    assert (2, DAY, "1h", "pass", rc.NOTE_PATCHED) in upserts  # earlier patch note kept
    assert session.commits == 2  # one per day


def test_run_steady_state_changes_nothing(monkeypatch):
    prev = {DAY: {(sid, tf): ("pass", None) for sid in (1, 2, 3) for tf in ("1d", "1h")},
            PREV_DAY: {(4, "1h"): ("pass", None)}}
    results = {(name, tf): rc.CheckResult(rc.PASS)
               for _, name in SYMBOLS for tf in ("1d", "1h")}
    summary, _, _, patches = _run_with_fakes(monkeypatch, prev, results)
    assert summary["resolved"] == 0 and summary["changed_symbols"] == []
    assert summary["pass"] == 7 and patches == []


def test_run_unpublished_bhavcopy_resolves_nothing(monkeypatch):
    prev = {DAY: {(sid, tf): ("pending", rc.NOTE_NO_BHAV)
                for sid in (1, 2, 3) for tf in ("1d", "1h")}}
    summary, _, upserts, _ = _run_with_fakes(monkeypatch, prev, {}, published=False)
    assert summary["pending"] == 7 and summary["pass"] == 0
    assert summary["resolved"] == 0 and summary["changed_symbols"] == []
    assert {u[3] for u in upserts} == {"pending"}


def test_run_leaves_open_rows_after_the_checked_day_alone(monkeypatch):
    """A catch-up run before the close checks the PREVIOUS session (DAY here).
    Open rows an older run wrote for a later session -- the one that hasn't
    closed -- are neither re-checked nor rewritten; older open rows still are."""
    monkeypatch.setattr(rs.settings, "incremental_overlap_days", 0)
    later = date(2026, 10, 5)  # the session after DAY (Fri 10-02 is a holiday)
    older = date(2026, 9, 24)
    open_rows = (
        [(sid, later, tf, "pending") for sid in (1, 2, 3, 4) for tf in ("1d", "1h")]
        + [(1, later, "1d", "fail")]
        + [(4, older, "1h", "pending")]
    )
    results = {(name, tf): rc.CheckResult(rc.PASS)
               for _, name in SYMBOLS for tf in ("1d", "1h")}
    summary, session, upserts, _ = _run_with_fakes(
        monkeypatch, {}, results, open_rows=open_rows, targets=None)

    days = {u[1] for u in upserts}
    assert later not in days and max(days) == DAY
    # DAY and the previous session (ingest's re-fetch window), plus the older
    # open row's day: every active symbol x 1d/1h on the first two, one key on it.
    assert days == {older, PREV_DAY, DAY}
    assert len(upserts) == 8 + 8 + 1
    assert session.commits == 3
    assert summary["day"] == str(DAY)
    assert summary["pending"] == 0 and summary["pass"] == 17


@pytest.mark.parametrize("now,expected_days", [
    # The reported bug: a manual run at Wed 08:30 (daily_sync passes day=today
    # on a trading day) used to treat Wed as the newest session, find no
    # bhavcopy and write every symbol x 1d/1h 'pending' for it.
    (ist_at(7, 8, 30), {date(2026, 10, 5), date(2026, 10, 6)}),
    (ist_at(7, 0, 13), {date(2026, 10, 5), date(2026, 10, 6)}),
    # After the close the same call legitimately checks (and, bhavcopy not out
    # yet, marks pending) today: the evening run is unchanged.
    (ist_at(7, 19, 0), {date(2026, 10, 5), date(2026, 10, 6), date(2026, 10, 7)}),
])
def test_run_reconcile_never_writes_rows_for_a_session_that_has_not_closed(
        monkeypatch, now, expected_days):
    monkeypatch.setattr(rs.settings, "incremental_overlap_days", 2)
    monkeypatch.setattr(rs, "now_ist", lambda: now)
    monkeypatch.setattr(rs, "fetch_bhavcopy", lambda d: None)  # nothing published
    upserts = []
    monkeypatch.setattr(rs, "_upsert_check",
                        lambda s, sid, d, tf, res: upserts.append((sid, d, tf, res.status)))
    session = _FakeRunSession(SYMBOLS)

    summary = rs.run_reconcile(date(2026, 10, 7), session=session)

    assert {u[1] for u in upserts} == expected_days
    assert summary["day"] == str(max(expected_days))
    assert {u[3] for u in upserts} == {"pending"}
    assert len(upserts) == len(expected_days) * len(SYMBOLS) * 2  # every symbol x 1d/1h


def test_run_keeps_open_rows_up_to_and_including_the_checked_day(monkeypatch):
    monkeypatch.setattr(rs.settings, "incremental_overlap_days", 0)
    open_rows = [(4, DAY, "1d", "pending"), (4, date(2026, 9, 24), "1d", "fail")]
    prev = {DAY: {(4, "1d"): ("pending", rc.NOTE_NO_BHAV)},
            date(2026, 9, 24): {(4, "1d"): ("fail", "close +0.50")}}
    results = {(name, tf): rc.CheckResult(rc.PASS)
               for _, name in SYMBOLS for tf in ("1d", "1h")}
    summary, _, upserts, _ = _run_with_fakes(
        monkeypatch, prev, results, open_rows=open_rows, targets=None)
    assert (4, date(2026, 9, 24), "1d", "pass", None) in upserts
    assert summary["resolved"] == 2  # the pending row on DAY and the old fail row
    assert summary["changed_symbols"] == ["DDD"]


# --- scheduler recheck wiring ----------------------------------------------

class _FakeSession:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def sched(monkeypatch):
    now = datetime(2026, 10, 1, 21, 0, tzinfo=IST)
    cfg = {"daily_job_time": "19:00", "recheck_time": "20:30",
           "daily_job_enabled": True,
           "daily_job_last_run": "2026-10-01", "recheck_last_run": None}
    marks = []
    monkeypatch.setattr(scheduler_tick, "now_ist", lambda: now)
    monkeypatch.setattr(scheduler_tick, "is_trading_day", lambda d: True)
    monkeypatch.setattr(scheduler_tick, "SessionLocal", lambda: _FakeSession())
    monkeypatch.setattr(settings_store, "get_all", lambda s: cfg)
    monkeypatch.setattr(settings_store, "get_date",
                        lambda c, k: date.fromisoformat(c[k]) if c.get(k) else None)
    monkeypatch.setattr(settings_store, "set_last_run",
                        lambda s, k, d: marks.append((k, d)))
    # Guards: the real reconcile needs the DB and the real daily_sync writes to
    # it, so a test that forgets to fake them fails instead of touching it.
    monkeypatch.setattr(rs, "run_reconcile",
                        lambda *a, **k: pytest.fail("real run_reconcile called"))
    monkeypatch.setattr(daily_sync, "main",
                        lambda argv=None: pytest.fail("real daily_sync.main called"))
    return marks


def _summary(changed, **kw):
    s = {"day": "2026-10-01", "pass": 998, "fail": 2, "pending": 0, "patched": 1,
         "resolved": len(changed), "changed_symbols": list(changed), "worst": []}
    s.update(kw)
    return s


def _fake_reconcile(summary, calls):
    def run_reconcile(*args, **kwargs):
        calls.append((args, kwargs))
        return summary
    return run_reconcile


def test_run_recheck_regenerates_signals_only_for_changed_symbols(monkeypatch):
    rcalls, dcalls = [], []
    monkeypatch.setattr(rs, "run_reconcile",
                        _fake_reconcile(_summary(["ABB", "M&M", "TCS"]), rcalls))
    monkeypatch.setattr(daily_sync, "main", lambda argv=None: dcalls.append(argv) or 1)

    assert scheduler_tick.run_recheck() == 1  # daily_sync's exit code comes back
    assert rcalls == [((), {})]  # default day, every active symbol
    assert dcalls == [["--steps", "signals", "--symbols", "ABB,M&M,TCS"]]
    # ... and that argv is one daily_sync's own parser understands.
    args = daily_sync.build_parser().parse_args(dcalls[0])
    assert daily_sync.parse_steps(args.steps) == ["signals"]
    assert daily_sync._parse_symbols(args.symbols) == ["ABB", "M&M", "TCS"]


def test_run_recheck_nothing_changed_skips_signals(monkeypatch, caplog):
    rcalls = []
    monkeypatch.setattr(rs, "run_reconcile", _fake_reconcile(_summary([]), rcalls))
    monkeypatch.setattr(daily_sync, "main",
                        lambda argv=None: pytest.fail("signals regenerated"))
    with caplog.at_level(logging.INFO, logger="scheduler_tick"):
        assert scheduler_tick.run_recheck() == 0
    assert len(rcalls) == 1
    assert "recheck: nothing changed, signals not regenerated" in caplog.text


def test_recheck_due_regenerates_signals_for_changed_and_records(monkeypatch, sched):
    dcalls = []
    monkeypatch.setattr(rs, "run_reconcile", _fake_reconcile(_summary(["AAA", "BBB"]), []))
    monkeypatch.setattr(daily_sync, "main", lambda argv=None: dcalls.append(argv) or 0)
    scheduler_tick.tick()
    assert dcalls == [["--steps", "signals", "--symbols", "AAA,BBB"]]
    assert sched == [("recheck_last_run", date(2026, 10, 1))]


def test_recheck_due_nothing_changed_still_records_last_run(monkeypatch, sched):
    monkeypatch.setattr(rs, "run_reconcile", _fake_reconcile(_summary([]), []))
    monkeypatch.setattr(daily_sync, "main",
                        lambda argv=None: pytest.fail("signals regenerated"))
    scheduler_tick.tick()
    assert sched == [("recheck_last_run", date(2026, 10, 1))]


def test_recheck_records_last_run_even_when_signals_raise(monkeypatch, sched):

    def boom(argv=None):
        raise RuntimeError("x")
    monkeypatch.setattr(rs, "run_reconcile", _fake_reconcile(_summary(["AAA"]), []))
    monkeypatch.setattr(daily_sync, "main", boom)
    scheduler_tick.tick()
    assert sched == [("recheck_last_run", date(2026, 10, 1))]


def test_recheck_records_last_run_even_when_reconcile_raises(monkeypatch, sched):

    def boom(*args, **kwargs):
        raise RuntimeError("x")
    monkeypatch.setattr(rs, "run_reconcile", boom)
    scheduler_tick.tick()  # daily_sync.main stays guarded: signals must not run
    assert sched == [("recheck_last_run", date(2026, 10, 1))]


def test_recheck_dry_run_runs_nothing(monkeypatch, sched):
    scheduler_tick.tick(dry_run=True)  # both guards would fail the test if hit
    assert sched == []


# --- 4h follows the 1h patch ---------------------------------------------

def test_apply_patch_updates_1h_and_recomputes_4h(monkeypatch):
    calls = {}
    monkeypatch.setattr(
        rs, "upsert_candles",
        lambda session, sid, tf, df, source, basis: calls.update(
            sid=sid, tf=tf, df=df, source=source))

    class Sess:
        def __init__(self):
            self.stmts = []

        def execute(self, stmt):
            self.stmts.append(stmt)

    bars = hourly(last_close=105.0, last_high=105.5, last_low=104.0)
    patch = rc.check_hourly(bars, BHAV).patch
    sess = Sess()
    rs._apply_patch(sess, 7, bars, patch)

    assert len(sess.stmts) == 1  # the UPDATE of the stored last 1h bar
    assert calls["tf"] == "4h" and calls["sid"] == 7 and calls["source"] == "fyers"
    four_h = calls["df"]
    assert len(four_h) == 2  # 09:15 bin and 13:15 bin
    last_bin = four_h.iloc[-1]
    assert last_bin["close"] == 106.0   # patched close flows into the 4h bar
    assert last_bin["high"] == 106.0    # widened high flows through
