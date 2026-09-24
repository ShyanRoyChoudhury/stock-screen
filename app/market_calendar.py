"""NSE trading-day helpers built on exchange_calendars' XBOM calendar
(the library's Indian market calendar; NSE and BSE share trading holidays).

Two layers of holiday handling:
- this calendar answers "is today a trading day?" so scheduled pulls can
  no-op on holidays/weekends;
- ingestion itself treats "no new rows from the source" as a normal
  outcome, so an unlisted ad-hoc market closure never becomes an error.
"""

from datetime import date, datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

import exchange_calendars as xcals

IST = ZoneInfo("Asia/Kolkata")
SESSION_OPEN = time(9, 15)
SESSION_CLOSE = time(15, 30)


@lru_cache(maxsize=1)
def _calendar():
    return xcals.get_calendar("XBOM")


def is_trading_day(d: date) -> bool:
    cal = _calendar()
    return cal.is_session(d.isoformat())


def last_trading_day(ref: date | None = None) -> date:
    """Most recent trading day on or before `ref` (default: today, IST)."""
    d = ref or datetime.now(IST).date()
    for _ in range(30):
        if is_trading_day(d):
            return d
        d -= timedelta(days=1)
    raise RuntimeError("No trading day found in the last 30 days")


def session_open_dt(d: date) -> datetime:
    return datetime.combine(d, SESSION_OPEN, tzinfo=IST)


def session_close_dt(d: date) -> datetime:
    return datetime.combine(d, SESSION_CLOSE, tzinfo=IST)


def now_ist() -> datetime:
    return datetime.now(IST)


def sessions_between(start: date, end: date) -> int:
    """Trading sessions strictly after `start`, up to and including `end`.
    0 when end <= start. Holding periods and match windows count sessions,
    not calendar days, so a long weekend does not age a position."""
    if end <= start:
        return 0
    cal = _calendar()
    n = len(cal.sessions_in_range(start.isoformat(), end.isoformat()))
    return n - 1 if is_trading_day(start) else n


def shift_sessions(d: date, n: int) -> date:
    """The trading day `n` sessions after `d` (negative n = before). When `d`
    itself is not a session, it is first snapped back to the previous one."""
    cal = _calendar()
    anchor = cal.date_to_session(d.isoformat(), direction="previous")
    return cal.session_offset(anchor, n).date()
