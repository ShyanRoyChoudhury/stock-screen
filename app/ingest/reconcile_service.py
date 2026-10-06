"""Nightly bhavcopy reconcile: stored Fyers bars vs NSE, written to bar_checks.

Rules live in app.ingest.reconcile (pure); this module loads candles, fetches
the bhavcopy, applies the hourly last-close patch and upserts bar_checks.

Scope of a run:
  - the newest session `day` AND every earlier session ingest's overlap
    re-fetch re-wrote (see refetched_days): every active symbol, 1d and 1h.
    The re-fetch overwrites patched closes with raw Fyers values, so those
    days must be re-checked (and re-patched) every run. `day` is never a
    session that has not closed (see check_day): its bhavcopy cannot exist;
  - every existing 'pending' row up to `day` (bhavcopy may now be published);
  - every 'fail' row within the last `signal_check_lookback_sessions`
    sessions, so a day that ingest's overlap re-fetch has since corrected
    clears itself.
Rows dated after `day` are left alone until that session is the checked one.
"""

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta

import pandas as pd
from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.ingest import reconcile as rules
from app.ingest.bhavcopy import eq_row, fetch_bhavcopy
from app.ingest.resample import resample_1h_to_4h
from app.ingest.service import FYERS_BASIS, FYERS_SOURCE, upsert_candles
from app.market_calendar import (
    IST,
    is_trading_day,
    last_closed_session,
    now_ist,
    shift_sessions,
)
from app.models import BarCheck, Candle, Symbol

logger = logging.getLogger(__name__)

CHECK_TIMEFRAMES = ("1d", "1h")
WORST_N = 10


def _day_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime.combine(d, datetime.min.time(), tzinfo=IST)
    return start, start + timedelta(days=1)


def _load_day_candles(session: Session, d: date, symbol_ids: set[int]) -> dict:
    """{(symbol_id, timeframe): DataFrame} of stored fyers 1d/1h bars for
    session day `d`. One query for the whole day."""
    start, end = _day_bounds(d)
    rows = session.execute(
        select(Candle.symbol_id, Candle.timeframe, Candle.ts, Candle.open,
               Candle.high, Candle.low, Candle.close, Candle.volume)
        .where(Candle.source == FYERS_SOURCE,
               Candle.timeframe.in_(CHECK_TIMEFRAMES),
               Candle.ts >= start, Candle.ts < end,
               Candle.symbol_id.in_(symbol_ids))
        .order_by(Candle.ts)
    ).all()
    grouped: dict = defaultdict(list)
    for sid, tf, ts, o, h, lo, c, v in rows:
        grouped[(sid, tf)].append((ts, o, h, lo, c, v))
    out = {}
    for key, recs in grouped.items():
        df = pd.DataFrame(recs, columns=["ts", "open", "high", "low", "close", "volume"])
        df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.tz_convert(IST)
        out[key] = df.set_index("ts")
    return out


def evaluate(timeframe: str, bars: pd.DataFrame | None, bhav_row: dict | None,
             expected_bars: int | None = rules.HOURLY_BARS) -> rules.CheckResult:
    """Dispatch to the pure rule for a timeframe ('1d' uses the single bar)."""
    if timeframe == "1d":
        bar = None if bars is None or bars.empty else bars.iloc[-1]
        return rules.check_daily(bar, bhav_row)
    return rules.check_hourly(bars, bhav_row, expected_bars)


def _apply_patch(session: Session, symbol_id: int, bars: pd.DataFrame,
                 patch: dict) -> None:
    """Patch the stored last 1h bar, then recompute the day's 4h bars.

    4h choice: re-derive from the patched 1h bars with resample_1h_to_4h and
    upsert, i.e. exactly how ingest builds 4h, rather than hand-patching the
    last 4h bar. One code path, so 4h can never disagree with 1h by
    construction (the second bin's high/low/close all come from 1h)."""
    last_ts = bars.index[-1]
    session.execute(
        update(Candle)
        .where(Candle.symbol_id == symbol_id, Candle.timeframe == "1h",
               Candle.ts == last_ts.to_pydatetime())
        .values(close=patch["close"], high=patch["high"], low=patch["low"])
    )
    patched = bars.copy()
    patched.loc[last_ts, ["close", "high", "low"]] = [
        patch["close"], patch["high"], patch["low"]]
    patched.index = pd.DatetimeIndex(patched.index).tz_convert(IST)
    four_h = resample_1h_to_4h(patched)
    upsert_candles(session, symbol_id, "4h", four_h, FYERS_SOURCE, FYERS_BASIS)


