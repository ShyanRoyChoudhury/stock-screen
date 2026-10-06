"""Step 5 tests: bhavcopy reconcile rules, gating, signal holds, scheduler
recheck wiring. Pure/fake only: no database, no network."""

from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import pytest

from app import settings_store
from app.config import settings
from app.ingest import reconcile as rc
from app.ingest import reconcile_service as rs
from app.ingest.bhavcopy import eq_row, parse_bhavcopy
from app.market_calendar import IST
from scripts import daily_sync, scheduler_tick

FIXTURE = Path(__file__).parent / "fixtures" / "bhavcopy_20261001_sample.csv"

BHAV = {"OpnPric": 100.0, "HghPric": 110.0, "LwPric": 90.0, "ClsPric": 105.0,
        "LastPric": 106.0, "TtlTradgVol": 1_000_000}


# --- helpers ---------------------------------------------------------------

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


# --- gating --------------------------------------------------------------

def test_reconcile_active_only_for_fyers():
    assert rc.reconcile_active("fyers") is True
    assert rc.reconcile_active("yfinance") is False


def test_run_reconcile_is_a_noop_on_yfinance(monkeypatch):
    monkeypatch.setattr(settings, "price_source", "yfinance")
    # no session passed and none opened: would raise if it touched the DB
    monkeypatch.setattr(rs, "SessionLocal", lambda: pytest.fail("opened a DB session"))
    out = rs.run_reconcile(date(2026, 10, 1))
    assert out["skipped"] is True
    assert out["message"] == "reconcile skipped: price_source is yfinance"
    assert out["fail"] == out["pending"] == out["patched"] == 0


def test_daily_sync_reconcile_step_is_ok_on_yfinance(monkeypatch):
    monkeypatch.setattr(settings, "price_source", "yfinance")
    monkeypatch.setattr(daily_sync, "run_reconcile", rs.run_reconcile)
    monkeypatch.setattr(rs, "SessionLocal", lambda: pytest.fail("opened a DB session"))
    res = daily_sync._step_reconcile(date(2026, 10, 1), None, [])
    assert res["status"] == "ok" and "skipped" in res["message"]


def test_load_held_is_empty_on_yfinance_without_touching_db(monkeypatch):
    from app.signals import service
    monkeypatch.setattr(settings, "price_source", "yfinance")
    assert service.load_held(session=None) == set()


def test_reconcile_step_sits_after_ingest_before_indicators():
    order = daily_sync.STEP_ORDER
    assert order.index("ingest") < order.index("reconcile") < order.index("indicators")
    assert daily_sync.parse_steps("signals,reconcile") == ["reconcile", "signals"]


def test_reconcile_step_warns_on_fail_or_pending(monkeypatch):
    base = {"skipped": False, "pass": 5, "fail": 0, "pending": 0, "patched": 1, "worst": []}
    monkeypatch.setattr(daily_sync, "run_reconcile", lambda d, s: base)
    assert daily_sync._step_reconcile(date(2026, 10, 1), None, [])["status"] == "ok"
    monkeypatch.setattr(daily_sync, "run_reconcile", lambda d, s: dict(base, fail=1))
    assert daily_sync._step_reconcile(date(2026, 10, 1), None, [])["status"] == "warning"


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
    return marks


def test_recheck_is_built():
    assert scheduler_tick.RECHECK_BUILT is True


def test_recheck_due_runs_reconcile_and_signals_and_records(monkeypatch, sched):
    monkeypatch.setattr(settings, "price_source", "fyers")
    calls = []
    monkeypatch.setattr(daily_sync, "main", lambda argv=None: calls.append(argv) or 0)
    scheduler_tick.tick()
    assert calls == [["--steps", "reconcile,signals"]]
    assert sched == [("recheck_last_run", date(2026, 10, 1))]


def test_recheck_records_last_run_even_when_it_raises(monkeypatch, sched):
    monkeypatch.setattr(settings, "price_source", "fyers")

    def boom(argv=None):
        raise RuntimeError("x")
    monkeypatch.setattr(daily_sync, "main", boom)
    scheduler_tick.tick()
    assert sched == [("recheck_last_run", date(2026, 10, 1))]


def test_recheck_dry_run_runs_nothing(monkeypatch, sched):
    monkeypatch.setattr(settings, "price_source", "fyers")
    monkeypatch.setattr(daily_sync, "main", lambda argv=None: pytest.fail("ran"))
    scheduler_tick.tick(dry_run=True)
    assert sched == []


def test_recheck_is_a_noop_on_yfinance_but_still_recorded(monkeypatch, sched):
    monkeypatch.setattr(settings, "price_source", "yfinance")
    monkeypatch.setattr(daily_sync, "main", lambda argv=None: pytest.fail("ran"))
    scheduler_tick.tick()
    assert sched == [("recheck_last_run", date(2026, 10, 1))]


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
