"""Parity check: app.signals.core vs the VERBATIM gist signal code.

The reference block below is copied character-for-character from the gists
(pipeline.py + the screener strategies), with only import wiring changed to
local ref_* helpers (themselves verbatim, same as scripts/verify_indicators.py).
Every emitted signal must match field-for-field.

MIN_SCORE = 3 (user-confirmed).

Run: .venv/bin/python scripts/verify_signals.py
"""

import random
import sys

import numpy as np
import pandas as pd
from sqlalchemy import text

sys.path.insert(0, ".")
from app.db import engine  # noqa: E402
from app.signals import core as prod  # noqa: E402

random.seed(11)
SAMPLE_SYMBOLS = 8
MIN_SCORE = 3
FAILURES = []

# ========================================================================
# VERBATIM GIST REFERENCE — indicators + steps (same as verify_indicators)
# ========================================================================

def ref_calc_atr(df, period=10):
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False).mean()


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
            direction.iloc[i] = -1 if close_now < final_lower.iloc[i] else 1
        else:
            direction.iloc[i] = 1 if close_now > final_upper.iloc[i] else -1
        st_line.iloc[i] = final_lower.iloc[i] if direction.iloc[i] == 1 else final_upper.iloc[i]
    return st_line, direction


def ref_calc_macd(df, fast=12, slow=26, signal=9):
    ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line, signal_line, macd_line - signal_line


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
    return dx.ewm(alpha=1 / period, adjust=False).mean()


def ref_trend_ok(df, adx_threshold=25.0):
    ema50 = ref_calc_ema(df["close"], 50)
    ema200 = ref_calc_ema(df["close"], 200)
    adx = ref_calc_adx(df)
    return ((df["close"] > ema50) & (ema50 > ema200)
            & (ema50.diff() > 0) & (adx > adx_threshold))


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
    return (df["close"] - resistance) >= (atr_buffer * atr)


def ref_breakout_strength(df, resistance):
    atr = ref_calc_atr(df)
    return (df["close"] - resistance) / atr


def ref_is_momentum_accelerating(df, lookback=2):
    _, _, hist = ref_calc_macd(df)
    return (hist > 0) & (hist.diff(lookback) > 0)


def ref_calc_rvol(df, period=20):
    vol_ma = df["volume"].rolling(period).mean()
    return df["volume"] / vol_ma


def ref_volume_confirmed(df, period=20, min_rvol=1.5):
    return ref_calc_rvol(df, period) >= min_rvol


def ref_volume_strength_label(rvol_value):
    if rvol_value >= 2.0:
        return "STRONG (>=2x avg)"
    elif rvol_value >= 1.5:
        return "CONFIRMED (>=1.5x avg)"
    else:
        return "WEAK (<1.5x avg)"


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


def ref_calc_stop_loss(entry_price, structural_low, atr_value,
                       atr_buffer=0.5, max_risk_pct=1.0):
    atr_based_stop = structural_low - (atr_buffer * atr_value)
    max_risk_stop = entry_price * (1 - max_risk_pct / 100)
    return round(max(atr_based_stop, max_risk_stop), 2)


def ref_calc_targets(entry_price, atr_value, t1_atr_mult=2.0, t2_atr_mult=3.5):
    t1 = round(entry_price + t1_atr_mult * atr_value, 2)
    t2 = round(entry_price + t2_atr_mult * atr_value, 2)
    return t1, t2


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
    return ema + multiplier * atr, ema, ema - multiplier * atr


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


# ========================================================================
# VERBATIM GIST REFERENCE — run_pipeline (pipeline.py)
# ========================================================================

