"""Read-only probe: evaluate Fyers API v3 as the replacement source for 1h
NSE equity bars, by reconciling its 60-min (and 1-min-aggregated-to-hourly)
bars against NSE's official daily bhavcopy. Prints a report; makes no DB
writes and touches no code under app/. See the plan's "Step 0" and the
"Step 3" reconciliation rules: ~/.claude/plans/let-us-now-start-agile-acorn.md

Talks to Fyers over plain `requests`, not the `fyers-apiv3` SDK: that
package pins requests==2.31.0/aiohttp==3.9.3, which is older than what
growwapi (already in requirements.txt) requires and breaks the shared venv
(and the Docker image's `pip install -r requirements.txt`). The SDK's own
source (FyersServiceSync.get_call, SessionModel.generate_token) was read to
confirm the URL/params/headers below are a faithful equivalent of what it
does under the hood for is_async=False.

Credentials (env vars, see .env.example):
  FYERS_ACCESS_TOKEN + FYERS_CLIENT_ID, in the environment or .env. Mint the
  token with `scripts/fyers_auth.py --write-env` (browser login, once per
  trading day; the token dies at 06:00 IST).

Run:
    .venv/bin/python scripts/probe_intraday_source.py
    .venv/bin/python scripts/probe_intraday_source.py --sessions 10 --rps 3
"""

import argparse
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta
from datetime import time as dtime
from pathlib import Path

import pandas as pd
import requests
from sqlalchemy import bindparam, text

sys.path.insert(0, ".")
from app.db import engine  # noqa: E402
from app.ingest.bhavcopy import eq_row as bhav_row_for, fetch_bhavcopy  # noqa: E402
from app.market_calendar import IST, last_trading_day, now_ist, shift_sessions  # noqa: E402

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

LOG_DIR = "logs/probe"
FYERS_SYMBOL_FMT = "NSE:{}-EQ"

PRICE_TICK = 0.05          # NSE cash-market tick size
VOL_TOL_PCT = 0.01         # volume reconciliation tolerance
NATIVE_PASS_THRESHOLD = 0.99  # plan's decision-rule threshold
HOURLY_BACKFILL_TARGET_DAYS = 728  # app.config.settings.hourly_backfill_days

MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0

# 7 session-anchored hourly bins; the last one is only 15 minutes.
_BIN_EDGES = [
    (dtime(9, 15), dtime(10, 15)),
    (dtime(10, 15), dtime(11, 15)),
    (dtime(11, 15), dtime(12, 15)),
    (dtime(12, 15), dtime(13, 15)),
    (dtime(13, 15), dtime(14, 15)),
    (dtime(14, 15), dtime(15, 15)),
    (dtime(15, 15), dtime(15, 30)),
]

FYERS_ENV_DIRECT = ("FYERS_ACCESS_TOKEN", "FYERS_CLIENT_ID")


# ============================================================ auth ========

def _load_env() -> None:
    """Load .env into os.environ. Prefers python-dotenv (present in this
    venv); falls back to a hand-rolled parse so the script still works if
    it's ever missing. app/config.py reads .env via pydantic-settings, but
    this is a standalone script that reads os.environ directly."""
    try:
        from dotenv import load_dotenv
        load_dotenv(".env")
        return
    except ImportError:
        pass
    env_path = Path(".env")
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


class FyersClient:
    """Thin GET-based client for Fyers' /data/history endpoint. Replaces
    the fyers-apiv3 SDK (deliberately not a dependency here -- see the
    module docstring): its own source (FyersServiceSync.get_call in
    fyers_apiv3/fyersModel.py) was read to confirm this sends the same
    params to the same URL with the same "{client_id}:{token}" Authorization
    header that the SDK's is_async=False path uses.
    """

    API_BASE = "https://api-t1.fyers.in/api/v3"
    HISTORY_URL = "https://api-t1.fyers.in/data/history"
    TIMEOUT_SECONDS = 30

    def __init__(self, client_id: str, token: str, session: requests.Session | None = None):
        self.client_id = client_id
        self.token = token
        self.session = session or requests.Session()

    def history(self, data: dict) -> dict:
        """GET /data/history. Always returns a dict with at least "s"; on
        any failure (network, non-2xx, non-JSON) that dict carries only
        Fyers' own s/code/message fields plus an empty "candles" -- callers
        (call_history) already treat any non-"ok" "s" uniformly, including
        detecting a rate limit for retry."""
        headers = {"Authorization": f"{self.client_id}:{self.token}"}
        try:
            resp = self.session.get(
                self.HISTORY_URL, params=data, headers=headers, timeout=self.TIMEOUT_SECONDS
            )
        except requests.RequestException as e:
            return {"s": "error", "code": -1, "message": f"network error: {e}", "candles": []}

        try:
            body = resp.json()
        except ValueError:
            body = None

        if resp.status_code == 429:
            message = "rate limited"
            if isinstance(body, dict) and body.get("message"):
                message = body["message"]
            return {"s": "error", "code": 429, "message": message, "candles": []}
        if resp.status_code != 200:
            if isinstance(body, dict):
                return {
                    "s": body.get("s", "error"), "code": body.get("code", resp.status_code),
                    "message": body.get("message", f"HTTP {resp.status_code}"),
                    "candles": body.get("candles", []),
                }
            return {"s": "error", "code": resp.status_code,
                    "message": f"HTTP {resp.status_code}", "candles": []}
        if isinstance(body, dict):
            return body
        return {"s": "error", "code": -1, "message": "non-JSON response", "candles": []}


