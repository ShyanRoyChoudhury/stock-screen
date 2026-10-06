"""OHLCV fetch from Fyers' /data/history endpoint (plain `requests`).

Output: tz-aware IST DatetimeIndex,
columns open/high/low/close/volume, empty frame (empty IST DatetimeIndex) when
there is no data. Daily bars are stamped at midnight IST, so the service's
`index.normalize() + SESSION_OPEN_OFFSET` still yields 09:15.

Error behaviour (callers rely on this):
- auth failure (HTTP 401 or Fyers code -16/-300/-15) -> FyersLoginRequired
  (from app.ingest.fyers_session); never retried.
- rate limiting (HTTP 429 / "request limit reached") and network errors are
  retried up to MAX_ATTEMPTS times, sleeping 2s * attempt between tries.
- anything else, or exhausted retries -> FyersFetchError carrying Fyers' code
  and message. `s == "no_data"` is NOT an error: it yields an empty chunk.
The access token is never logged.
"""

import logging
import threading
import time
from datetime import date, datetime, timedelta

import pandas as pd
import requests
from sqlalchemy.orm import Session

from app.config import settings
from app.ingest.fyers_session import FyersLoginRequired, get_token
from app.market_calendar import IST, now_ist, session_close_dt

logger = logging.getLogger(__name__)

HISTORY_URL = "https://api-t1.fyers.in/data/history"
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 2.0
AUTH_CODES = {-16, -300, -15}
# Max calendar days per request (inclusive span), measured against the API.
CHUNK_DAYS = {"60m": 100, "1d": 366}
RESOLUTION = {"60m": "60", "1d": "D"}
COLUMNS = ["open", "high", "low", "close", "volume"]
HOURLY_STARTS = {(9, 15), (10, 15), (11, 15), (12, 15), (13, 15), (14, 15), (15, 15)}


class FyersFetchError(RuntimeError):
    """Fyers returned an error (or retries were exhausted) for a history call."""

    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


class _RateLimiter:
    """Process-wide, thread-safe throttle: spaces calls >= 1/rps apart."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        rps = settings.fyers_rps
        if rps <= 0:
            return
        interval = 1.0 / rps
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next)
            self._next = slot + interval
        delay = slot - now
        if delay > 0:
            time.sleep(delay)


_limiter = _RateLimiter()


def _empty() -> pd.DataFrame:
    return pd.DataFrame(columns=COLUMNS, index=pd.DatetimeIndex([], tz=IST, name="ts"))


def _to_date(d: date | datetime) -> date:
    if isinstance(d, datetime):
        if d.tzinfo is not None:
            d = d.astimezone(IST)
        return d.date()
    return d


def chunk_ranges(start: date, end: date, max_days: int) -> list[tuple[date, date]]:
    """Contiguous inclusive [from, to] ranges, each spanning <= max_days days."""
    out = []
    cur = start
    while cur <= end:
        to = min(cur + timedelta(days=max_days - 1), end)
        out.append((cur, to))
        cur = to + timedelta(days=1)
    return out


class FyersFetcher:
    def __init__(
        self,
        token: str,
        client_id: str | None = None,
        session: requests.Session | None = None,
    ):
        self._token = token
        self.client_id = client_id or settings.fyers_client_id
        self._http = session or requests.Session()

    @classmethod
    def from_session(cls, session: Session, **kwargs) -> "FyersFetcher":
        """Build from the stored token. Raises FyersLoginRequired if absent/expired."""
        return cls(get_token(session), **kwargs)

    # -- HTTP ---------------------------------------------------------------

    def _call(self, params: dict) -> dict:
        headers = {"Authorization": f"{self.client_id}:{self._token}"}
        last = "unknown error"
        last_code: int | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            _limiter.wait()
            retry = False
            try:
                resp = self._http.get(
                    HISTORY_URL,
                    params=params,
                    headers=headers,
                    timeout=settings.fyers_request_timeout,
                )
            except requests.RequestException as e:
                last, last_code, retry = f"network error: {type(e).__name__}", None, True
            else:
                try:
                    body = resp.json()
                except ValueError:
                    body = None
                if not isinstance(body, dict):
                    body = {}
                code = body.get("code")
                msg = str(body.get("message") or f"HTTP {resp.status_code}")
                if resp.status_code == 401 or code in AUTH_CODES:
                    raise FyersLoginRequired(f"Fyers rejected the token: {msg}")
                if resp.status_code == 429 or "request limit reached" in msg.lower():
                    last, last_code, retry = msg, 429, True
                elif resp.status_code == 200 and body.get("s") in ("ok", "no_data"):
                    return body
                else:
                    raise FyersFetchError(msg, code if isinstance(code, int) else resp.status_code)
            if retry and attempt < MAX_ATTEMPTS:
                logger.warning("fyers history retry %d/%d: %s", attempt, MAX_ATTEMPTS, last)
                time.sleep(BACKOFF_SECONDS * attempt)
        raise FyersFetchError(f"{last} (after {MAX_ATTEMPTS} attempts)", last_code)

    # -- public -------------------------------------------------------------

    def fetch_bars(
        self,
        symbol: str,
        interval: str,  # "60m" | "1d"
        start: date | datetime,
        end: date | datetime | None = None,
    ) -> pd.DataFrame:
        if interval not in RESOLUTION:
            raise ValueError(f"unsupported interval {interval!r}")
        start_d = _to_date(start)
        end_d = _to_date(end) if end is not None else now_ist().date()
        rows: list[list] = []
        if start_d <= end_d:
            for lo, hi in chunk_ranges(start_d, end_d, CHUNK_DAYS[interval]):
                body = self._call({
                    "symbol": f"NSE:{symbol}-EQ",
                    "resolution": RESOLUTION[interval],
                    "date_format": "1",
                    "range_from": lo.isoformat(),
                    "range_to": hi.isoformat(),
                    "cont_flag": "0",
                })
                rows.extend(body.get("candles") or [])
        return _candles_to_df(rows, interval)


def drop_incomplete_candles(df: pd.DataFrame, interval: str) -> pd.DataFrame:
    """Remove the still-forming candle so we never store a shape that can change.

    A candle is complete once its end time has passed:
    - 60m: start + 1h, capped at that day's 15:30 session close
      (the 15:15 candle is only 15 minutes long);
    - 1d: 15:30 IST on the candle's date.
    """
    if df.empty:
        return df
    now = now_ist()
    last = df.index[-1]
    if interval == "60m":
        end = min(last + timedelta(hours=1), session_close_dt(last.date()))
    else:  # 1d
        end = session_close_dt(last.date())
    if end > now:
        df = df.iloc[:-1]
    return df


def _candles_to_df(rows: list[list], interval: str) -> pd.DataFrame:
    if not rows:
        return _empty()
    df = pd.DataFrame(rows, columns=["ts", *COLUMNS][: len(rows[0])])
    df = df.dropna(subset=["ts", "open", "high", "low", "close"])
    idx = pd.to_datetime(df["ts"].astype("int64"), unit="s", utc=True).dt.tz_convert(IST)
    df = df[COLUMNS].astype(float)
    df.index = pd.DatetimeIndex(idx, name="ts")
    if interval == "60m":
        keep = [(t.hour, t.minute) in HOURLY_STARTS for t in df.index]
        df = df[keep]
    else:
        df.index = df.index.normalize()
    df = df[~df.index.duplicated(keep="last")].sort_index()
    if df.empty:
        return _empty()
    return drop_incomplete_candles(df, interval)