def ref_run_pipeline(df, symbol="", consolidation_window=15,
                     max_risk_pct=1.0, retest_window=10):
    if len(df) < 210:
        return []

    atr = ref_calc_atr(df)
    trend_pass = ref_trend_ok(df)
    consolidated = ref_is_consolidating(df, window=consolidation_window)
    resistance = ref_get_resistance_level(df, window=consolidation_window)
    breakout_pass = ref_is_breakout(df, resistance)
    momentum_pass = ref_is_momentum_accelerating(df)
    volume_pass = ref_volume_confirmed(df)
    rvol = ref_calc_rvol(df)
    entry_mode = ref_classify_entry_mode(df, resistance)

    setup_ready = trend_pass & consolidated.shift(1, fill_value=False) & breakout_pass & momentum_pass & volume_pass

    results = []
    for i in range(len(df)):
        if not setup_ready.iloc[i]:
            continue
        entry_price = df["close"].iloc[i]
        atr_val = atr.iloc[i]
        mode = entry_mode.iloc[i]

        if mode == "IMMEDIATE":
            structural_low = df["low"].iloc[max(0, i - retest_window):i + 1].min()
            sl = ref_calc_stop_loss(entry_price, structural_low, atr_val, max_risk_pct=max_risk_pct)
            t1, t2 = ref_calc_targets(entry_price, atr_val)
            results.append({
                "symbol": symbol, "date": df.index[i], "entry_mode": "IMMEDIATE",
                "entry": round(entry_price, 2), "stop_loss": sl,
                "target_1": t1, "target_2": t2,
                "risk_pct": round((entry_price - sl) / entry_price * 100, 2),
                "atr": round(atr_val, 2), "rvol": round(rvol.iloc[i], 2),
                "volume_grade": ref_volume_strength_label(rvol.iloc[i]),
                "breakout_atr": round(ref_breakout_strength(df, resistance).iloc[i], 2),
            })
        elif mode == "WAIT_RETEST":
            end = min(i + retest_window, len(df))
            for j in range(i + 1, end):
                retest_mask = ref_is_valid_retest(df.iloc[:j + 1], resistance.iloc[:j + 1])
                if retest_mask.iloc[-1]:
                    entry_price_r = df["close"].iloc[j]
                    atr_val_r = atr.iloc[j]
                    structural_low = df["low"].iloc[max(0, j - retest_window):j + 1].min()
                    sl = ref_calc_stop_loss(entry_price_r, structural_low, atr_val_r, max_risk_pct=max_risk_pct)
                    t1, t2 = ref_calc_targets(entry_price_r, atr_val_r)
                    results.append({
                        "symbol": symbol, "date": df.index[j], "entry_mode": "RETEST",
                        "entry": round(entry_price_r, 2), "stop_loss": sl,
                        "target_1": t1, "target_2": t2,
                        "risk_pct": round((entry_price_r - sl) / entry_price_r * 100, 2),
                        "atr": round(atr_val_r, 2), "rvol": round(rvol.iloc[j], 2),
                        "volume_grade": ref_volume_strength_label(rvol.iloc[j]),
                        "breakout_atr": round(ref_breakout_strength(df, resistance).iloc[i], 2),
                    })
                    break
    return results


# ========================================================================
# VERBATIM GIST REFERENCE — screener strategies
# ========================================================================

def ref_strategy_1(df):
    st_line, direction = ref_calc_supertrend(df)
    vol_ma = ref_calc_volume_ma(df)
    results = []
    for i in range(1, len(df)):
        flipped_bullish = (direction.iloc[i - 1] == -1 and direction.iloc[i] == 1)
        vol_ok = df["volume"].iloc[i] > vol_ma.iloc[i]
        if flipped_bullish and vol_ok:
            entry = df["close"].iloc[i]
            sl = round(st_line.iloc[i] * 0.995, 2)
            results.append({
                "strategy": "S1_ST_Flip", "date": df.index[i],
                "entry": round(entry, 2), "stop_loss": sl,
                "target_1": round(entry * 1.07, 2), "target_2": round(entry * 1.12, 2),
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "supertrend": round(st_line.iloc[i], 2),
                "vol_ratio": round(df["volume"].iloc[i] / vol_ma.iloc[i], 2),
            })
    return results


def ref_strategy_2(df):
    macd, sig, hist = ref_calc_macd(df)
    _, direction = ref_calc_supertrend(df)
    results = []
    for i in range(10, len(df)):
        crossed_up = macd.iloc[i - 1] <= 0 and macd.iloc[i] > 0
        trend_ok_ = direction.iloc[i] == 1
        if crossed_up and trend_ok_:
            entry = df["close"].iloc[i]
            swing_low = df["low"].iloc[i - 10:i].min()
            sl = round(swing_low * 0.995, 2)
            results.append({
                "strategy": "S2_MACD_Zero", "date": df.index[i],
                "entry": round(entry, 2), "stop_loss": sl,
                "target_1": round(entry * 1.07, 2), "target_2": round(entry * 1.12, 2),
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "macd": round(float(macd.iloc[i]), 4),
            })
    return results