def get_fyers_client() -> FyersClient:
    """FyersClient authenticated via FYERS_ACCESS_TOKEN + FYERS_CLIENT_ID.
    Exits (code 1) with a clear message if either is missing."""
    _load_env()
    os.makedirs(LOG_DIR, exist_ok=True)

    token = os.environ.get("FYERS_ACCESS_TOKEN")
    client_id = os.environ.get("FYERS_CLIENT_ID")
    if not (token and client_id):
        missing = [v for v in FYERS_ENV_DIRECT if not os.environ.get(v)]
        sys.exit(
            f"Missing Fyers credentials: {', '.join(missing)}\n"
            "Run `.venv/bin/python scripts/fyers_auth.py --write-env` to log in "
            "and save FYERS_ACCESS_TOKEN to .env (the token expires 06:00 IST daily)."
        )
    print(f"[auth] using FYERS_ACCESS_TOKEN for client_id={client_id}")
    return FyersClient(client_id=client_id, token=token)


# ==================================================== rate-limited fetch ==

class RateLimiter:
    """Single-threaded throttle: `wait()` sleeps as needed so consecutive
    calls are spaced >= 1/rps seconds apart. Tracks totals for the
    rate-limit section of the report."""

    def __init__(self, rps: float):
        self.min_interval = (1.0 / rps) if rps > 0 else 0.0
        self._last: float | None = None
        self.requests_made = 0
        self.retries = 0

    def wait(self) -> None:
        if self._last is not None:
            remaining = self.min_interval - (time.monotonic() - self._last)
            if remaining > 0:
                time.sleep(remaining)
        self._last = time.monotonic()


_RATE_LIMIT_HINTS = ("rate limit", "too many request", "429")


def _looks_rate_limited(resp) -> bool:
    if not isinstance(resp, dict):
        return False
    code = resp.get("code")
    if isinstance(code, (int, float)) and int(code) in (429, -429):
        return True
    return any(h in str(resp.get("message", "")).lower() for h in _RATE_LIMIT_HINTS)


def call_history(fyers, data: dict, limiter: RateLimiter) -> dict:
    """fyers.history(data=...), throttled to `limiter`'s rps and retried
    (with backoff) on a rate-limit response. Only Fyers' own status fields
    (s/code/message) are ever logged -- never the request payload."""
    resp: dict = {"s": "error", "candles": []}
    for attempt in range(1, MAX_RETRIES + 1):
        limiter.wait()
        limiter.requests_made += 1
        resp = fyers.history(data=data)
        if isinstance(resp, dict) and resp.get("s") == "ok":
            return resp
        if _looks_rate_limited(resp) and attempt < MAX_RETRIES:
            limiter.retries += 1
            time.sleep(RETRY_BACKOFF_SECONDS * attempt)
            continue
        break
    if not (isinstance(resp, dict) and resp.get("s") == "ok"):
        msg = resp.get("message") if isinstance(resp, dict) else str(resp)
        logger.warning("fyers history failed for %s res=%s: %s",
                        data.get("symbol"), data.get("resolution"), msg)
    return resp


