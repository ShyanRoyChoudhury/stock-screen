"""scripts/cutover_to_fyers.py with fakes only (no DB, no Fyers)."""

from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest

from app.ingest import service
from app.ingest.fyers_fetcher import FyersFetchError
from app.ingest.fyers_session import FyersLoginRequired
from app.market_calendar import IST
from scripts import cutover_to_fyers as cut


# --- resumable selection (pure) -------------------------------------------

def test_plan_rebuild_skips_only_fully_fyers_symbols():
    rows = [
        ("DONE", "1d", 10, 0), ("DONE", "1h", 50, 0), ("DONE", "4h", 20, 0),
        ("OLDYF", "1d", 10, 10), ("OLDYF", "1h", 50, 50), ("OLDYF", "4h", 20, 20),
        ("MIXED", "1d", 10, 0), ("MIXED", "1h", 50, 3), ("MIXED", "4h", 20, 0),
        ("NOHOURLY", "1d", 10, 0),
        ("NODAILY", "1h", 5, 0), ("NODAILY", "4h", 2, 0),
    ]
    syms = ["DONE", "OLDYF", "MIXED", "NOHOURLY", "NODAILY", "NEW"]
    todo, done = cut.plan_rebuild(syms, rows)
    assert done == ["DONE"]
    assert todo == ["OLDYF", "MIXED", "NOHOURLY", "NODAILY", "NEW"]


def test_request_estimate():
    reqs, secs = cut.request_estimate(500)
    assert reqs == 500 * 13
    assert secs == pytest.approx(reqs / cut.settings.fyers_rps)


# --- main() with fakes ----------------------------------------------------

class FakeSess:
    def __init__(self, log):
        self.log = log

    def __enter__(self): return self
    def __exit__(self, *a): return False
    def commit(self): self.log.append("commit")
    def rollback(self): self.log.append("rollback")


@pytest.fixture
def env(monkeypatch):
    e = SimpleNamespace(log=[], rebuilt=[], cfg={"daily_job_enabled": False},
                        login_ok=True, fail={}, login_lost_at=None, computed=0,
                        grouped=[])
    syms = [SimpleNamespace(id=i, symbol=n) for i, n in enumerate("ABC", 1)]
    monkeypatch.setattr(cut, "assert_schema_current", lambda eng: None)
    monkeypatch.setattr(cut, "SessionLocal", lambda: FakeSess(e.log))
    monkeypatch.setattr(cut.settings_store, "get_all", lambda s: e.cfg)

    class F:
        @classmethod
        def from_session(cls, s):
            if not e.login_ok:
                raise FyersLoginRequired()
            return cls()
    monkeypatch.setattr(cut, "FyersFetcher", F)
    monkeypatch.setattr(cut, "load_symbols",
                        lambda s, only: [x for x in syms if not only or x.symbol in only])
    monkeypatch.setattr(cut, "load_grouped_rows", lambda s: e.grouped)
    monkeypatch.setattr(cut, "signal_counts", lambda s: {"1h": 1, "4h": 2, "1d": 3})

    def rebuild(session, sym, fetcher, today):
        if sym.symbol == e.login_lost_at:
            raise FyersLoginRequired()
        if sym.symbol in e.fail:
            raise e.fail[sym.symbol]
        e.rebuilt.append(sym.symbol)
        return 7
    monkeypatch.setattr(cut, "rebuild_symbol_history", rebuild)

    def compute(day, symbols):
        e.computed += 1
        return [{"step": "indicators", "status": "ok", "message": "m"},
                {"step": "signals", "status": "ok", "message": "m"}]
    monkeypatch.setattr(cut, "_run_compute_steps", compute)
    return e


def test_refuses_when_daily_job_enabled(env):
    env.cfg = {"daily_job_enabled": True}
    assert cut.main([]) == 3
    assert env.rebuilt == []
    assert cut.main(["--allow-scheduler"]) == 0


def test_not_logged_in_exits_2(env, capsys):
    env.login_ok = False
    assert cut.main([]) == 2
    assert "Log in to Fyers on the Admin page, then rerun" in capsys.readouterr().out
    assert env.rebuilt == []


def test_login_lost_mid_run_stops_with_exit_2(env, capsys):
    env.login_lost_at = "B"
    assert cut.main([]) == 2
    out = capsys.readouterr().out
    assert env.rebuilt == ["A"] and env.computed == 0
    assert "after 1 of 3" in out and "rerun to resume" in out
    assert "rollback" in env.log