def _upsert_check(session: Session, symbol_id: int, d: date, tf: str,
                  res: rules.CheckResult) -> None:
    values = {
        "symbol_id": symbol_id, "day": d, "timeframe": tf,
        "source": FYERS_SOURCE, "status": res.status,
        "high_diff": res.high_diff, "low_diff": res.low_diff,
        "open_diff": res.open_diff, "close_diff": res.close_diff,
        "vol_diff_pct": res.vol_diff_pct, "bar_count": res.bar_count,
        "note": res.note, "checked_at": datetime.now(IST),
    }
    stmt = pg_insert(BarCheck).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["symbol_id", "day", "timeframe"],
        set_={k: stmt.excluded[k] for k in values
              if k not in ("symbol_id", "day", "timeframe")},
    )
    session.execute(stmt)


def refetched_days(newest_day: date, overlap_days: int) -> list[date]:
    """Pure: the trading sessions ingest's incremental run re-wrote.

    Mirrors app.ingest.service._incremental_start: the fetch starts at
    (last stored candle's IST date - incremental_overlap_days calendar days).
    When ingest runs, the last stored candle is normally the PREVIOUS session
    (the newest one is what it is about to add), so the re-written window is
    every trading session d with prev_session - overlap_days <= d <= newest_day.
    (A run that missed several sessions re-writes even more; those days are
    unchecked until they show up here, which they do for one missed day.)"""
    start = shift_sessions(newest_day, -1) - timedelta(days=overlap_days)
    out = []
    d = newest_day
    while d >= start:
        if is_trading_day(d):
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out) or [newest_day]


def select_targets(newest_day: date, active_ids: set[int],
                   open_rows: list[tuple[int, date, str, str]],
                   overlap_days: int = 0,
                   ) -> dict[date, set[tuple[int, str]]]:
    """Pure: {day: {(symbol_id, timeframe)}} to evaluate. The newest day and
    the sessions covered by the ingest overlap window (`overlap_days`) cover
    every active symbol x timeframe; `open_rows` (symbol_id, day, timeframe,
    status of existing pending/recent-fail rows) add their own keys."""
    targets: dict[date, set] = defaultdict(set)
    days = refetched_days(newest_day, overlap_days)
    for d in {newest_day, *days}:
        for sid in active_ids:
            for tf in CHECK_TIMEFRAMES:
                targets[d].add((sid, tf))
    for sid, d, tf, _status in open_rows:
        targets[d].add((sid, tf))
    return dict(targets)


def _fail_cutoff(newest_day: date) -> date:
    return shift_sessions(newest_day, -(settings.signal_check_lookback_sessions - 1))


def is_resolved(prev_status: str | None, new_status: str) -> bool:
    """Pure: a row that was holding its signals (pending/fail) and now passes."""
    return prev_status in (rules.PENDING, rules.FAIL) and new_status == rules.PASS


def classify_change(prev_status: str | None, new_status: str, patched: bool) -> bool:
    """Pure: did this row change what its signals should be generated from?

    True when it was resolved (pending/fail -> pass: the signal hold lifts, so
    signals skipped earlier are now due) or its last 1h close was patched in
    this run. A row that stays pass/fail/pending, or drops from pass to
    fail/pending (held rows are skipped by signals anyway), is not a change."""
    return patched or is_resolved(prev_status, new_status)


def _load_prev_checks(session: Session, d: date, symbol_ids: set[int],
                      ) -> dict[tuple[int, str], tuple[str, str | None]]:
    """{(symbol_id, timeframe): (status, note)} stored for day `d`, read BEFORE
    this run overwrites them."""
    rows = session.execute(
        select(BarCheck.symbol_id, BarCheck.timeframe, BarCheck.status, BarCheck.note)
        .where(BarCheck.day == d, BarCheck.symbol_id.in_(symbol_ids)))
    return {(r.symbol_id, r.timeframe): (r.status, r.note) for r in rows}


def check_day(requested: date | None, now: datetime) -> date:
    """Pure: the newest session a run checks -- never one that has not closed.

    A session that has not closed (a catch-up run at 08:30, or just after
    midnight) has no bhavcopy yet, so checking it would upsert every active
    symbol 'pending' and hold all their signals until the evening run. `None`
    -> the newest closed session; a `requested` day after it is clamped to it;
    an explicit day on or before it is used as given (a past day still works)."""
    closed = last_closed_session(now)
    if requested is None:
        return closed
    if requested > closed:
        logger.info("session %s has not closed yet; checking %s", requested, closed)
        return closed
    return requested


def run_reconcile(day: date | None = None, symbols: list[str] | None = None,
                  session: Session | None = None) -> dict:
    """Run the reconcile. `day` (default: the newest session that has closed;
    a later one is clamped to it, see check_day) is the newest session to
    check. Returns a summary dict: the checked `day`, the status counts,
    `patched` (close patches applied), `resolved` (pending/fail rows that now
    pass), `changed_symbols` (sorted names with a resolved row or a close
    patch: the ones whose signals need regenerating) and `worst`. Opens (and
    closes) its own session unless one is passed."""
    own = session is None
    session = session or SessionLocal()
    try:
        return _run(session, check_day(day, now_ist()), symbols)
    finally:
        if own:
            session.close()