def _candles_to_df(candles: list) -> pd.DataFrame:
    """Fyers candle rows are [epoch_utc, open, high, low, close, volume],
    timestamp marking the bar's START (per Fyers' own KB)."""
    if not candles:
        return pd.DataFrame(
            columns=["open", "high", "low", "close", "volume"],
            index=pd.DatetimeIndex([], tz=IST, name="ts"),
        )
    df = pd.DataFrame(candles, columns=["epoch", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["epoch"], unit="s", utc=True).dt.tz_convert(IST)
    return df.set_index("ts").sort_index()[["open", "high", "low", "close", "volume"]]


def fetch_range_bars(fyers, fyers_symbol: str, resolution: str, start: date,
                      end: date, limiter: RateLimiter) -> pd.DataFrame:
    """One history() call. Intraday requests are capped at 100 days by
    Fyers; every caller here uses windows well under that (single days for
    reconciliation, ~1-week windows for the history-depth probe)."""
    if (end - start).days > 100:
        raise ValueError("fetch_range_bars: range exceeds Fyers' 100-day intraday cap")
    data = {
        "symbol": fyers_symbol, "resolution": resolution, "date_format": "1",
        "range_from": start.isoformat(), "range_to": end.isoformat(), "cont_flag": "0",
    }
    resp = call_history(fyers, data, limiter)
    candles = resp.get("candles", []) if isinstance(resp, dict) else []
    return _candles_to_df(candles)


def fetch_day_bars(fyers, fyers_symbol: str, resolution: str, day: date,
                    limiter: RateLimiter) -> pd.DataFrame:
    return fetch_range_bars(fyers, fyers_symbol, resolution, day, day, limiter)


def probe_history_depth(fyers, symbol: str, resolution: str, limiter: RateLimiter,
                         max_years: int = 12) -> date | None:
    """Oldest date (accurate to ~1 week) `symbol` returns data for, at
    `resolution`. Fyers doesn't document how far back its intraday history
    goes, so this steps back a year at a time until a fetch comes back
    empty, then binary-searches that year's boundary down to a week.
    Returns None if even the most recent week has no data."""
    fsym = FYERS_SYMBOL_FMT.format(symbol)
    today = last_trading_day()

    def has_data(anchor: date) -> bool:
        window_end = min(anchor + timedelta(days=6), today)
        return not fetch_range_bars(fyers, fsym, resolution, anchor, window_end, limiter).empty

    if not has_data(today - timedelta(days=6)):
        return None

    last_with_data = today
    first_without = None
    for years_back in range(1, max_years + 1):
        anchor = today - timedelta(days=365 * years_back)
        if has_data(anchor):
            last_with_data = anchor
        else:
            first_without = anchor
            break

    if first_without is None:
        return last_with_data  # history reaches at least max_years back

    lo, hi = first_without, last_with_data
    while (hi - lo).days > 7:
        mid = lo + (hi - lo) / 2
        if has_data(mid):
            hi = mid
        else:
            lo = mid
    return hi


# ============================================================ sampling ====

def pick_liquidity_sample(conn, n: int = 20,
                           forced=("RELIANCE", "HDFCBANK", "TCS")) -> list[str]:
    """n symbols spread evenly across liquidity, ranked by median daily
    traded value (close*volume) over the last 60 daily sessions. `forced`
    symbols are guaranteed present."""
    rows = conn.execute(text("""
        WITH recent AS (
          SELECT s.symbol, c.close * c.volume AS traded_value,
                 row_number() OVER (PARTITION BY s.id ORDER BY c.ts DESC) AS rn
          FROM candles c JOIN symbols s ON s.id = c.symbol_id
          WHERE c.timeframe = '1d'
        )
        SELECT symbol,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY traded_value) AS median_value,
               count(*) AS n
        FROM recent WHERE rn <= 60
        GROUP BY symbol
        HAVING count(*) >= 40
        ORDER BY median_value DESC
    """)).fetchall()
    ranked = [r.symbol for r in rows]

    if len(ranked) <= n:
        picked = list(ranked)
    else:
        seen: set = set()
        picked = []
        for i in range(n):
            idx = round(i * (len(ranked) - 1) / (n - 1))
            sym = ranked[idx]
            if sym not in seen:
                picked.append(sym)
                seen.add(sym)
        j = 0
        while len(picked) < n and j < len(ranked):
            if ranked[j] not in seen:
                picked.append(ranked[j])
                seen.add(ranked[j])
            j += 1

    for sym in forced:
        if sym in picked:
            continue
        if len(picked) >= n:
            # Evict the lowest-priority (last) pick that isn't itself one of
            # `forced` -- popping blindly can otherwise evict a forced
            # symbol a previous iteration of this same loop just added.
            for i in range(len(picked) - 1, -1, -1):
                if picked[i] not in forced:
                    picked.pop(i)
                    break
            else:
                picked.pop()
        picked.append(sym)
    return picked


def pick_split_bonus_sample(conn, n: int = 3) -> list[tuple[str, date]]:
    """Up to n symbols with a split or bonus in the last 2 years, most
    recent first, as (symbol, ex_date)."""
    rows = conn.execute(text("""
        SELECT DISTINCT ON (s.symbol) s.symbol, ca.ex_date
        FROM corporate_actions ca JOIN symbols s ON s.id = ca.symbol_id
        WHERE ca.action_type IN ('split', 'bonus')
          AND ca.ex_date >= (CURRENT_DATE - INTERVAL '2 years')
        ORDER BY s.symbol, ca.ex_date DESC
    """)).fetchall()
    rows = sorted(rows, key=lambda r: r.ex_date, reverse=True)
    return [(r.symbol, r.ex_date) for r in rows[:n]]


def symbol_ids(conn, symbols: list[str]) -> dict[str, int]:
    stmt = text("SELECT symbol, id FROM symbols WHERE symbol IN :syms").bindparams(
        bindparam("syms", expanding=True)
    )
    rows = conn.execute(stmt, {"syms": list(symbols)}).fetchall()
    return {r.symbol: r.id for r in rows}


def reconciliation_sessions(n: int) -> list[date]:
    """The `n` most recent FINISHED trading sessions, oldest first. Today is
    always excluded (users report duplicate 09:15 candles when the current
    day is fetched intraday, before the close)."""
    anchor = last_trading_day(now_ist().date() - timedelta(days=1))
    return sorted(shift_sessions(anchor, -i) for i in range(n))


# bhavcopy download/lookup lives in app.ingest.bhavcopy (fetch_bhavcopy, eq_row).


def stored_hourly(conn, symbol_id: int, day: date, timeframe: str = "1h",
                   source: str = "yfinance") -> pd.DataFrame:
    """Our stored candles for one symbol-day (used for the Yahoo side-by-side
    and, at timeframe='1d', the split-adjusted adjustment-basis check)."""
    rows = conn.execute(text("""
        SELECT ts, open, high, low, close, volume
        FROM candles
        WHERE symbol_id = :sid AND timeframe = :tf AND source = :src
          AND (ts AT TIME ZONE 'Asia/Kolkata')::date = :d
        ORDER BY ts
    """), {"sid": symbol_id, "tf": timeframe, "src": source, "d": day}).fetchall()
    if not rows:
        return pd.DataFrame(
            columns=["open", "high", "low", "close", "volume"],
            index=pd.DatetimeIndex([], tz=IST, name="ts"),
        )
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.tz_convert(IST)
    return df.set_index("ts")


# ================================================== pure: aggregation =====

def _bin_start(ts) -> datetime | None:
    t = ts.time()
    for start, end in _BIN_EDGES:
        if start <= t < end:
            return datetime.combine(ts.date(), start, tzinfo=ts.tzinfo)
    return None


def aggregate_1min_to_hourly(minute_bars: pd.DataFrame) -> pd.DataFrame:
    """Aggregate 1-min bars (IST tz-aware index, columns open/high/low/
    close/volume) into the 7 session-anchored hourly bins NSE's cash
    session breaks into: 09:15-10:15, 10:15-11:15, ..., 14:15-15:15, and
    the short 15:15-15:30 bin. Bars outside 09:15-15:30 are dropped.

    Pure function (no I/O) -- unit-tested directly in
    tests/test_probe_reconcile.py. Step 1 of the plan generalises this into
    app/ingest/resample.py's `resample_to_session_bins`.
    """
    empty = pd.DataFrame(
        columns=["open", "high", "low", "close", "volume"],
        index=pd.DatetimeIndex([], name="ts"),
    )
    if minute_bars.empty:
        return empty

    work = minute_bars.sort_index().copy()
    work["bin"] = [_bin_start(ts) for ts in work.index]
    work = work[work["bin"].notna()]
    if work.empty:
        return empty

    out = work.groupby("bin").agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        volume=("volume", "sum"),
    )
    out.index = pd.DatetimeIndex(out.index, name="ts")
    return out.sort_index()


