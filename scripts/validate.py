"""Validate ingested candle data.

Layer 1 — internal consistency, FULL dataset (derived data is rechecked
everywhere, not sampled):
  1. OHLC invariants (high >= max(o,c), low <= min(o,c), positive prices)
  2. No candles on non-trading days (weekends/holidays via XBOM calendar)
  3. Every stored 4h candle equals the aggregate of its 1h constituents
  4. Symbols with daily data but no hourly (coverage gaps)

Layer 2 — external validation, SAMPLED: daily candles vs NSE's official
bhavcopy (UDiFF) for sampled dates and symbols. Our prices are Fyers-adjusted
(split/bonus/rights adjusted, NOT dividend-adjusted) while bhavcopy is
unadjusted for everything. So dividends do not explain a mismatch on any
date: only a split, bonus, demerger or rights issue between the sampled date
and today should move our price away from the official one. Splits/bonuses
are looked up in corporate_actions and exempted by their price_factor;
symbols with a later rights issue or demerger are exempted as unexplained-by-
design; anything else that differs is a real failure.

Layer 3 — intraday/daily gate: bar_checks status counts (last 20 sessions),
the worst symbols, FAIL on any candle row whose source is not 'fyers', and a
report-only list of demergers where Fyers left a price cliff.

Run: .venv/bin/python scripts/validate.py
"""

import random
import sys
from datetime import timedelta

import pandas as pd
from sqlalchemy import text

sys.path.insert(0, ".")
from app.db import engine  # noqa: E402
from app.ingest.bhavcopy import fetch_bhavcopy  # noqa: E402
from app.market_calendar import IST, last_trading_day, now_ist  # noqa: E402
import exchange_calendars as xcals  # noqa: E402

random.seed(42)
FAILURES = []