def ref_strategy_3(df, squeeze_threshold=0.03, squeeze_window=10, vol_multiplier=1.5):
    upper, middle, lower, bw = ref_calc_bollinger(df)
    vol_ma = ref_calc_volume_ma(df)
    results = []
    squeeze_flag = bw < squeeze_threshold
    for i in range(squeeze_window + 1, len(df)):
        had_squeeze = squeeze_flag.iloc[i - squeeze_window:i].any()
        curr_close = df["close"].iloc[i]
        prev_close = df["close"].iloc[i - 1]
        fresh_break = curr_close > upper.iloc[i] and prev_close <= upper.iloc[i - 1]
        vol_ok = df["volume"].iloc[i] > vol_ma.iloc[i] * vol_multiplier
        if had_squeeze and fresh_break and vol_ok:
            entry = curr_close
            sl = round(middle.iloc[i], 2)
            results.append({
                "strategy": "S3_BB_Squeeze", "date": df.index[i],
                "entry": round(entry, 2), "stop_loss": sl,
                "target_1": round(entry * 1.08, 2), "target_2": round(entry * 1.15, 2),
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "upper_bb": round(upper.iloc[i], 2), "middle_bb": round(middle.iloc[i], 2),
                "bandwidth": round(bw.iloc[i], 4),
                "vol_ratio": round(df["volume"].iloc[i] / vol_ma.iloc[i], 2),
            })
    return results


def ref_strategy_4(df, min_score=None):
    if min_score is None:
        min_score = MIN_SCORE
    st_line, direction = ref_calc_supertrend(df)
    macd, sig, hist = ref_calc_macd(df)
    upper, middle, lower, bw = ref_calc_bollinger(df)
    vol_ma = ref_calc_volume_ma(df)
    results = []
    for i in range(30, len(df)):
        close = df["close"].iloc[i]
        score = 0
        breakdown = {}
        st_ok = direction.iloc[i] == 1
        if not st_ok:
            continue
        score += 1
        breakdown["supertrend"] = "GREEN ✓"
        macd_ok = (macd.iloc[i] > sig.iloc[i]) and (hist.iloc[i] > 0)
        if macd_ok:
            score += 1
            breakdown["macd"] = "Bullish ✓"
        else:
            breakdown["macd"] = "Bearish X"
        start = max(0, i - 10)
        hc_flag = macd_ok and (macd.iloc[start:i] < 0).any()
        breakdown["high_conviction"] = hc_flag
        bb_ok = close > middle.iloc[i]
        if bb_ok:
            score += 1
            breakdown["bb_position"] = "Upper half ✓"
        else:
            breakdown["bb_position"] = "Lower half X"
        room = (upper.iloc[i] - close) / close
        breakdown["room_to_upper"] = f"{room:.1%}"
        if room < 0.01:
            breakdown["bb_position"] += " [Too close to upper band - skip]"
            continue
        vol_ok = df["volume"].iloc[i] > vol_ma.iloc[i]
        if vol_ok:
            score += 1
            breakdown["volume"] = f"{df['volume'].iloc[i]/vol_ma.iloc[i]:.1f}x avg ✓"
        else:
            breakdown["volume"] = f"{df['volume'].iloc[i]/vol_ma.iloc[i]:.1f}x avg X"
        if score >= min_score:
            entry = close
            sl = round(st_line.iloc[i] * 0.99, 2)
            t1 = round(entry * 1.07, 2)
            t2 = round(entry * 1.12, 2)
            rr = round((t1 - entry) / (entry - sl), 2) if entry > sl else 0
            conviction = "HIGH ⚡" if hc_flag else ("STRONG" if score == 4 else "MODERATE")
            results.append({
                "strategy": "Confluence", "date": df.index[i],
                "entry": round(entry, 2), "stop_loss": sl,
                "target_1": t1, "target_2": t2, "rr_ratio": rr,
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "score": f"{score}/4", "conviction": conviction,
                "supertrend": round(st_line.iloc[i], 2), "breakdown": breakdown,
            })
    return results


