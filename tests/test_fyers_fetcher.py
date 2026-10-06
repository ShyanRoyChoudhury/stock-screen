"""Fyers fetcher tests: HTTP is injected (fake session); no network."""

import json
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import pytest
import requests

import app.ingest.fyers_fetcher as ff
from app.ingest.fyers_session import FyersLoginRequired
from app.market_calendar import IST

FIXTURE = Path(__file__).parent / "fixtures" / "fyers_history_60m.json"


class Resp:
    def __init__(self, body=None, status=200):
        self._body, self.status_code = body, status

    def json(self):
        if self._body is None:
            raise ValueError
        return self._body


class FakeHTTP:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    sleeps = []
    monkeypatch.setattr(ff.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(ff.settings, "fyers_rps", 1000.0)
    monkeypatch.setattr(ff._limiter, "_next", 0.0)
    # "now" far after the fixture bars so nothing is dropped as incomplete.
    monkeypatch.setattr(ff, "now_ist", lambda: datetime(2026, 10, 1, 12, 0, tzinfo=IST))
    return sleeps


def mk(responses):
    http = FakeHTTP(responses)
    return ff.FyersFetcher("TOKEN123", client_id="APP-100", session=http), http


OK_EMPTY = Resp({"s": "ok", "candles": []})


def test_chunking_60m_250_days():
    f, http = mk([OK_EMPTY])
    f.fetch_bars("INFY", "60m", date(2026, 1, 1), date(2026, 9, 7))  # 250 days inclusive
    r = [(c["params"]["range_from"], c["params"]["range_to"]) for c in http.calls]
    assert r == [("2026-01-01", "2026-04-10"), ("2026-04-11", "2026-07-19"), ("2026-07-20", "2026-09-07")]
    p = http.calls[0]["params"]
    assert p["symbol"] == "NSE:INFY-EQ" and p["resolution"] == "60"
    assert p["date_format"] == "1" and p["cont_flag"] == "0"
    assert http.calls[0]["headers"] == {"Authorization": "APP-100:TOKEN123"}
    assert http.calls[0]["timeout"] == ff.settings.fyers_request_timeout


def test_chunking_1d_five_years():
    f, http = mk([OK_EMPTY])
    f.fetch_bars("INFY", "1d", date(2021, 10, 1), date(2026, 9, 30))
    assert len(http.calls) == 5
    assert http.calls[0]["params"]["resolution"] == "D"
    prev = None
    for c in http.calls:
        lo = date.fromisoformat(c["params"]["range_from"])
        hi = date.fromisoformat(c["params"]["range_to"])
        assert (hi - lo).days + 1 <= 366
        if prev:
            assert (lo - prev).days == 1
        prev = hi
    assert prev == date(2026, 9, 30)


def test_parse_and_cleanup_hourly_fixture():
    body = json.loads(FIXTURE.read_text())
    dup = body["candles"][3]
    body["candles"].append(dup[:4] + [999.0, dup[5]])  # duplicate ts, later wins
    f, _ = mk([Resp(body)])
    df = f.fetch_bars("INFY", "60m", date(2026, 9, 9), date(2026, 9, 10))
    assert list(df.columns) == ["open", "high", "low", "close", "volume"]
    assert str(df.index.tz) == str(IST) and df.index.is_monotonic_increasing
    assert len(df) == 14  # 08:15 dropped, duplicate collapsed
    assert {(t.hour, t.minute) for t in df.index} == {(h, 15) for h in range(9, 16)}
    assert df.index.is_unique
    assert df.loc[pd.Timestamp(dup[0], unit="s", tz="UTC").tz_convert(IST), "close"] == 999.0
    assert (df.dtypes == float).all()


def test_incomplete_last_candle_dropped(monkeypatch):
    monkeypatch.setattr(ff, "now_ist", lambda: datetime(2026, 9, 10, 15, 20, tzinfo=IST))
    f, _ = mk([Resp(json.loads(FIXTURE.read_text()))])
    df = f.fetch_bars("INFY", "60m", date(2026, 9, 9), date(2026, 9, 10))
    assert df.index[-1] == pd.Timestamp("2026-09-10 14:15", tz=IST)


def test_daily_midnight_ist():
    ts = int(datetime(2026, 9, 9, 0, 0, tzinfo=IST).timestamp())
    f, _ = mk([Resp({"s": "ok", "candles": [[ts, 1, 2, 0.5, 1.5, 1000]]})])
    df = f.fetch_bars("INFY", "1d", date(2026, 9, 9), date(2026, 9, 9))
    assert df.index[0] == pd.Timestamp("2026-09-09 00:00", tz=IST)
    assert df.index.normalize().equals(df.index)


@pytest.mark.parametrize("resp", [OK_EMPTY, Resp({"s": "no_data", "candles": []})])
def test_empty(resp):
    f, _ = mk([resp])
    df = f.fetch_bars("INFY", "1d", datetime(2026, 9, 1, 10), date(2026, 9, 3))
    assert df.empty and list(df.columns) == ["open", "high", "low", "close", "volume"]
    assert isinstance(df.index, pd.DatetimeIndex) and str(df.index.tz) == str(IST)
    assert (df.index.normalize() + pd.Timedelta("9h15min")).empty


def test_rate_limit_retry_then_success(fast):
    rl = Resp({"s": "error", "code": -429, "message": "request limit reached"}, 200)
    f, http = mk([rl, Resp(None, 429), Resp(json.loads(FIXTURE.read_text()))])
    df = f.fetch_bars("INFY", "60m", date(2026, 9, 9), date(2026, 9, 10))
    assert len(http.calls) == 3 and len(df) == 14
    assert [s for s in fast if s >= 1] == [2.0, 4.0]  # backoff only


def test_rate_limit_exhausted_raises():
    f, http = mk([Resp(None, 429)])
    with pytest.raises(ff.FyersFetchError, match="after 3 attempts"):
        f.fetch_bars("INFY", "1d", date(2026, 9, 1), date(2026, 9, 2))
    assert len(http.calls) == 3


def test_network_error_retried():
    f, http = mk([requests.ConnectionError("boom"), OK_EMPTY])
    assert f.fetch_bars("INFY", "1d", date(2026, 9, 1), date(2026, 9, 2)).empty
    assert len(http.calls) == 2


@pytest.mark.parametrize("resp", [
    Resp({"s": "error", "code": -16, "message": "Could not authenticate"}),
    Resp({"s": "error", "code": -300, "message": "Invalid token"}),
    Resp({"s": "error", "code": -15, "message": "Invalid token"}),
    Resp(None, 401),
])
def test_auth_error(resp):
    f, http = mk([resp])
    with pytest.raises(FyersLoginRequired):
        f.fetch_bars("INFY", "1d", date(2026, 9, 1), date(2026, 9, 2))
    assert len(http.calls) == 1


def test_other_error_raises_with_message_no_token():
    f, http = mk([Resp({"s": "error", "code": -50, "message": "Invalid input"})])
    with pytest.raises(ff.FyersFetchError, match="Invalid input") as ei:
        f.fetch_bars("INFY", "1d", date(2026, 9, 1), date(2026, 9, 2))
    assert ei.value.code == -50 and "TOKEN123" not in str(ei.value)
    assert len(http.calls) == 1


def test_throttle_respected(monkeypatch):
    clock = {"t": 100.0}
    slept = []
    monkeypatch.setattr(ff.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(ff.time, "sleep", lambda s: (slept.append(s), clock.__setitem__("t", clock["t"] + s)))
    monkeypatch.setattr(ff.settings, "fyers_rps", 2.0)
    monkeypatch.setattr(ff._limiter, "_next", 0.0)
    f, http = mk([OK_EMPTY])
    f.fetch_bars("INFY", "60m", date(2026, 1, 1), date(2026, 9, 7))  # 3 calls
    assert len(http.calls) == 3
    assert slept == [0.5, 0.5]  # first immediate, then 1/rps spacing


def test_from_session(monkeypatch):
    monkeypatch.setattr(ff, "get_token", lambda s: "T")
    f = ff.FyersFetcher.from_session(object(), client_id="C")
    assert f._token == "T" and f.client_id == "C"