def check(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


# ---------------------------------------------------------------- layer 1
print("=" * 70)
print("LAYER 1: internal consistency (full dataset)")
print("=" * 70)

with engine.connect() as conn:
    bad = conn.execute(text("""
        SELECT count(*) FROM candles
        WHERE high < GREATEST(open, close) - 1e-9
           OR low  > LEAST(open, close) + 1e-9
           OR high < low
           OR open <= 0 OR close <= 0 OR volume < 0
    """)).scalar()
    total = conn.execute(text("SELECT count(*) FROM candles")).scalar()
    check("OHLC invariants", bad == 0, f"{bad} violations in {total:,} rows")

    # trading-calendar alignment
    cal = xcals.get_calendar("XBOM")
    dates = [r[0] for r in conn.execute(text(
        "SELECT DISTINCT (ts AT TIME ZONE 'Asia/Kolkata')::date FROM candles"
    ))]
    sessions = {
        d.date() for d in cal.sessions_in_range(
            str(min(dates)), str(max(dates))
        )
    }
    off_days = sorted(d for d in dates if d not in sessions)
    # An off-calendar date with broad participation is a real market session
    # the library doesn't model (Diwali Muhurat trading, or a wrong holiday
    # in its projected future calendar). Only thin off-calendar dates — a
    # handful of symbols — would indicate genuinely bad data.
    suspicious = []
    for d in off_days:
        n = conn.execute(text(
            "SELECT count(DISTINCT symbol_id) FROM candles "
            "WHERE (ts AT TIME ZONE 'Asia/Kolkata')::date = :d"
        ), {"d": d}).scalar()
        if n < 50:
            suspicious.append((d, n))
        else:
            print(f"[INFO] off-calendar date {d}: {n} symbols traded — real "
                  "session (Muhurat or calendar-projection gap), data kept")
    check(
        "No thin off-calendar dates (bad data)",
        len(suspicious) == 0,
        f"{len(suspicious)} suspicious dates: {suspicious[:5]}"
        if suspicious else "0 suspicious dates",
    )

    # full 4h-vs-1h recheck
    mismatch = conn.execute(text("""
        WITH h AS (
          SELECT symbol_id,
                 (ts AT TIME ZONE 'Asia/Kolkata')::date AS d,
                 CASE WHEN (ts AT TIME ZONE 'Asia/Kolkata')::time < '13:15'
                      THEN time '09:15' ELSE time '13:15' END AS b,
                 ts, open, high, low, close, volume
          FROM candles WHERE timeframe = '1h'
        ), agg AS (
          SELECT symbol_id, d, b,
                 (array_agg(open  ORDER BY ts))[1]      AS o,
                 max(high) AS hi, min(low) AS lo,
                 (array_agg(close ORDER BY ts DESC))[1] AS c,
                 sum(volume) AS v
          FROM h GROUP BY 1, 2, 3
        )
        SELECT
          count(*) FILTER (WHERE f.id IS NULL)                    AS missing_4h,
          count(*) FILTER (WHERE f.id IS NOT NULL AND (
              abs(f.open - a.o) > 1e-6 OR abs(f.high - a.hi) > 1e-6 OR
              abs(f.low - a.lo) > 1e-6 OR abs(f.close - a.c) > 1e-6 OR
              f.volume <> a.v))                                   AS wrong_4h,
          count(*)                                                AS bins
        FROM agg a
        LEFT JOIN candles f
          ON f.timeframe = '4h' AND f.symbol_id = a.symbol_id
         AND (f.ts AT TIME ZONE 'Asia/Kolkata') = a.d + a.b
    """)).one()
    check(
        "4h candles = aggregate of 1h constituents (all bins)",
        mismatch.missing_4h == 0 and mismatch.wrong_4h == 0,
        f"{mismatch.bins:,} bins checked, "
        f"{mismatch.missing_4h} missing, {mismatch.wrong_4h} wrong",
    )

    # orphan 4h rows with no hourly backing
    orphans = conn.execute(text("""
        SELECT count(*) FROM candles f
        WHERE f.timeframe = '4h' AND NOT EXISTS (
          SELECT 1 FROM candles h
          WHERE h.timeframe = '1h' AND h.symbol_id = f.symbol_id
            AND h.ts >= f.ts AND h.ts < f.ts + interval '4 hours')
    """)).scalar()
    check("No orphan 4h candles", orphans == 0, f"{orphans} orphans")

    # coverage gaps
    no_hourly = [r[0] for r in conn.execute(text("""
        SELECT s.symbol FROM symbols s
        WHERE EXISTS (SELECT 1 FROM candles c
                      WHERE c.symbol_id = s.id AND c.timeframe = '1d')
          AND NOT EXISTS (SELECT 1 FROM candles c
                          WHERE c.symbol_id = s.id AND c.timeframe = '1h')
        ORDER BY 1"""))]
    print(f"[INFO] symbols with daily but no hourly data: {len(no_hourly)}")
    if no_hourly:
        print("       " + ", ".join(no_hourly))

# ---------------------------------------------------------------- layer 2
print()
print("=" * 70)
print("LAYER 2: sampled daily candles vs official NSE bhavcopy")
print("=" * 70)

def split_ratio_since(symbol: str, day) -> float:
    """Cumulative split/bonus ratio applied to `symbol` strictly after `day`,
    from corporate_actions (price_factor: prior prices x factor). Fyers-stored
    prices equal raw / ratio, so ratio = 1 / product(price_factor).
    Returns 1.0 when there is none."""
    with engine.connect() as conn:
        factors = [r[0] for r in conn.execute(text("""
            SELECT ca.price_factor FROM corporate_actions ca
            JOIN symbols s ON s.id = ca.symbol_id
            WHERE s.symbol = :s AND ca.ex_date > :d
              AND ca.action_type IN ('split', 'bonus')
              AND ca.price_factor IS NOT NULL AND ca.price_factor > 0
        """), {"s": symbol, "d": day})]
    ratio = 1.0
    for f in factors:
        ratio /= float(f)
    return ratio


def has_unmodelled_action_since(symbol: str, day) -> bool:
    """A rights issue or demerger after `day`: no stored ratio, so a price
    mismatch for it cannot be checked against the bhavcopy."""
    with engine.connect() as conn:
        return conn.execute(text("""
            SELECT 1 FROM corporate_actions ca
            JOIN symbols s ON s.id = ca.symbol_id
            WHERE s.symbol = :s AND ca.ex_date > :d
              AND ca.action_type IN ('rights', 'demerger') LIMIT 1
        """), {"s": symbol, "d": day}).first() is not None


SAMPLE_N = 15
PRICE_TOL = 0.0005  # 0.05% — covers paise rounding
PAIRS = [("open", "OpnPric"), ("high", "HghPric"),
         ("low", "LwPric"), ("close", "ClsPric")]


def matches(ours, official, ratio=1.0):
    """Our stored prices are split-adjusted, bhavcopy is raw, so a split after
    the sampled date divides ours by its cumulative ratio. Fyers applies
    ratios rounded to 2 decimals (a 1:3 bonus as 1.33, not 4/3), so either
    the exact or the rounded ratio counts as a match."""
    def ok(r):
        return all(
            abs(ours[a] - official[b] / r) / (official[b] / r) <= PRICE_TOL
            for a, b in PAIRS
        )
    return ok(ratio) or (ratio != 1.0 and ok(round(ratio, 2)))

t_last = last_trading_day()
older = last_trading_day(t_last - timedelta(days=21))
for day, label in [(t_last, "latest trading day"), (older, "~3 weeks back")]:
    try:
        bhav = fetch_bhavcopy(day)
    except Exception as e:
        print(f"[WARN] bhavcopy for {day} failed ({e}), skipping")
        continue
    if bhav is None:
        print(f"[WARN] bhavcopy for {day} not available, skipping")
        continue

    with engine.connect() as conn:
        db = pd.read_sql(text("""
            SELECT s.symbol, c.open, c.high, c.low, c.close, c.volume
            FROM candles c JOIN symbols s ON s.id = c.symbol_id
            WHERE c.timeframe = '1d'
              AND (c.ts AT TIME ZONE 'Asia/Kolkata')::date = :d
        """), conn, params={"d": day}).set_index("symbol")

    common = sorted(set(db.index) & set(bhav.index))
    sample = random.sample(common, min(SAMPLE_N, len(common)))
    if "RELIANCE" in common and "RELIANCE" not in sample:
        sample[0] = "RELIANCE"

    exact = vol_off = 0
    unexplained, split_exempt, other_exempt = set(), set(), set()
    for sym in sample:
        ours, official = db.loc[sym], bhav.loc[sym]
        price_ok = matches(ours, official)
        vol_ok = (official["TtlTradgVol"] > 0 and
                  abs(ours["volume"] - official["TtlTradgVol"])
                  / official["TtlTradgVol"] <= 0.02)
        if price_ok and vol_ok:
            exact += 1
            continue
        if not price_ok:
            # A split between `day` and today is the one legitimate reason our
            # split-adjusted price differs from the raw official one. Require
            # the gap to actually equal that ratio, not merely that one exists.
            ratio = split_ratio_since(sym, day)
            if ratio != 1.0 and matches(ours, official, ratio):
                split_exempt.add(sym)
            elif has_unmodelled_action_since(sym, day):
                other_exempt.add(sym)
            else:
                unexplained.add(sym)
        if not vol_ok:
            vol_off += 1
        print(f"       DIFF {sym} ({day}): "
              f"close ours={ours['close']:.2f} "
              f"nse={official['ClsPric']:.2f} "
              f"({(ours['close']/official['ClsPric']-1)*100:+.2f}%), "
              f"vol ours={ours['volume']:,} "
              f"nse={official['TtlTradgVol']:,.0f}")

    detail = (f"{day} ({label}): {exact}/{len(sample)} match "
              f"(price tol {PRICE_TOL:.2%}, volume tol 2%)")
    if unexplained:
        detail += f"; unexplained: {', '.join(sorted(unexplained))}"
    if split_exempt:
        detail += f"; split/bonus exempt: {', '.join(sorted(split_exempt))}"
    if other_exempt:
        detail += f"; rights/demerger exempt: {', '.join(sorted(other_exempt))}"
    # A dividend does not shift our prices, so both dates are held to the same
    # bar: every mismatch must be explained by a split/bonus (looked up per
    # symbol above), a rights issue or a demerger, or it is a genuine fault.
    check(f"Bhavcopy price match on {label}", not unexplained, detail)
    check(f"Bhavcopy volume match on {label}", vol_off == 0, detail)

# ---------------------------------------------------------------- layer 3
print()
print("=" * 70)
print("LAYER 3: intraday/daily gate (bar_checks, source, demerger cliffs)")
print("=" * 70)

with engine.connect() as conn:
    days = [r[0] for r in conn.execute(text(
        "SELECT DISTINCT day FROM bar_checks ORDER BY day DESC LIMIT 20"))]
    if not days:
        print("[INFO] bar_checks is empty: no nightly reconcile has run yet")
    else:
        oldest = min(days)
        counts = conn.execute(text("""
            SELECT timeframe, status, count(*) AS n FROM bar_checks
            WHERE day >= :d GROUP BY 1, 2 ORDER BY 1, 2
        """), {"d": oldest}).all()
        print(f"[INFO] bar_checks by status, last {len(days)} sessions "
              f"({oldest} .. {max(days)}):")
        for tf, status, n in counts:
            print(f"       {tf:>3} {status:<8} {n:,}")
        worst = conn.execute(text("""
            SELECT s.symbol,
                   count(*) FILTER (WHERE b.status = 'fail')    AS fails,
                   count(*) FILTER (WHERE b.status = 'pending') AS pendings
            FROM bar_checks b JOIN symbols s ON s.id = b.symbol_id
            WHERE b.day >= :d AND b.status IN ('fail', 'pending')
            GROUP BY s.symbol
            ORDER BY fails DESC, pendings DESC, s.symbol LIMIT 10
        """), {"d": oldest}).all()
        if worst:
            print("[INFO] 10 worst symbols (fail / pending bar-checks):")
            for sym, fails, pendings in worst:
                print(f"       {sym:<14} fail={fails} pending={pendings}")
        else:
            print("[INFO] no fail/pending bar-checks in the window")

    not_fyers = conn.execute(text(
        "SELECT source, count(*) FROM candles WHERE source <> 'fyers' "
        "GROUP BY source ORDER BY 2 DESC")).all()
    check("All candle rows have source = 'fyers'", not not_fyers,
          ", ".join(f"{src}: {n:,}" for src, n in not_fyers[:5])
          if not_fyers else "0 non-fyers rows")

    # Demerger cliffs: stored 1d close on the session before ex_date vs the
    # open on ex_date. Report only — handling is a later decision.
    cliffs = conn.execute(text("""
        WITH d AS (
          SELECT ca.symbol_id, ca.ex_date FROM corporate_actions ca
          WHERE ca.action_type = 'demerger'
        ), ex AS (
          SELECT d.symbol_id, d.ex_date,
                 (SELECT c.open FROM candles c
                   WHERE c.symbol_id = d.symbol_id AND c.timeframe = '1d'
                     AND (c.ts AT TIME ZONE 'Asia/Kolkata')::date = d.ex_date
                 ) AS ex_open,
                 (SELECT c.close FROM candles c
                   WHERE c.symbol_id = d.symbol_id AND c.timeframe = '1d'
                     AND (c.ts AT TIME ZONE 'Asia/Kolkata')::date < d.ex_date
                   ORDER BY c.ts DESC LIMIT 1) AS prev_close
          FROM d
        )
        SELECT s.symbol, ex.ex_date, ex.prev_close, ex.ex_open,
               (ex.ex_open / ex.prev_close - 1) * 100 AS gap_pct
        FROM ex JOIN symbols s ON s.id = ex.symbol_id
        WHERE ex.prev_close > 0 AND ex.ex_open IS NOT NULL
          AND abs(ex.ex_open / ex.prev_close - 1) > 0.10
        ORDER BY abs(ex.ex_open / ex.prev_close - 1) DESC
    """)).all()
    print(f"[INFO] Fyers left a demerger cliff (handle later): "
          f"{len(cliffs)} demergers with |gap| > 10% (report only)")
    for sym, ex_date, prev_close, ex_open, gap in cliffs:
        print(f"       {sym:<14} ex {ex_date}: prev close {prev_close:.2f} -> "
              f"open {ex_open:.2f} ({gap:+.1f}%)")

print()
print("=" * 70)
if FAILURES:
    print(f"RESULT: {len(FAILURES)} CHECK(S) FAILED: {FAILURES}")
    sys.exit(1)
print("RESULT: all checks passed")