def test_symbol_failure_continues_and_exits_nonzero(env, capsys):
    env.fail = {"A": FyersFetchError("boom")}
    assert cut.main([]) == 1
    assert env.rebuilt == ["B", "C"]
    assert env.computed == 0  # not recomputed after failures
    assert env.log.count("rollback") == 1
    assert "FAILED A: boom" in capsys.readouterr().out


def test_compute_anyway_runs_compute_but_still_exits_nonzero(env):
    env.fail = {"A": RuntimeError("x")}
    assert cut.main(["--compute-anyway"]) == 1
    assert env.computed == 1


def test_all_ok_computes_and_exits_0(env, capsys):
    assert cut.main([]) == 0
    assert env.rebuilt == ["A", "B", "C"] and env.computed == 1
    assert "signal counts (before -> after)" in capsys.readouterr().out


def test_resume_skips_done_and_limit_applies(env):
    env.grouped = [("A", "1d", 1, 0), ("A", "1h", 1, 0), ("A", "4h", 1, 0)]
    assert cut.main(["--limit", "1"]) == 0
    assert env.rebuilt == ["B"]


def test_dry_run_touches_nothing(env, capsys):
    assert cut.main(["--dry-run"]) == 0
    out = capsys.readouterr().out
    assert env.rebuilt == [] and env.computed == 0
    assert "commit" not in env.log and "rollback" not in env.log
    assert "3 to rebuild" in out and "39 requests" in out


# --- rebuild_symbol_history: fetch first, wipe after ----------------------

def _frame(idx):
    return pd.DataFrame({"open": [1.0] * len(idx), "high": [2.0] * len(idx),
                         "low": [0.5] * len(idx), "close": [1.5] * len(idx),
                         "volume": [10.0] * len(idx)},
                        index=pd.DatetimeIndex(idx))


class SeqFetcher:
    def __init__(self, fail_on=None):
        self.calls, self.fail_on = [], fail_on

    def fetch_bars(self, symbol, interval, start, end=None):
        self.calls.append(interval)
        if interval == self.fail_on:
            raise FyersFetchError("fetch failed")
        if interval == "1d":
            return _frame([pd.Timestamp("2026-10-01", tz=IST)])
        return _frame([pd.Timestamp("2026-10-01 09:15", tz=IST),
                       pd.Timestamp("2026-10-01 10:15", tz=IST)])


@pytest.fixture
def writes(monkeypatch):
    w = SimpleNamespace(events=[])
    monkeypatch.setattr(service, "_wipe_symbol",
                        lambda s, sid: w.events.append("wipe"))
    monkeypatch.setattr(
        service, "upsert_candles",
        lambda s, sid, tf, df, source, basis: w.events.append(f"upsert:{tf}") or len(df))
    monkeypatch.setattr(service, "resample_1h_to_4h", lambda h: h.iloc[:1])
    return w


@pytest.mark.parametrize("fail_on", ["1d", "60m"])
def test_rebuild_fetch_error_leaves_data_untouched(writes, fail_on):
    with pytest.raises(FyersFetchError):
        service.rebuild_symbol_history(
            None, SimpleNamespace(id=1, symbol="A"), SeqFetcher(fail_on), date(2026, 10, 5))
    assert writes.events == []  # no wipe, no insert


def test_rebuild_fetches_everything_then_wipes_then_writes(writes):
    f = SeqFetcher()
    n = service.rebuild_symbol_history(
        None, SimpleNamespace(id=1, symbol="A"), f, date(2026, 10, 5))
    assert sorted(f.calls) == ["1d", "60m"]
    assert writes.events == ["wipe", "upsert:1h", "upsert:4h", "upsert:1d"]
    assert n == 2 + 1 + 1


class EmptyFetcher(SeqFetcher):
    def __init__(self, empty_on):
        super().__init__()
        self.empty_on = empty_on

    def fetch_bars(self, symbol, interval, start, end=None):
        df = super().fetch_bars(symbol, interval, start, end)
        return df.iloc[0:0] if interval == self.empty_on else df


@pytest.mark.parametrize("empty_on", ["1d", "60m"])
def test_rebuild_empty_fetch_never_wipes(writes, empty_on):
    # A renamed/delisted symbol or a Fyers outage returns no bars: the stored
    # history must survive rather than be replaced with nothing.
    with pytest.raises(FyersFetchError, match="no (daily|hourly) bars"):
        service.rebuild_symbol_history(
            None, SimpleNamespace(id=1, symbol="A"), EmptyFetcher(empty_on), date(2026, 10, 5))
    assert writes.events == []
