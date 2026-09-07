"""Signal generation — faithful port of the gist's two signal systems.

1. run_pipeline: the 10-step trend-breakout-retest system (pipeline.py).
2. strategy_1..4 + strategy_ttm_squeeze: the screener strategies.

The gist is the SPEC. scripts/verify_signals.py holds the verbatim gist
code and asserts these ports emit identical signals on real data.

MIN_SCORE = 3 (user-confirmed: the gist's config.py wasn't shared; its
docstring states "Min 3 of 4 required").
"""

import pandas as pd

from app.indicators.core import (
    calc_atr,
    calc_bollinger,
    calc_keltner_channels,
    calc_macd,
    calc_rvol,
    calc_supertrend,
    calc_ttm_squeeze,
    calc_volume_ma,
    volume_confirmed,
    volume_strength_label,
)
from app.indicators.strategy_steps import (
    breakout_strength,
    calc_stop_loss,
    calc_targets,
    classify_entry_mode,
    get_resistance_level,
    is_breakout,
    is_consolidating,
    is_momentum_accelerating,
    is_valid_retest,
    trend_ok,
)

MIN_SCORE = 3


# ==========================================================================
# The 10-step pipeline (pipeline.py)
# ==========================================================================

def run_pipeline(df: pd.DataFrame, symbol: str = "",
                 consolidation_window: int = 15,
                 max_risk_pct: float = 1.0,
                 retest_window: int = 10) -> list[dict]:
    """Full 10-step system on one stock's OHLCV history. Returns signal
    dicts for immediate entries and first valid retests of weak breakouts."""
    if len(df) < 210:  # need enough history for EMA200 + lookbacks
        return []

    atr = calc_atr(df)

    trend_pass = trend_ok(df)
    consolidated = is_consolidating(df, window=consolidation_window)
    resistance = get_resistance_level(df, window=consolidation_window)
    breakout_pass = is_breakout(df, resistance)
    momentum_pass = is_momentum_accelerating(df)
    volume_pass = volume_confirmed(df)
    rvol = calc_rvol(df)
    entry_mode = classify_entry_mode(df, resistance)

    setup_ready = (trend_pass & consolidated.shift(1, fill_value=False)
                   & breakout_pass & momentum_pass & volume_pass)

    results = []

    for i in range(len(df)):
        if not setup_ready.iloc[i]:
            continue

        entry_price = df["close"].iloc[i]
        atr_val = atr.iloc[i]
        mode = entry_mode.iloc[i]

        if mode == "IMMEDIATE":
            structural_low = df["low"].iloc[max(0, i - retest_window):i + 1].min()
            sl = calc_stop_loss(entry_price, structural_low, atr_val,
                                max_risk_pct=max_risk_pct)
            t1, t2 = calc_targets(entry_price, atr_val)

            results.append({
                "symbol": symbol,
                "date": df.index[i],
                "entry_mode": "IMMEDIATE",
                "entry": round(entry_price, 2),
                "stop_loss": sl,
                "target_1": t1,
                "target_2": t2,
                "risk_pct": round((entry_price - sl) / entry_price * 100, 2),
                "atr": round(atr_val, 2),
                "rvol": round(rvol.iloc[i], 2),
                "volume_grade": volume_strength_label(rvol.iloc[i]),
                "breakout_atr": round(breakout_strength(df, resistance).iloc[i], 2),
            })

        elif mode == "WAIT_RETEST":
            end = min(i + retest_window, len(df))
            for j in range(i + 1, end):
                retest_mask = is_valid_retest(df.iloc[:j + 1],
                                              resistance.iloc[:j + 1])
                if retest_mask.iloc[-1]:
                    entry_price_r = df["close"].iloc[j]
                    atr_val_r = atr.iloc[j]
                    structural_low = df["low"].iloc[max(0, j - retest_window):j + 1].min()
                    sl = calc_stop_loss(entry_price_r, structural_low, atr_val_r,
                                        max_risk_pct=max_risk_pct)
                    t1, t2 = calc_targets(entry_price_r, atr_val_r)

                    results.append({
                        "symbol": symbol,
                        "date": df.index[j],
                        "entry_mode": "RETEST",
                        "entry": round(entry_price_r, 2),
                        "stop_loss": sl,
                        "target_1": t1,
                        "target_2": t2,
                        "risk_pct": round((entry_price_r - sl) / entry_price_r * 100, 2),
                        "atr": round(atr_val_r, 2),
                        "rvol": round(rvol.iloc[j], 2),
                        "volume_grade": volume_strength_label(rvol.iloc[j]),
                        "breakout_atr": round(breakout_strength(df, resistance).iloc[i], 2),
                    })
                    break  # only the first valid retest per breakout

    return results


# ==========================================================================
# Screener strategies (trading_screener)
# ==========================================================================

def strategy_1_supertrend_flip(df: pd.DataFrame) -> list[dict]:
    """Supertrend flips RED -> GREEN, confirmed by above-average volume."""
    st_line, direction = calc_supertrend(df)
    vol_ma = calc_volume_ma(df)
    results = []

    for i in range(1, len(df)):
        flipped_bullish = (direction.iloc[i - 1] == -1 and direction.iloc[i] == 1)
        vol_ok = df["volume"].iloc[i] > vol_ma.iloc[i]

        if flipped_bullish and vol_ok:
            entry = df["close"].iloc[i]
            sl = round(st_line.iloc[i] * 0.995, 2)
            results.append({
                "strategy": "S1_ST_Flip",
                "date": df.index[i],
                "entry": round(entry, 2),
                "stop_loss": sl,
                "target_1": round(entry * 1.07, 2),
                "target_2": round(entry * 1.12, 2),
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "supertrend": round(st_line.iloc[i], 2),
                "vol_ratio": round(df["volume"].iloc[i] / vol_ma.iloc[i], 2),
            })

    return results


