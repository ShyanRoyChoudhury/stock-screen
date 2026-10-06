"""Pure reconciliation rules: stored Fyers bars vs the NSE bhavcopy row.

No I/O here -- app.ingest.reconcile_service does the loading and writing.
Differences are signed (ours - NSE). Everything in the reconcile step is
active only when settings.price_source == "fyers" (see reconcile_active).

Tolerances are the Step-5 plan defaults, to be tuned after the switchover
check on 60 sessions:
  prices   within one tick (Rs 0.05)
  1d volume  equal to TtlTradgVol
  1h volume  (sum - TtlTradgVol) / TtlTradgVol within [-5%, +2%]
  1h bars    exactly 7 on a normal session
"""

from dataclasses import dataclass, field

import pandas as pd

TICK = 0.05
_EPS = 1e-9  # float slack so a diff of exactly one tick passes
VOL_PCT_MIN = -5.0
VOL_PCT_MAX = 2.0
HOURLY_BARS = 7  # 09:15 .. 15:15 starts on a normal NSE session
NOTE_MAX = 128

PASS, FAIL, PENDING = "pass", "fail", "pending"
NOTE_PATCHED = "close patched"
NOTE_NOT_IN_BHAV = "not in bhavcopy"
NOTE_NO_BHAV = "bhavcopy not published"


def reconcile_active(price_source: str) -> bool:
    """Gate: reconcile and signal holds exist only on the Fyers feed. On
    yfinance the hourly feed would fail nearly every day."""
    return price_source == "fyers"


def check_timeframe_for(signal_timeframe: str) -> str:
    """bar_checks timeframe governing a signal timeframe: 4h bars are derived
    from 1h, so 4h signals follow the 1h check."""
    return "1d" if signal_timeframe == "1d" else "1h"


@dataclass
class CheckResult:
    status: str
    note: str | None = None
    open_diff: float | None = None
    high_diff: float | None = None
    low_diff: float | None = None
    close_diff: float | None = None
    vol_diff_pct: float | None = None
    bar_count: int | None = None
    # {"close","high","low"} to store on the last hourly bar (status pass only).
    patch: dict | None = field(default=None)

    def max_abs_price_diff(self) -> float:
        d = [abs(x) for x in (self.open_diff, self.high_diff, self.low_diff,
                              self.close_diff) if x is not None]
        return max(d) if d else 0.0


def _within_tick(diff: float) -> bool:
    return abs(diff) <= TICK + _EPS


def _vol_pct(ours: float, theirs: float) -> float | None:
    if not theirs:
        return None
    return (ours - theirs) / theirs * 100.0


def _note(parts: list[str]) -> str | None:
    return ("; ".join(parts))[:NOTE_MAX] if parts else None


def check_daily(bar, bhav_row: dict | None) -> CheckResult:
    """`bar`: mapping/Series with open/high/low/close/volume (or None)."""
    if not bhav_row:
        return CheckResult(FAIL, NOTE_NOT_IN_BHAV)
    if bar is None:
        return CheckResult(FAIL, "no stored fyers bar")
    o = float(bar["open"]) - float(bhav_row["OpnPric"])
    h = float(bar["high"]) - float(bhav_row["HghPric"])
    lo = float(bar["low"]) - float(bhav_row["LwPric"])
    c = float(bar["close"]) - float(bhav_row["ClsPric"])
    ttl = float(bhav_row["TtlTradgVol"])
    vol = float(bar["volume"])
    bad = [n for n, d in (("open", o), ("high", h), ("low", lo), ("close", c))
           if not _within_tick(d)]
    if vol != ttl:
        bad.append(f"volume {int(vol)} != {int(ttl)}")
    return CheckResult(
        FAIL if bad else PASS, _note(bad) if bad else None,
        open_diff=o, high_diff=h, low_diff=lo, close_diff=c,
        vol_diff_pct=_vol_pct(vol, ttl), bar_count=1,
    )


def check_hourly(bars: pd.DataFrame | None, bhav_row: dict | None,
                 expected_bars: int | None = HOURLY_BARS) -> CheckResult:
    """`bars`: one session's 1h bars (columns open/high/low/close/volume,
    time-ordered index). `expected_bars=None` skips the count rule (for
    sessions known to be special; see reconcile_service).

    Rule order: structural/price/volume rules first; a day failing any is
    'fail' regardless. Only a day passing them all can get the last-close
    patch (status stays 'pass', note 'close patched')."""
    if not bhav_row:
        return CheckResult(FAIL, NOTE_NOT_IN_BHAV)
    if bars is None or len(bars) == 0:
        return CheckResult(FAIL, "no stored fyers bars", bar_count=0)
    bars = bars.sort_index()
    n = len(bars)
    h = float(bars["high"].max()) - float(bhav_row["HghPric"])
    lo = float(bars["low"].min()) - float(bhav_row["LwPric"])
    o = float(bars["open"].iloc[0]) - float(bhav_row["OpnPric"])
    last_close = float(bars["close"].iloc[-1])
    c = last_close - float(bhav_row["LastPric"])
    ttl = float(bhav_row["TtlTradgVol"])
    vpct = _vol_pct(float(bars["volume"].sum()), ttl)

    bad = []
    for name, d in (("high", h), ("low", lo), ("open", o)):
        if not _within_tick(d):
            bad.append(f"{name} {d:+.2f}")
    if expected_bars is not None and n != expected_bars:
        bad.append(f"bars {n}!={expected_bars}")
    if vpct is None:
        bad.append("bhav volume 0")
    elif not (VOL_PCT_MIN - _EPS <= vpct <= VOL_PCT_MAX + _EPS):
        bad.append(f"vol {vpct:+.1f}%")

    res = CheckResult(FAIL if bad else PASS, _note(bad),
                      open_diff=o, high_diff=h, low_diff=lo, close_diff=c,
                      vol_diff_pct=vpct, bar_count=n)
    if not bad and not _within_tick(c):
        last_pric = float(bhav_row["LastPric"])
        res.note = NOTE_PATCHED
        res.patch = {
            "close": last_pric,
            "high": max(float(bars["high"].iloc[-1]), last_pric),
            "low": min(float(bars["low"].iloc[-1]), last_pric),
        }
    return res


# --- signal holds (pure selection; the query lives in signals.service) -----

def held_pairs(rows, cutoff_day) -> set[tuple[int, str]]:
    """`rows`: iterable of (symbol_id, check_timeframe, day, status).
    Returns {(symbol_id, check_timeframe)} having a fail/pending row on or
    after `cutoff_day`."""
    return {(sid, tf) for sid, tf, day, status in rows
            if status in (FAIL, PENDING) and day >= cutoff_day}


def is_held(held: set[tuple[int, str]], symbol_id: int, signal_tf: str) -> bool:
    return (symbol_id, check_timeframe_for(signal_tf)) in held