def ref_strategy_ttm(df):
    squeeze_on, squeeze_off, momentum = ref_calc_ttm_squeeze(df)
    _, kc_mid, _ = ref_calc_keltner_channels(df)
    _, direction = ref_calc_supertrend(df)
    results = []
    for i in range(1, len(df)):
        fired = squeeze_off.iloc[i]
        mom_pos = momentum.iloc[i] > 0
        mom_rise = momentum.iloc[i] > momentum.iloc[i - 1]
        st_green = direction.iloc[i] == 1
        if fired and mom_pos and mom_rise and st_green:
            entry = df["close"].iloc[i]
            sl = round(kc_mid.iloc[i] * 0.99, 2)
            t1 = round(entry * 1.08, 2)
            t2 = round(entry * 1.15, 2)
            rr = round((t1 - entry) / (entry - sl), 2) if entry > sl else 0
            results.append({
                "strategy": "TTM_Squeeze", "date": df.index[i],
                "entry": round(entry, 2), "stop_loss": sl,
                "target_1": t1, "target_2": t2, "rr_ratio": rr,
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "momentum": round(float(momentum.iloc[i]), 4),
                "kc_mid": round(float(kc_mid.iloc[i]), 2),
                "squeeze_bars": int(squeeze_on.iloc[max(0, i - 20):i].sum()),
            })
    return results


# ========================================================================
# Comparison harness
# ========================================================================

def signals_equal(a: list[dict], b: list[dict]) -> str | None:
    """Returns None if identical, else a description of the first diff."""
    if len(a) != len(b):
        return f"count {len(a)} vs {len(b)}"
    for sa, sb in zip(a, b):
        keys = set(sa) | set(sb)
        for k in keys:
            va, vb = sa.get(k), sb.get(k)
            if isinstance(va, float) and isinstance(vb, float):
                if not (va == vb or (pd.isna(va) and pd.isna(vb))):
                    return f"{sa.get('date')} {k}: {va} vs {vb}"
            elif va != vb:
                return f"{sa.get('date')} {k}: {va!r} vs {vb!r}"
    return None


PAIRS = [
    ("PIPELINE", prod.run_pipeline, ref_run_pipeline),
    ("S1_ST_Flip", prod.strategy_1_supertrend_flip, ref_strategy_1),
    ("S2_MACD_Zero", prod.strategy_2_macd_zero_cross, ref_strategy_2),
    ("S3_BB_Squeeze", prod.strategy_3_bb_squeeze_breakout, ref_strategy_3),
    ("Confluence", prod.strategy_4_confluence, ref_strategy_4),
    ("TTM_Squeeze", prod.strategy_ttm_squeeze, ref_strategy_ttm),
]

with engine.connect() as conn:
    syms = [r[0] for r in conn.execute(text(
        "SELECT DISTINCT s.symbol FROM symbols s "
        "JOIN candles c ON c.symbol_id = s.id"))]
sample = random.sample(syms, min(SAMPLE_SYMBOLS, len(syms)))
if "RELIANCE" not in sample:
    sample[0] = "RELIANCE"

stats = {name: {"ok": True, "signals": 0, "series": 0, "diff": None}
         for name, _, _ in PAIRS}

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

        for name, prod_fn, ref_fn in PAIRS:
            p = prod_fn(df)
            r = ref_fn(df)
            # run_pipeline signatures differ (symbol kwarg) — normalize
            for s_ in p + r:
                s_.pop("symbol", None)
            diff = signals_equal(p, r)
            stats[name]["series"] += 1
            stats[name]["signals"] += len(r)
            if diff and stats[name]["ok"]:
                stats[name]["ok"] = False
                stats[name]["diff"] = f"{symbol}/{tf}: {diff}"

print(f"Compared {len(sample)} symbols x 3 timeframes\n")
for name, s_ in stats.items():
    status = "PASS" if s_["ok"] else "FAIL"
    print(f"[{status}] {name:<14} {s_['series']} series, "
          f"{s_['signals']} gist signals, all field-identical"
          if s_["ok"] else
          f"[{status}] {name:<14} FIRST DIFF: {s_['diff']}")
    if not s_["ok"]:
        FAILURES.append(name)

print()
if FAILURES:
    print(f"RESULT: {len(FAILURES)} PARITY FAILURE(S): {FAILURES}")
    sys.exit(1)
print("RESULT: all signal implementations emit output identical to the gist")