def strategy_2_macd_zero_cross(df: pd.DataFrame) -> list[dict]:
    """MACD line crosses above zero with Supertrend already green."""
    macd, sig, hist = calc_macd(df)
    _, direction = calc_supertrend(df)
    results = []

    for i in range(10, len(df)):
        crossed_up = macd.iloc[i - 1] <= 0 and macd.iloc[i] > 0
        st_green = direction.iloc[i] == 1

        if crossed_up and st_green:
            entry = df["close"].iloc[i]
            swing_low = df["low"].iloc[i - 10:i].min()
            sl = round(swing_low * 0.995, 2)
            results.append({
                "strategy": "S2_MACD_Zero",
                "date": df.index[i],
                "entry": round(entry, 2),
                "stop_loss": sl,
                "target_1": round(entry * 1.07, 2),
                "target_2": round(entry * 1.12, 2),
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "macd": round(float(macd.iloc[i]), 4),
            })

    return results


def strategy_3_bb_squeeze_breakout(df: pd.DataFrame,
                                   squeeze_threshold: float = 0.03,
                                   squeeze_window: int = 10,
                                   vol_multiplier: float = 1.5) -> list[dict]:
    """Bands narrow (squeeze), then close above upper band on volume surge."""
    upper, middle, lower, bw = calc_bollinger(df)
    vol_ma = calc_volume_ma(df)
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
                "strategy": "S3_BB_Squeeze",
                "date": df.index[i],
                "entry": round(entry, 2),
                "stop_loss": sl,
                "target_1": round(entry * 1.08, 2),
                "target_2": round(entry * 1.15, 2),
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "upper_bb": round(upper.iloc[i], 2),
                "middle_bb": round(middle.iloc[i], 2),
                "bandwidth": round(bw.iloc[i], 4),
                "vol_ratio": round(df["volume"].iloc[i] / vol_ma.iloc[i], 2),
            })

    return results


def strategy_4_confluence(df: pd.DataFrame, min_score: int = None) -> list[dict]:
    """Score-based confluence: Supertrend (veto) + MACD + BB position +
    volume; min 3 of 4, with a room-to-upper-band skip."""
    if min_score is None:
        min_score = MIN_SCORE

    st_line, direction = calc_supertrend(df)
    macd, sig, hist = calc_macd(df)
    upper, middle, lower, bw = calc_bollinger(df)
    vol_ma = calc_volume_ma(df)
    results = []

    for i in range(30, len(df)):
        close = df["close"].iloc[i]
        score = 0
        breakdown = {}

        st_ok = direction.iloc[i] == 1
        if not st_ok:
            continue  # hard veto
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
            rr = round((t1 - entry) / (entry - sl), 2) if entry > sl else 0
            conviction = ("HIGH ⚡" if hc_flag
                          else ("STRONG" if score == 4 else "MODERATE"))

            results.append({
                "strategy": "Confluence",
                "date": df.index[i],
                "entry": round(entry, 2),
                "stop_loss": sl,
                "target_1": t1,
                "target_2": round(entry * 1.12, 2),
                "rr_ratio": rr,
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "score": f"{score}/4",
                "conviction": conviction,
                "supertrend": round(st_line.iloc[i], 2),
                "breakdown": breakdown,
            })

    return results


def strategy_ttm_squeeze(df: pd.DataFrame) -> list[dict]:
    """TTM squeeze fires with positive, rising momentum and Supertrend green."""
    squeeze_on, squeeze_off, momentum = calc_ttm_squeeze(df)
    _, kc_mid, _ = calc_keltner_channels(df)
    _, direction = calc_supertrend(df)

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
            rr = round((t1 - entry) / (entry - sl), 2) if entry > sl else 0

            results.append({
                "strategy": "TTM_Squeeze",
                "date": df.index[i],
                "entry": round(entry, 2),
                "stop_loss": sl,
                "target_1": t1,
                "target_2": round(entry * 1.15, 2),
                "rr_ratio": rr,
                "risk_pct": round((entry - sl) / entry * 100, 2),
                "momentum": round(float(momentum.iloc[i]), 4),
                "kc_mid": round(float(kc_mid.iloc[i]), 2),
                "squeeze_bars": int(squeeze_on.iloc[max(0, i - 20):i].sum()),
            })

    return results


# Registry used by the service layer. "PIPELINE" wraps run_pipeline; the
# screener strategies already tag themselves via their "strategy" key.
STRATEGY_FUNCS = {
    "PIPELINE": lambda df: [{**s, "strategy": "PIPELINE"} for s in run_pipeline(df)],
    "S1_ST_Flip": strategy_1_supertrend_flip,
    "S2_MACD_Zero": strategy_2_macd_zero_cross,
    "S3_BB_Squeeze": strategy_3_bb_squeeze_breakout,
    "Confluence": strategy_4_confluence,
    "TTM_Squeeze": strategy_ttm_squeeze,
}