# ================================================ pure: reconciliation ====

_RULE_KEYS = [
    ("high_ok", "high"), ("low_ok", "low"), ("open_ok", "open"),
    ("last_close_ok", "close(last)"), ("vol_ok", "volume"),
    ("bar_count_ok", "bar_count"),
]


def _empty_reconcile_result(bar_count: int) -> dict:
    return {
        "bar_count": bar_count, "has_data": False,
        "high_diff": None, "high_ok": False,
        "low_diff": None, "low_ok": False,
        "vol_diff_pct": None, "vol_ok": False,
        "open_diff": None, "open_ok": False,
        "last_close_diff": None, "last_close_ok": False,
        "close_vs_clspric_diff": None,
        "bar_count_ok": False,
        "duplicate_ts_count": 0,
        "zero_volume_bar_count": 0,
        "vol_share_0915": None,
        "vol_share_1515": None,
        "all_rules_pass": False,
    }


def reconcile_day(hourly: pd.DataFrame, bhav_row: dict | None) -> dict:
    """Compare one symbol-day's hourly bars (native 60-min OR 1-min
    aggregated into the same 7 bins -- same shape either way) against its
    NSE bhavcopy row. Pure function: no I/O, so this and
    aggregate_1min_to_hourly are unit-tested directly and are the two
    pieces the plan (Step 3) moves into app/ingest/reconcile.py.

    Pass/fail rules (Step 3):
      - max(high)/min(low) within one tick (0.05) of HghPric/LwPric;
      - sum(volume) within 1% of TtlTradgVol;
      - first bar's open within one tick of OpnPric;
      - last bar's close within one tick of LastPric (NOT ClsPric -- NSE's
        official close is a 30-min VWAP; the ClsPric diff is reported too,
        for information only);
      - bar_count == 7 (a full session; special sessions like Muhurat
        trading are not special-cased here -- Step 3 handles that via
        market_calendar).
    `all_rules_pass` is the AND of the six rule flags above.

    Also reports (diagnostics, not pass/fail rules): duplicate timestamps,
    zero-volume bars, and the 09:15/15:15 bar's share of the day's volume
    -- the specific defects measured in Yahoo (see the plan's Context).
    """
    if hourly is None or hourly.empty or not bhav_row:
        return _empty_reconcile_result(0 if hourly is None else len(hourly))

    h = hourly.sort_index()
    day_high = float(h["high"].max())
    day_low = float(h["low"].min())
    total_vol = float(h["volume"].sum())
    first_open = float(h["open"].iloc[0])
    last_close = float(h["close"].iloc[-1])

    hgh_pric = float(bhav_row["HghPric"])
    lw_pric = float(bhav_row["LwPric"])
    opn_pric = float(bhav_row["OpnPric"])
    last_pric = float(bhav_row["LastPric"])
    cls_pric = float(bhav_row["ClsPric"])
    ttl_vol = float(bhav_row["TtlTradgVol"])

    high_diff = day_high - hgh_pric
    low_diff = day_low - lw_pric
    open_diff = first_open - opn_pric
    last_close_diff = last_close - last_pric
    close_vs_clspric_diff = last_close - cls_pric
    vol_diff_pct = ((total_vol - ttl_vol) / ttl_vol) if ttl_vol else None

    high_ok = abs(high_diff) <= PRICE_TICK
    low_ok = abs(low_diff) <= PRICE_TICK
    open_ok = abs(open_diff) <= PRICE_TICK
    last_close_ok = abs(last_close_diff) <= PRICE_TICK
    vol_ok = vol_diff_pct is not None and abs(vol_diff_pct) <= VOL_TOL_PCT
    bar_count_ok = len(h) == 7

    duplicate_ts_count = int(h.index.duplicated().sum())
    zero_volume_bar_count = int((h["volume"] == 0).sum())

    bar_0915 = h[[ts.time() == dtime(9, 15) for ts in h.index]]
    bar_1515 = h[[ts.time() == dtime(15, 15) for ts in h.index]]
    if total_vol:
        vol_share_0915 = float(bar_0915["volume"].sum()) / total_vol
        vol_share_1515 = float(bar_1515["volume"].sum()) / total_vol
    else:
        vol_share_0915 = None
        vol_share_1515 = None

    return {
        "bar_count": int(len(h)), "has_data": True,
        "high_diff": high_diff, "high_ok": high_ok,
        "low_diff": low_diff, "low_ok": low_ok,
        "vol_diff_pct": vol_diff_pct, "vol_ok": vol_ok,
        "open_diff": open_diff, "open_ok": open_ok,
        "last_close_diff": last_close_diff, "last_close_ok": last_close_ok,
        "close_vs_clspric_diff": close_vs_clspric_diff,
        "bar_count_ok": bar_count_ok,
        "duplicate_ts_count": duplicate_ts_count,
        "zero_volume_bar_count": zero_volume_bar_count,
        "vol_share_0915": vol_share_0915,
        "vol_share_1515": vol_share_1515,
        "all_rules_pass": (high_ok and low_ok and vol_ok and open_ok and
                            last_close_ok and bar_count_ok),
    }


