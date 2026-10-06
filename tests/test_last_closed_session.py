"""last_closed_session: the newest trading session whose 15:30 IST close has
passed. The bhavcopy reconcile must never target a session that hasn't closed.
Pure calendar logic: no database, no network.

Calendar facts used (all asserted below, not assumed): Wed 2026-10-07 is a
session; Sat/Sun 10-10/10-11 are not; Fri 2026-10-02 (Gandhi Jayanti) is an NSE
holiday, so the session before Mon 10-05 is Thu 10-01."""

from datetime import date, datetime, timedelta, timezone

import pytest

from app import market_calendar as mc
from app.market_calendar import IST, is_trading_day, last_closed_session


def ist(day: int, hh: int, mm: int = 0, month: int = 10) -> datetime:
    return datetime(2026, month, day, hh, mm, tzinfo=IST)


def test_calendar_facts_the_cases_below_rely_on():
    assert is_trading_day(date(2026, 10, 7))                  # Wed
    assert not is_trading_day(date(2026, 10, 10))             # Sat
    assert not is_trading_day(date(2026, 10, 2))              # Fri: Gandhi Jayanti
    assert is_trading_day(date(2026, 10, 1)) and is_trading_day(date(2026, 10, 5))


@pytest.mark.parametrize("now,expected", [
    # Trading day: the previous session until its own close, then itself.
    (ist(7, 8, 30), date(2026, 10, 6)),    # Wed morning, the catch-up run -> Tue
    (ist(7, 0, 13), date(2026, 10, 6)),    # just after midnight (the observed run)
    (ist(7, 9, 15), date(2026, 10, 6)),    # at the open: today is still in progress
    (ist(7, 15, 29), date(2026, 10, 6)),   # one minute before the close
    (ist(7, 15, 30), date(2026, 10, 7)),   # at the close: closed (<=)
    (ist(7, 19, 0), date(2026, 10, 7)),    # the evening run
    (ist(7, 23, 59), date(2026, 10, 7)),
    # Weekend: the last session before it, at any hour.
    (ist(10, 10, 0), date(2026, 10, 9)),   # Sat -> Fri
    (ist(11, 20, 0), date(2026, 10, 9)),   # Sun evening -> Fri
    (ist(12, 8, 0), date(2026, 10, 9)),    # Mon morning -> Fri, weekend skipped
    (ist(12, 15, 30), date(2026, 10, 12)),  # Mon at its close
    # NSE holiday Fri 2026-10-02 (Gandhi Jayanti): never a session, any hour.
    (ist(2, 10, 0), date(2026, 10, 1)),
    (ist(2, 20, 0), date(2026, 10, 1)),
    (ist(5, 8, 30), date(2026, 10, 1)),    # Mon after the holiday -> Thu, not Fri
    (ist(5, 16, 0), date(2026, 10, 5)),
])
def test_last_closed_session(now, expected):
    assert last_closed_session(now) == expected


@pytest.mark.parametrize("now_utc,expected", [
    (datetime(2026, 10, 7, 3, 0, tzinfo=timezone.utc), date(2026, 10, 6)),    # 08:30 IST
    (datetime(2026, 10, 7, 9, 59, tzinfo=timezone.utc), date(2026, 10, 6)),   # 15:29 IST
    (datetime(2026, 10, 7, 10, 0, tzinfo=timezone.utc), date(2026, 10, 7)),   # 15:30 IST
    (datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc), date(2026, 10, 7)),   # 17:30 IST
    # 19:00 UTC Wed is 00:30 IST Thu: the IST day has rolled over, still before its open.
    (datetime(2026, 10, 7, 19, 0, tzinfo=timezone.utc), date(2026, 10, 7)),
    # 19:00 UTC Fri is 00:30 IST Sat.
    (datetime(2026, 10, 9, 19, 0, tzinfo=timezone.utc), date(2026, 10, 9)),
])
def test_a_utc_aware_now_is_converted_to_ist(now_utc, expected):
    assert last_closed_session(now_utc) == expected


def test_any_timezone_is_accepted():
    est = timezone(timedelta(hours=-5))
    # 23:00 EST Tue 10-06 = 09:30 IST Wed 10-07: Wed's session is open, not closed.
    assert last_closed_session(datetime(2026, 10, 6, 23, 0, tzinfo=est)) == date(2026, 10, 6)
    # 05:30 EST Wed 10-07 = 16:00 IST Wed: closed.
    assert last_closed_session(datetime(2026, 10, 7, 5, 30, tzinfo=est)) == date(2026, 10, 7)


def test_naive_now_is_rejected_not_read_as_machine_local_time():
    with pytest.raises(ValueError, match="timezone-aware"):
        last_closed_session(datetime(2026, 10, 7, 8, 30))


def test_default_now_is_the_ist_clock(monkeypatch):
    monkeypatch.setattr(mc, "now_ist", lambda: ist(7, 8, 30))
    assert last_closed_session() == date(2026, 10, 6)
    monkeypatch.setattr(mc, "now_ist", lambda: ist(7, 15, 30))
    assert last_closed_session() == date(2026, 10, 7)


def test_never_later_than_last_trading_day_and_always_closed():
    """Definition check, independent of the implementation's branches: over a
    few weeks (a holiday and weekends included) the answer is a trading day
    whose close is <= now, and the NEXT session's close is still ahead."""
    start = ist(28, 0, 0, month=9)
    for i in range(24 * 7 * 3):  # hourly, three weeks
        now = start + timedelta(hours=i)
        got = last_closed_session(now)
        assert is_trading_day(got), now
        assert mc.session_close_dt(got) <= now, now
        assert mc.session_close_dt(mc.shift_sessions(got, 1)) > now, now
        assert got <= mc.last_trading_day(now.date()), now
