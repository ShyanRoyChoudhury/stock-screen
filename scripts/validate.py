"""Validate ingested candle data.

Layer 1 — internal consistency, FULL dataset (derived data is rechecked
everywhere, not sampled):
  1. OHLC invariants (high >= max(o,c), low <= min(o,c), positive prices)
  2. No candles on non-trading days (weekends/holidays via XBOM calendar)
  3. Every stored 4h candle equals the aggregate of its 1h constituents
  4. Symbols with daily data but no hourly (coverage gaps)

Layer 2 — external validation, SAMPLED: daily candles vs NSE's official
bhavcopy (UDiFF) for sampled dates and symbols. Caveat: our prices are
yfinance auto_adjust=True (dividend/split adjusted); bhavcopy is unadjusted.
On the latest trading day they must match exactly; on older dates a stock
with an ex-dividend/split in between will differ by the adjustment factor —
reported, not failed.

Run: .venv/bin/python scripts/validate.py
"""

import io
import random
import ssl
import sys
import urllib.request
import zipfile
from datetime import timedelta

import pandas as pd
from sqlalchemy import text

sys.path.insert(0, ".")
from app.db import engine  # noqa: E402
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

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch_bhavcopy(day) -> pd.DataFrame | None:
    url = ("https://nsearchives.nseindia.com/content/cm/"
           f"BhavCopy_NSE_CM_0_0_0_{day.strftime('%Y%m%d')}_F_0000.csv.zip")
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Referer": "https://www.nseindia.com/"})
    try:
        with urllib.request.urlopen(req, timeout=45, context=SSL_CTX) as r:
            raw = r.read()
    except urllib.error.HTTPError:
        return None
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        raw = z.read(z.namelist()[0])
    df = pd.read_csv(io.BytesIO(raw))
    df = df[df["SctySrs"].isin(["EQ", "BE", "BZ"])]
    return df.set_index("TckrSymb")


SAMPLE_N = 15
PRICE_TOL = 0.0005  # 0.05% — covers paise rounding

t_last = last_trading_day()
older = last_trading_day(t_last - timedelta(days=21))
for day, label in [(t_last, "latest trading day"), (older, "~3 weeks back")]:
    bhav = fetch_bhavcopy(day)
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

    exact = price_off = vol_off = 0
    for sym in sample:
        ours, official = db.loc[sym], bhav.loc[sym]
        price_ok = all(
            abs(ours[a] - official[b]) / official[b] <= PRICE_TOL
            for a, b in [("open", "OpnPric"), ("high", "HghPric"),
                         ("low", "LwPric"), ("close", "ClsPric")]
        )
        vol_ok = (official["TtlTradgVol"] > 0 and
                  abs(ours["volume"] - official["TtlTradgVol"])
                  / official["TtlTradgVol"] <= 0.02)
        if price_ok and vol_ok:
            exact += 1
        else:
            if not price_ok:
                price_off += 1
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
    # exact match is required on the latest day; older dates may legitimately
    # carry dividend adjustments, so only report there.
    if day == t_last:
        check(f"Bhavcopy match on {label}", price_off == 0, detail)
        check(f"Bhavcopy volume match on {label}", vol_off == 0, detail)
    else:
        print(f"[INFO] {detail} — diffs on older dates can be legitimate "
              "dividend/split adjustments")

print()
print("=" * 70)
if FAILURES:
    print(f"RESULT: {len(FAILURES)} CHECK(S) FAILED: {FAILURES}")
    sys.exit(1)
print("RESULT: all checks passed")