def compare_adjustment_basis(fyers_high: float, fyers_low: float,
                              splits_only_high: float | None, splits_only_low: float | None,
                              bhav_high: float | None, bhav_low: float | None,
                              tol: float = PRICE_TICK) -> str:
    """Which basis Fyers' pre-split/bonus bars match: our stored
    `splits_only` daily candle (adjusted) or bhavcopy (raw/unadjusted)."""
    matches_adjusted = (
        splits_only_high is not None and splits_only_low is not None
        and abs(fyers_high - splits_only_high) <= tol and abs(fyers_low - splits_only_low) <= tol
    )
    matches_raw = (
        bhav_high is not None and bhav_low is not None
        and abs(fyers_high - bhav_high) <= tol and abs(fyers_low - bhav_low) <= tol
    )
    if matches_adjusted and matches_raw:
        return "both (no split effect yet at this tolerance)"
    if matches_adjusted:
        return "splits_only (adjusted)"
    if matches_raw:
        return "unadjusted (raw)"
    return "neither"


# ============================================================ reporting ===

def _fail_count(r: dict) -> int:
    return sum(0 if r.get(key) else 1 for key, _ in _RULE_KEYS)


def rule_pass_rates(results: list[dict]) -> dict:
    labels = [label for _, label in _RULE_KEYS] + ["ALL RULES"]
    n = len(results)
    if n == 0:
        return {label: None for label in labels}
    rates = {label: sum(1 for r in results if r.get(key)) / n for key, label in _RULE_KEYS}
    rates["ALL RULES"] = sum(1 for r in results if r.get("all_rules_pass")) / n
    return rates


