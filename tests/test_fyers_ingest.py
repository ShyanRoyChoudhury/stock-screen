"""Step 3: Fyers wiring in app.ingest.service. No DB, no network."""

from datetime import date, timedelta
from types import SimpleNamespace

import pandas as pd
import pytest

from app.config import settings
from app.indicators.adjust import adjustment_series, volume_factor_series
from app.ingest import service
from app.ingest.fyers_session import FyersLoginRequired
from app.market_calendar import IST

TODAY = date(2026, 10, 5)


def daily(rows: dict[str, float], bump: float = 0.0, tz=True) -> pd.DataFrame:
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in rows])
    if tz:
        idx = idx.tz_localize(IST)
    df = pd.DataFrame(
        {"open": list(rows.values()), "high": [v + 1 for v in rows.values()],
         "low": [v - 1 for v in rows.values()], "close": list(rows.values()),
         "volume": [1000.0] * len(rows)}, index=idx)
    for c in ("open", "high", "low", "close"):
        df[c] += bump
    return df


BASE = {"2026-09-30": 100.0, "2026-10-01": 101.0, "2026-10-05": 102.0}


def test_identical_not_redownloaded():
    assert service.needs_redownload(daily(BASE), daily(BASE))[0] is False


def test_off_by_ten_paise_redownloads():
    f = daily(BASE)
    f.loc[f.index[1], "close"] += 0.10
    redo, diff = service.needs_redownload(daily(BASE), f)
    assert redo and diff == pytest.approx(0.10)


def test_off_by_three_paise_ok():
    f = daily(BASE)
    f.loc[f.index[1], "high"] += 0.03
    redo, diff = service.needs_redownload(daily(BASE), f)
    assert not redo and diff == pytest.approx(0.03)


def test_today_excluded_from_overlap():
    f = daily(BASE)
    f.loc[f.index[2], "close"] += 5  # today's forming bar
    assert service.needs_redownload(daily(BASE), f, today=TODAY)[0] is False
    assert service.needs_redownload(daily(BASE), f)[0] is True


def test_only_overlapping_dates_compared():
    f = daily({"2026-10-02": 500.0})  # not stored -> no overlap
    assert service.needs_redownload(daily(BASE), f) == (False, 0.0)
    assert service.needs_redownload(daily(BASE).iloc[0:0], daily(BASE)) == (False, 0.0)


def test_stored_utc_index_aligns_with_ist_dates():
    stored = daily(BASE)
    stored.index = (stored.index + pd.Timedelta(hours=9, minutes=15)).tz_convert("UTC")
    assert service.needs_redownload(stored, daily(BASE))[0] is False


@pytest.mark.parametrize("period,expected", [
    ("5y", date(2021, 10, 5)),
    ("730d", TODAY - timedelta(days=730)),
    ("6mo", date(2026, 4, 5)),
    (" 1Y ", date(2025, 10, 5)),
])
def test_period_to_start(period, expected):
    assert service.period_to_start(period, TODAY) == expected


def test_period_to_start_rejects_junk():
    with pytest.raises(ValueError):
        service.period_to_start("max", TODAY)


def test_round_volume_rounds_not_truncates():
    df = daily(BASE)
    df["volume"] = [16771221.6, 2.5, 7.4]
    out = service.round_volume(df)
    assert list(out["volume"]) == [16771222, 2, 7]  # banker's rounding on .5
    assert out["volume"].dtype == "int64"


def test_adjust_accepts_fyers_basis():
    closes = pd.Series([1.0, 2.0], index=pd.date_range("2026-01-01", periods=2))
    acts = pd.DataFrame({"action_type": ["dividend"], "ex_date": [date(2026, 1, 2)],
                         "value": [0.1], "price_factor": [None]})
    assert (adjustment_series(closes, acts, "fyers_adjusted") == 1.0).all()
    assert (volume_factor_series(closes, acts, "fyers_adjusted") == 1.0).all()


# --- per-symbol Fyers flow with fakes -------------------------------------

class FakeFetcher:
    def __init__(self, daily_df, hourly_df, full_daily=None):
        self.calls = []
        self._d, self._h, self._fd = daily_df, hourly_df, full_daily

    def fetch_bars(self, symbol, interval, start, end=None):
        self.calls.append((interval, start))
        if interval == "1d":
            full = start == service.period_to_start(settings.daily_backfill_period, TODAY)
            return (self._fd if full and self._fd is not None else self._d).copy()
        return self._h.copy()


def hourly_df():
    idx = pd.DatetimeIndex([pd.Timestamp("2026-10-01 09:15", tz=IST),
                            pd.Timestamp("2026-10-01 10:15", tz=IST)])
    return pd.DataFrame({"open": [1.0, 2], "high": [2.0, 3], "low": [0.5, 1],
                         "close": [1.5, 2.5], "volume": [10.4, 20.6]}, index=idx)


@pytest.fixture
def rec(monkeypatch):
    r = SimpleNamespace(upserts=[], wiped=[])
    monkeypatch.setattr(service, "upsert_candles",
        lambda s, sid, tf, df, source="fyers", price_basis="x":
        r.upserts.append((tf, source, price_basis, df.copy())) or len(df))
    monkeypatch.setattr(service, "_wipe_symbol", lambda s, sid: r.wiped.append(sid))
    monkeypatch.setattr(service, "_incremental_start",
                        lambda s, sid, tf: date(2026, 9, 29))
    monkeypatch.setattr(service, "resample_1h_to_4h", lambda h: h.iloc[:1])
    r.stored = daily(BASE)
    monkeypatch.setattr(service, "_load_stored_daily", lambda s, sid, since: r.stored)
    return r


SYM = SimpleNamespace(id=7, symbol="ABC")


