"""Parity check: app.indicators.* vs the VERBATIM gist code.

The reference implementations below are copied character-for-character from
the shared gists (indicators.py, trend_filter.py, consolidation.py,
breakout.py, momentum.py, entry_retest.py, volume_confirm.py, and the
screener's Bollinger/Keltner/TTM helpers). This script runs both versions
on real candle data from the DB and asserts the outputs are identical.

Run: .venv/bin/python scripts/verify_indicators.py
"""

import random
import sys

import numpy as np
import pandas as pd
from sqlalchemy import text

sys.path.insert(0, ".")
from app.db import engine  # noqa: E402
from app.indicators import core, strategy_steps  # noqa: E402

random.seed(7)
SAMPLE_SYMBOLS = 12
FAILURES = []

# ========================================================================
# VERBATIM GIST REFERENCE IMPLEMENTATIONS — do not modify
# ========================================================================

def ref_calc_atr(df, period=10):
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = true_range.ewm(alpha=1 / period, adjust=False).mean()
    return atr


def ref_calc_supertrend(df, period=10, multiplier=3.0):
    atr = ref_calc_atr(df, period)
    hl2 = (df["high"] + df["low"]) / 2
    basic_upper = hl2 + multiplier * atr
    basic_lower = hl2 - multiplier * atr
    final_upper = basic_upper.copy()
    final_lower = basic_lower.copy()
    direction = pd.Series(1, index=df.index)
    st_line = pd.Series(0.0, index=df.index)
    for i in range(1, len(df)):
        close_prev = df["close"].iloc[i - 1]
        if basic_upper.iloc[i] < final_upper.iloc[i - 1] or close_prev > final_upper.iloc[i - 1]:
            final_upper.iloc[i] = basic_upper.iloc[i]
        else:
            final_upper.iloc[i] = final_upper.iloc[i - 1]
        if basic_lower.iloc[i] > final_lower.iloc[i - 1] or close_prev < final_lower.iloc[i - 1]:
            final_lower.iloc[i] = basic_lower.iloc[i]
        else:
            final_lower.iloc[i] = final_lower.iloc[i - 1]
        close_now = df["close"].iloc[i]
        if direction.iloc[i - 1] == 1:
            if close_now < final_lower.iloc[i]:
                direction.iloc[i] = -1
            else:
                direction.iloc[i] = 1
        else:
            if close_now > final_upper.iloc[i]:
                direction.iloc[i] = 1
            else:
                direction.iloc[i] = -1
        st_line.iloc[i] = final_lower.iloc[i] if direction.iloc[i] == 1 else final_upper.iloc[i]
    return st_line, direction


def ref_calc_macd(df, fast=12, slow=26, signal=9):
    ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def ref_calc_ema(series, period):
    return series.ewm(span=period, adjust=False).mean()