def worst_symbol_days(results: list[dict], n: int = 10) -> list[dict]:
    def score(r):
        worst_diff = max(
            (abs(r.get(k) or 0) for k in
             ("high_diff", "low_diff", "open_diff", "last_close_diff")),
            default=0.0,
        )
        return (_fail_count(r), worst_diff)
    return sorted(results, key=score, reverse=True)[:n]


def _banner(title: str) -> None:
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


def _fmt_pct(v) -> str:
    return f"{v:.1%}" if v is not None else "n/a"


def print_side_by_side(named_results: list[tuple[str, list[dict]]]) -> None:
    labels = [label for _, label in _RULE_KEYS] + ["ALL RULES"]
    rates = {name: rule_pass_rates(results) for name, results in named_results}
    header = f"{'rule':<14}" + "".join(f"{name:>20}" for name, _ in named_results)
    print(header)
    for label in labels:
        row = f"{label:<14}"
        for name, _ in named_results:
            row += f"{_fmt_pct(rates[name][label]):>20}"
        print(row)
    for name, results in named_results:
        print(f"  {name}: n={len(results)} symbol-days")


def print_diagnostics(name: str, results: list[dict]) -> None:
    n = len(results)
    if n == 0:
        print(f"  {name}: no data")
        return
    zero_vol_days = sum(1 for r in results if r.get("zero_volume_bar_count"))
    dup_days = sum(1 for r in results if r.get("duplicate_ts_count"))
    shares_0915 = [r["vol_share_0915"] for r in results if r.get("vol_share_0915") is not None]
    shares_1515 = [r["vol_share_1515"] for r in results if r.get("vol_share_1515") is not None]
    avg_0915 = (sum(shares_0915) / len(shares_0915)) if shares_0915 else None
    avg_1515 = (sum(shares_1515) / len(shares_1515)) if shares_1515 else None
    print(f"  {name}: n={n}  "
          f"symbol-days with a zero-volume bar: {zero_vol_days} ({zero_vol_days / n:.1%})  "
          f"with duplicate timestamps: {dup_days} ({dup_days / n:.1%})  "
          f"avg 09:15 volume share: {_fmt_pct(avg_0915)}  "
          f"avg 15:15 volume share: {_fmt_pct(avg_1515)}")


def print_worst(name: str, results: list[dict], n: int = 10) -> None:
    print(f"worst {n} symbol-days -- {name}:")
    if not results:
        print("  (no data)")
        return
    for r in worst_symbol_days(results, n):
        print(f"  {r['symbol']:<12} {r['day']}  fails={_fail_count(r)}/6  "
              f"high_diff={r.get('high_diff')}  low_diff={r.get('low_diff')}  "
              f"vol_diff_pct={r.get('vol_diff_pct')}  open_diff={r.get('open_diff')}  "
              f"last_close_diff={r.get('last_close_diff')}  bar_count={r.get('bar_count')}")


def _csv_row(symbol: str, day: date, kind: str, result: dict) -> dict:
    row = {"symbol": symbol, "day": day.isoformat(), "kind": kind}
    row.update(result)
    return row