def _run(session: Session, day: date, symbols: list[str] | None) -> dict:
    sym_stmt = select(Symbol.id, Symbol.symbol).where(Symbol.active.is_(True))
    if symbols:
        sym_stmt = select(Symbol.id, Symbol.symbol).where(Symbol.symbol.in_(symbols))
    names = {sid: name for sid, name in session.execute(sym_stmt)}
    newest_ids = set(names)

    # One query for pending (any day) + recent fails, served by (status, day).
    cutoff = _fail_cutoff(day)
    open_stmt = select(BarCheck.symbol_id, BarCheck.day, BarCheck.timeframe,
                       BarCheck.status).where(
        or_(BarCheck.status == rules.PENDING,
            and_(BarCheck.status == rules.FAIL, BarCheck.day >= cutoff)))
    open_rows = [tuple(r) for r in session.execute(open_stmt)]
    # Rows dated after the checked day belong to a session that has not closed
    # (legacy: runs before check_day existed wrote 'pending' rows for one).
    # Leave them; they are re-checked once that session is the checked one.
    open_rows = [r for r in open_rows if r[1] <= day]
    if symbols:
        open_rows = [r for r in open_rows if r[0] in names]
    extra_ids = {r[0] for r in open_rows} - set(names)
    if extra_ids:
        for sid, name in session.execute(
                select(Symbol.id, Symbol.symbol).where(Symbol.id.in_(extra_ids))):
            names[sid] = name

    targets = select_targets(day, newest_ids, open_rows,
                             settings.incremental_overlap_days)
    counts = {rules.PASS: 0, rules.FAIL: 0, rules.PENDING: 0}
    patched = 0
    resolved = 0
    changed: set[str] = set()  # symbols whose signals need regenerating
    fails: list[tuple[float, str]] = []

    for d in sorted(targets):
        keys = targets[d]
        try:
            bhav = fetch_bhavcopy(d)
            fetch_note = rules.NOTE_NO_BHAV
        except Exception as e:  # network/parse: retry on the next run
            logger.warning("bhavcopy fetch for %s failed: %s", d, e)
            bhav, fetch_note = None, "bhavcopy fetch error"

        if bhav is None:
            for sid, tf in sorted(keys):
                _upsert_check(session, sid, d, tf,
                              rules.CheckResult(rules.PENDING, fetch_note))
                counts[rules.PENDING] += 1
            session.commit()
            continue

        candles = _load_day_candles(session, d, {sid for sid, _ in keys})
        prev = _load_prev_checks(session, d, {sid for sid, _ in keys})
        # A calendar-unknown day (e.g. a Muhurat session) has no fixed bar count.
        expected = rules.HOURLY_BARS if is_trading_day(d) else None

        for sid, tf in sorted(keys):
            prev_status, prev_note = prev.get((sid, tf), (None, None))
            row = eq_row(bhav, names[sid])
            bars = candles.get((sid, tf))
            res = evaluate(tf, bars, row, expected)
            if row is not None and row.get("SctySrs") not in (None, "EQ") \
                    and res.status == rules.PASS and not res.note:
                res.note = f"series {row['SctySrs']}"
            if (res.status == rules.PASS and res.patch is None
                    and prev_note == rules.NOTE_PATCHED):
                res.note = rules.NOTE_PATCHED  # patched on an earlier run
            if res.patch is not None:
                _apply_patch(session, sid, bars, res.patch)
                patched += 1
            _upsert_check(session, sid, d, tf, res)
            counts[res.status] += 1
            if is_resolved(prev_status, res.status):
                resolved += 1
            if classify_change(prev_status, res.status, res.patch is not None):
                changed.add(names[sid])
            if res.status == rules.FAIL:
                fails.append((res.max_abs_price_diff(),
                              f"{names[sid]} {tf} {d}: {res.note}"))
        session.commit()

    fails.sort(key=lambda x: -x[0])
    summary = {
        "day": str(day), "pass": counts[rules.PASS],
        "fail": counts[rules.FAIL], "pending": counts[rules.PENDING],
        "patched": patched, "resolved": resolved,
        "changed_symbols": sorted(changed),
        "worst": [w for _, w in fails[:WORST_N]],
    }
    logger.info("reconcile %s: %s, %d symbol(s) changed", day,
                {k: v for k, v in summary.items() if k not in ("worst", "changed_symbols")},
                len(changed))
    return summary