def ref_calc_adx(df, period=14):
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    prev_high = high.shift(1)
    prev_low = low.shift(1)
    plus_dm = (high - prev_high).clip(lower=0)
    minus_dm = (prev_low - low).clip(lower=0)
    plus_dm[plus_dm < minus_dm] = 0
    minus_dm[minus_dm < plus_dm] = 0
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = true_range.ewm(alpha=1 / period, adjust=False).mean()
    plus_di = 100 * (plus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr)
    minus_di = 100 * (minus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx = dx.ewm(alpha=1 / period, adjust=False).mean()
    return adx


def ref_trend_ok(df, adx_threshold=25.0):
    ema50 = ref_calc_ema(df["close"], 50)
    ema200 = ref_calc_ema(df["close"], 200)
    adx = ref_calc_adx(df)
    price_above = df["close"] > ema50
    ema_stack = ema50 > ema200
    ema50_rising = ema50.diff() > 0
    adx_strong = adx > adx_threshold
    return price_above & ema_stack & ema50_rising & adx_strong


def ref_calc_bollinger(df, period=20, std_dev=2.0):
    middle = df["close"].rolling(period).mean()
    sd = df["close"].rolling(period).std()
    upper = middle + std_dev * sd
    lower = middle - std_dev * sd
    bw = (upper - lower) / middle
    return upper, middle, lower, bw


def ref_calc_volume_ma(df, period=20):
    return df["volume"].rolling(period).mean()


def ref_calc_keltner_channels(df, ema_period=20, atr_period=10, multiplier=1.5):
    ema = df["close"].ewm(span=ema_period, adjust=False).mean()
    atr = ref_calc_atr(df, atr_period)
    kc_upper = ema + multiplier * atr
    kc_lower = ema - multiplier * atr
    return kc_upper, ema, kc_lower


def ref_calc_ttm_squeeze(df, bb_period=20, bb_std=2.0, kc_ema_period=20,
                         kc_atr_period=10, kc_mult=1.5):
    bb_upper, bb_mid, bb_lower, _ = ref_calc_bollinger(df, bb_period, bb_std)
    kc_upper, kc_mid, kc_lower = ref_calc_keltner_channels(
        df, kc_ema_period, kc_atr_period, kc_mult)
    squeeze_on = (bb_upper < kc_upper) & (bb_lower > kc_lower)
    squeeze_off = squeeze_on.shift(1, fill_value=False) & ~squeeze_on
    highest_high = df["high"].rolling(bb_period).max()
    lowest_low = df["low"].rolling(bb_period).min()
    mid_range = (highest_high + lowest_low) / 2
    delta = df["close"] - ((mid_range + kc_mid) / 2)
    momentum = delta.ewm(span=bb_period, adjust=False).mean()
    return squeeze_on, squeeze_off, momentum


def ref_calc_rvol(df, period=20):
    vol_ma = df["volume"].rolling(period).mean()
    return df["volume"] / vol_ma


def ref_is_consolidating(df, window=15, range_pct_max=0.05, atr_lookback=10):
    rolling_high = df["high"].shift(1).rolling(window).max()
    rolling_low = df["low"].shift(1).rolling(window).min()
    range_pct = (rolling_high - rolling_low) / rolling_low
    atr = ref_calc_atr(df)
    atr_falling = atr.diff(atr_lookback) < 0
    return (range_pct < range_pct_max) & atr_falling


def ref_get_resistance_level(df, window=15):
    return df["high"].shift(1).rolling(window).max()


def ref_is_breakout(df, resistance, atr_buffer=0.2):
    atr = ref_calc_atr(df)
    clearance = df["close"] - resistance
    return clearance >= (atr_buffer * atr)


def ref_breakout_strength(df, resistance):
    atr = ref_calc_atr(df)
    return (df["close"] - resistance) / atr


def ref_is_momentum_accelerating(df, lookback=2):
    _, _, hist = ref_calc_macd(df)
    positive = hist > 0
    rising = hist.diff(lookback) > 0
    return positive & rising


def ref_classify_entry_mode(df, resistance, strong_threshold=0.5):
    strength = ref_breakout_strength(df, resistance)
    mode = pd.Series("NONE", index=df.index)
    mode[strength >= strong_threshold] = "IMMEDIATE"
    mode[(strength > 0) & (strength < strong_threshold)] = "WAIT_RETEST"
    return mode


def ref_is_valid_retest(df, resistance, retest_window=10, tolerance_pct=0.015):
    near_support = (df["low"] - resistance).abs() / resistance <= tolerance_pct
    held_as_support = df["close"] > resistance
    bullish_candle = df["close"] > df["open"]
    return near_support & held_as_support & bullish_candle


# ========================================================================
# Comparison harness
# ========================================================================

def series_equal(a, b) -> tuple[bool, float]:
    """Exact equality for floats (NaN == NaN), booleans, ints, strings."""
    a, b = pd.Series(a), pd.Series(b)
    if a.dtype.kind not in "fiub" or b.dtype.kind not in "fiub":  # strings
        return bool((a == b).all()), 0.0
    an, bn = a.to_numpy(dtype=float), b.to_numpy(dtype=float)
    both_nan = np.isnan(an) & np.isnan(bn)
    diff = np.abs(an - bn)
    diff[both_nan] = 0.0
    max_diff = np.nanmax(diff) if len(diff) else 0.0
    return bool(np.all((diff == 0) | both_nan)), float(max_diff)


def compare(name, prod_outputs, ref_outputs, results):
    if not isinstance(prod_outputs, tuple):
        prod_outputs, ref_outputs = (prod_outputs,), (ref_outputs,)
    for k, (p, r) in enumerate(zip(prod_outputs, ref_outputs)):
        ok, max_diff = series_equal(p, r)
        key = f"{name}[{k}]" if len(prod_outputs) > 1 else name
        results.setdefault(key, {"ok": True, "max_diff": 0.0})
        results[key]["ok"] &= ok
        results[key]["max_diff"] = max(results[key]["max_diff"], max_diff)


with engine.connect() as conn:
    syms = [r[0] for r in conn.execute(text(
        "SELECT DISTINCT s.symbol FROM symbols s "
        "JOIN candles c ON c.symbol_id = s.id"))]
sample = random.sample(syms, min(SAMPLE_SYMBOLS, len(syms)))
if "RELIANCE" not in sample:
    sample[0] = "RELIANCE"

results: dict = {}
checked = 0
for symbol in sample:
    for tf in ("1h", "4h", "1d"):
        with engine.connect() as conn:
            df = pd.read_sql(text("""
                SELECT c.ts, c.open, c.high, c.low, c.close, c.volume::float AS volume
                FROM candles c JOIN symbols s ON s.id = c.symbol_id
                WHERE s.symbol = :sym AND c.timeframe = :tf ORDER BY c.ts
            """), conn, params={"sym": symbol, "tf": tf}).set_index("ts")
        if len(df) < 60:
            continue
        checked += 1

        compare("atr", core.calc_atr(df), ref_calc_atr(df), results)
        compare("supertrend", core.calc_supertrend(df), ref_calc_supertrend(df), results)
        compare("macd", core.calc_macd(df), ref_calc_macd(df), results)
        compare("ema50", core.calc_ema(df["close"], 50), ref_calc_ema(df["close"], 50), results)
        compare("ema200", core.calc_ema(df["close"], 200), ref_calc_ema(df["close"], 200), results)
        compare("adx", core.calc_adx(df), ref_calc_adx(df), results)
        compare("bollinger", core.calc_bollinger(df), ref_calc_bollinger(df), results)
        compare("volume_ma", core.calc_volume_ma(df), ref_calc_volume_ma(df), results)
        compare("keltner", core.calc_keltner_channels(df), ref_calc_keltner_channels(df), results)
        compare("ttm_squeeze", core.calc_ttm_squeeze(df), ref_calc_ttm_squeeze(df), results)
        compare("rvol", core.calc_rvol(df), ref_calc_rvol(df), results)

        res = ref_get_resistance_level(df)
        compare("trend_ok", strategy_steps.trend_ok(df), ref_trend_ok(df), results)
        compare("is_consolidating", strategy_steps.is_consolidating(df), ref_is_consolidating(df), results)
        compare("resistance", strategy_steps.get_resistance_level(df), res, results)
        compare("is_breakout", strategy_steps.is_breakout(df, res), ref_is_breakout(df, res), results)
        compare("breakout_strength", strategy_steps.breakout_strength(df, res), ref_breakout_strength(df, res), results)
        compare("momentum_accel", strategy_steps.is_momentum_accelerating(df), ref_is_momentum_accelerating(df), results)
        compare("entry_mode", strategy_steps.classify_entry_mode(df, res), ref_classify_entry_mode(df, res), results)
        compare("valid_retest", strategy_steps.is_valid_retest(df, res), ref_is_valid_retest(df, res), results)

print(f"Compared {len(results)} indicator outputs across {checked} "
      f"symbol-timeframe series ({len(sample)} symbols x 3 timeframes)\n")
for name, r in sorted(results.items()):
    status = "PASS" if r["ok"] else "FAIL"
    print(f"[{status}] {name:<22} max |prod - gist| = {r['max_diff']:.3e}")
    if not r["ok"]:
        FAILURES.append(name)

print()
if FAILURES:
    print(f"RESULT: {len(FAILURES)} PARITY FAILURE(S): {FAILURES}")
    sys.exit(1)
print("RESULT: all implementations are exactly identical to the gist code")