# ================================================================ main ====

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only probe: evaluate Fyers API v3 as the replacement "
            "source for 1h NSE equity bars, by reconciling its bars "
            "against NSE's official daily bhavcopy. Makes no DB writes "
            "and no app/ changes."
        )
    )
    parser.add_argument(
        "--sessions", type=int, default=25,
        help="number of finished trading sessions to reconcile (default: 25)",
    )
    parser.add_argument(
        "--rps", type=float, default=5.0,
        help="max Fyers requests per second (default: 5.0)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    fyers = get_fyers_client()  # exits(1) with a clear message if no creds
    limiter = RateLimiter(args.rps)
    started = time.monotonic()
    os.makedirs(LOG_DIR, exist_ok=True)

    print(f"probe_intraday_source: sessions={args.sessions} rps={args.rps}")

    with engine.connect() as conn:
        liquidity_syms = pick_liquidity_sample(conn)
        split_bonus = pick_split_bonus_sample(conn)
        demerger_syms = ["VEDL", "TMPV"]
        all_syms = sorted(set(liquidity_syms) | {s for s, _ in split_bonus} | set(demerger_syms))
        sym_ids = symbol_ids(conn, all_syms)

    _banner("SAMPLE")
    print(f"liquidity ({len(liquidity_syms)}): {', '.join(liquidity_syms)}")
    print(f"split/bonus ({len(split_bonus)}): " +
          (", ".join(f"{s} (ex {d})" for s, d in split_bonus) or "none found in last 2 years"))
    print(f"demerger: {', '.join(demerger_syms)}")
    missing = [s for s in all_syms if s not in sym_ids]
    if missing:
        print(f"[WARN] not found in symbols table, dropped from the sample: {missing}")
        all_syms = [s for s in all_syms if s in sym_ids]

    # ---- a. history depth ----------------------------------------------
    _banner("HISTORY DEPTH (a)")
    depth_syms = [s for s in ("RELIANCE", "HDFCBANK", "TCS") if s in sym_ids] or all_syms[:3]
    today = last_trading_day()
    depth_days: dict[str, int | None] = {}
    for sym in depth_syms:
        for res, label in (("60", "60-min"), ("1", "1-min")):
            oldest = probe_history_depth(fyers, sym, res, limiter)
            days = (today - oldest).days if oldest else None
            if res == "60":
                depth_days[sym] = days
            print(f"  {sym:<12} resolution={label:<7} oldest data ~ {oldest}  "
                  f"(~{days} days back)" if oldest else
                  f"  {sym:<12} resolution={label:<7} no data returned")
    known_depths = [d for d in depth_days.values() if d is not None]
    conservative_depth_days = min(known_depths) if known_depths else None

    # ---- reconciliation sessions (also used by b) -----------------------
    sessions = reconciliation_sessions(args.sessions)

    # ---- b. timestamp convention ----------------------------------------
    _banner("TIMESTAMP CONVENTION (b)")
    ts_symbol = "RELIANCE" if "RELIANCE" in sym_ids else all_syms[0]
    first_day = sessions[0]
    ts_bars = fetch_day_bars(fyers, FYERS_SYMBOL_FMT.format(ts_symbol), "60", first_day, limiter)
    if ts_bars.empty:
        print(f"  no 60-min bars returned for {ts_symbol} on {first_day}")
    else:
        stamps = ", ".join(ts.strftime("%H:%M") for ts in ts_bars.index)
        expected = "09:15, 10:15, 11:15, 12:15, 13:15, 14:15, 15:15"
        print(f"  {ts_symbol} {first_day} bar-start timestamps (IST): {stamps}")
        print(f"  expected bar-start convention:                    {expected}")
        print("  MATCH -- timestamps mark bar start" if stamps == expected
              else "  MISMATCH vs expected bar-start convention -- see above")

    # ---- d. reconciliation over `sessions` -------------------------------
    _banner(f"RECONCILIATION (d) -- {len(sessions)} sessions x {len(all_syms)} symbols")
    bhav_cache: dict[date, pd.DataFrame | None] = {}
    native_results, agg_results, yahoo_results = [], [], []
    csv_rows = []

    with engine.connect() as conn:
        for day in sessions:
            if day not in bhav_cache:
                bhav_cache[day] = fetch_bhavcopy(day)
            bhav = bhav_cache[day]
            if bhav is None:
                print(f"[WARN] bhavcopy unavailable for {day}, skipping this session")
                continue
            for sym in all_syms:
                bhav_row = bhav_row_for(bhav, sym)
                if bhav_row is None:
                    continue
                fsym = FYERS_SYMBOL_FMT.format(sym)

                native_df = fetch_day_bars(fyers, fsym, "60", day, limiter)
                native_res = reconcile_day(native_df, bhav_row)
                native_res.update(symbol=sym, day=day)
                native_results.append(native_res)
                csv_rows.append(_csv_row(sym, day, "fyers_60m", native_res))

                min1_df = fetch_day_bars(fyers, fsym, "1", day, limiter)
                agg_df = aggregate_1min_to_hourly(min1_df)
                agg_res = reconcile_day(agg_df, bhav_row)
                agg_res.update(symbol=sym, day=day)
                agg_results.append(agg_res)
                csv_rows.append(_csv_row(sym, day, "fyers_1m_agg", agg_res))

                yahoo_df = stored_hourly(conn, sym_ids[sym], day)
                yahoo_res = reconcile_day(yahoo_df, bhav_row)
                yahoo_res.update(symbol=sym, day=day)
                yahoo_results.append(yahoo_res)
                csv_rows.append(_csv_row(sym, day, "yahoo_1h", yahoo_res))

    _banner("RECONCILIATION RESULTS")
    print_side_by_side([
        ("fyers 60m native", native_results),
        ("fyers 1m agg", agg_results),
        ("yahoo 1h stored", yahoo_results),
    ])
    print()
    print("diagnostics (the Yahoo defects this probe is checking for):")
    print_diagnostics("fyers 60m native", native_results)
    print_diagnostics("fyers 1m agg", agg_results)
    print_diagnostics("yahoo 1h stored", yahoo_results)
    print()
    print_worst("fyers 60m native", native_results)
    print()
    print_worst("fyers 1m agg", agg_results)

    # ---- e. adjustment basis ----------------------------------------------
    _banner("ADJUSTMENT BASIS (e) -- split/bonus symbols")
    if not split_bonus:
        print("  no split/bonus symbols found in the last 2 years")
    for sym, ex_date in split_bonus:
        if sym not in sym_ids:
            continue
        sid = sym_ids[sym]
        fsym = FYERS_SYMBOL_FMT.format(sym)
        for day in sorted(shift_sessions(ex_date, -i) for i in (1, 2, 3)):
            bars = fetch_day_bars(fyers, fsym, "60", day, limiter)
            if bars.empty:
                print(f"  {sym} {day} (ex {ex_date}): no Fyers bars returned")
                continue
            fyers_high, fyers_low = float(bars["high"].max()), float(bars["low"].min())

            with engine.connect() as conn:
                stored_1d = stored_hourly(conn, sid, day, timeframe="1d", source="yfinance")
            so_high = float(stored_1d["high"].iloc[0]) if not stored_1d.empty else None
            so_low = float(stored_1d["low"].iloc[0]) if not stored_1d.empty else None

            if day not in bhav_cache:
                bhav_cache[day] = fetch_bhavcopy(day)
            bhav_row = bhav_row_for(bhav_cache[day], sym)
            bh_high = float(bhav_row["HghPric"]) if bhav_row else None
            bh_low = float(bhav_row["LwPric"]) if bhav_row else None

            basis = compare_adjustment_basis(
                fyers_high, fyers_low, so_high, so_low, bh_high, bh_low
            )
            print(f"  {sym} ex={ex_date} day={day}: fyers hi/lo={fyers_high:.2f}/{fyers_low:.2f}  "
                  f"stored splits_only hi/lo={so_high}/{so_low}  "
                  f"bhavcopy raw hi/lo={bh_high}/{bh_low}  -> matches: {basis}")

    # ---- rate-limit report (c) ---------------------------------------------
    elapsed = time.monotonic() - started
    _banner("RATE LIMITS (c)")
    print(f"  requests made: {limiter.requests_made}")
    print(f"  rate-limit retries: {limiter.retries}")
    print(f"  elapsed: {elapsed:.1f}s (~{limiter.requests_made / elapsed:.1f} req/s achieved, "
          f"throttled to <= {args.rps} req/s)" if elapsed else "")

    # ---- g. verdict ---------------------------------------------------------
    _banner("VERDICT (g)")
    rates_native = rule_pass_rates(native_results)
    rates_agg = rule_pass_rates(agg_results)
    native_rate = rates_native["ALL RULES"]
    agg_rate = rates_agg["ALL RULES"]
    print(f"native 60-min:    {_fmt_pct(native_rate)} of symbol-days pass all rules "
          f"(n={len(native_results)}, threshold {NATIVE_PASS_THRESHOLD:.0%})")
    print(f"1-min aggregated: {_fmt_pct(agg_rate)} of symbol-days pass all rules "
          f"(n={len(agg_results)})")
    print(f"60-min history depth: {conservative_depth_days} days "
          f"(target {HOURLY_BACKFILL_TARGET_DAYS}; conservative = shortest among "
          f"{depth_syms})")

    if native_results and native_rate is not None and native_rate >= NATIVE_PASS_THRESHOLD:
        decision = "USE NATIVE 60-MIN"
    elif agg_results and agg_rate is not None and agg_rate >= NATIVE_PASS_THRESHOLD:
        decision = "USE 1-MIN AGGREGATION"
    else:
        decision = "FYERS FAILS THE CHECK -- fall back to Dhan, then Kite (see plan)"
    print(f"DECISION: {decision}")
    depth_short = (conservative_depth_days is not None
                   and conservative_depth_days < HOURLY_BACKFILL_TARGET_DAYS)
    if depth_short:
        print(f"[NOTE] history is shorter than the {HOURLY_BACKFILL_TARGET_DAYS}-day target; "
              "per the plan, accept the shorter history -- do not splice Yahoo data onto it.")

    csv_path = os.path.join(LOG_DIR, f"reconcile_{now_ist():%Y%m%dT%H%M%S}.csv")
    pd.DataFrame(csv_rows).to_csv(csv_path, index=False)
    print()
    print(f"raw per-symbol-day results ({len(csv_rows)} rows) written to {csv_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