def test_incremental_no_redownload(rec):
    f = FakeFetcher(daily(BASE), hourly_df())
    wrote, redo = service._ingest_symbol_fyers(
        None, SYM, f, "incremental", ["1h", "4h", "1d"], TODAY)
    assert redo is None and rec.wiped == []
    assert {u[0] for u in rec.upserts} == {"1h", "4h", "1d"}
    assert all(u[1:3] == ("fyers", "fyers_adjusted") for u in rec.upserts)
    h = next(u[3] for u in rec.upserts if u[0] == "1h")
    assert list(h["volume"]) == [10, 21]
    d = next(u[3] for u in rec.upserts if u[0] == "1d")
    assert all(t.hour == 9 and t.minute == 15 for t in d.index)


def test_incremental_readjusted_triggers_full_rebuild(rec):
    shifted = daily(BASE, bump=-3.0)
    f = FakeFetcher(shifted, hourly_df(), full_daily=shifted)
    wrote, redo = service._ingest_symbol_fyers(
        None, SYM, f, "incremental", ["1d"], TODAY)
    assert redo == pytest.approx(3.0) and rec.wiped == [7]
    assert {u[0] for u in rec.upserts} == {"1h", "4h", "1d"}  # all rebuilt
    intervals = [c[0] for c in f.calls]
    assert intervals.count("1d") == 2 and "60m" in intervals


def test_hourly_only_run_never_compares_daily(rec):
    f = FakeFetcher(daily(BASE, bump=-3.0), hourly_df())
    _, redo = service._ingest_symbol_fyers(
        None, SYM, f, "incremental", ["1h"], TODAY)
    assert redo is None and [c[0] for c in f.calls] == ["60m"]


def test_backfill_never_redownloads(rec):
    f = FakeFetcher(daily(BASE, bump=-3.0), hourly_df())
    _, redo = service._ingest_symbol_fyers(None, SYM, f, "backfill", ["1d"], TODAY)
    assert redo is None and rec.wiped == []
    assert f.calls == [("1d", service.period_to_start(settings.daily_backfill_period, TODAY))]


def test_login_required_propagates(rec):
    class Boom:
        def fetch_bars(self, *a, **k):
            raise FyersLoginRequired()
    with pytest.raises(FyersLoginRequired):
        service._ingest_symbol_fyers(None, SYM, Boom(), "backfill", ["1d"], TODAY)


# --- run_ingest-level, with a fake session --------------------------------

class FakeRun:
    symbols_total = symbols_ok = symbols_failed = candles_written = 0
    status = "running"
    message = None
    finished_at = None

    def __init__(self):
        self.errors = []


class FakeSession:
    def __init__(self, run):
        self.run = run
        self.rollbacks = 0

    def get(self, model, id):
        return self.run

    def commit(self): pass
    def close(self): pass
    def rollback(self): self.rollbacks += 1


def setup_run(monkeypatch, source, syms, ingest_fn=None, fetcher=None):
    run = FakeRun()
    sess = FakeSession(run)
    monkeypatch.setattr(service, "SessionLocal", lambda: sess)
    monkeypatch.setattr(service, "_resolve_symbols", lambda s, r: syms)
    if ingest_fn:
        monkeypatch.setattr(service, "_ingest_symbol_fyers", ingest_fn)
    if fetcher is not None:
        monkeypatch.setattr(service.FyersFetcher, "from_session",
                            classmethod(lambda cls, s: fetcher))
    return run


def test_run_ingest_no_login_fails_before_loop(monkeypatch):
    def nologin(cls, s):
        raise FyersLoginRequired()
    run = setup_run(monkeypatch, "fyers", [SimpleNamespace(id=1, symbol="A")],
                    ingest_fn=lambda *a: pytest.fail("loop ran"))
    monkeypatch.setattr(service.FyersFetcher, "from_session", classmethod(nologin))
    service.run_ingest(1, "incremental", ["1d"], None)
    assert run.status == "failed" and run.message == "Fyers login needed"
    assert run.finished_at is not None


def test_run_ingest_midrun_login_loss_and_redownload_record(monkeypatch):
    syms = [SimpleNamespace(id=i, symbol=n) for i, n in enumerate("ABCD")]

    def fake(session, sym, fetcher, mode, tfs, today):
        if sym.symbol == "B":
            return 5, 2.5
        if sym.symbol == "C":
            raise FyersLoginRequired()
        return 3, None
    run = setup_run(monkeypatch, "fyers", syms, fake, fetcher=object())
    service.run_ingest(1, "incremental", ["1d"], None)
    assert run.status == "failed"
    assert run.message.startswith("Fyers login needed")
    assert "re-downloaded 1: B" in run.message
    assert run.symbols_ok == 2 and run.symbols_failed == 0  # D never attempted
    assert len(run.message) <= 512


def test_run_ingest_symbol_error_continues(monkeypatch):
    syms = [SimpleNamespace(id=i, symbol=n) for i, n in enumerate("AB")]

    def fake(session, sym, *a):
        if sym.symbol == "A":
            raise RuntimeError("boom")
        return 1, None
    run = setup_run(monkeypatch, "fyers", syms, fake, fetcher=object())
    service.run_ingest(1, "incremental", ["1d"], None)
    assert run.status == "completed" and run.symbols_failed == 1 and run.symbols_ok == 1


def test_wipe_symbol_deletes_bar_checks_too():
    from app.models import BarCheck, Candle, IndicatorValue
    seen = []

    class FakeSession:
        def execute(self, stmt):
            seen.append(stmt.table.name)

    service._wipe_symbol(FakeSession(), 7)
    assert seen == [Candle.__tablename__, IndicatorValue.__tablename__,
                    BarCheck.__tablename__]
