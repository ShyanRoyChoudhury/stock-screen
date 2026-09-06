"""Strategy-step functions from the gist (steps 1-10 of the pipeline).

Ported verbatim in behavior; consumed by the signals phase, not stored
per-candle. Pure indicator math lives in core.py.
"""

import pandas as pd

from app.indicators.core import calc_atr, calc_macd


# ---- STEP 1: trend filter (trend_filter.py) ------------------------------

def trend_ok(df: pd.DataFrame, adx_threshold: float = 25.0) -> pd.Series:
    """close > EMA50 > EMA200, EMA50 rising, ADX > threshold."""
    from app.indicators.core import calc_adx, calc_ema

    ema50 = calc_ema(df["close"], 50)
    ema200 = calc_ema(df["close"], 200)
    adx = calc_adx(df)

    return ((df["close"] > ema50) & (ema50 > ema200)
            & (ema50.diff() > 0) & (adx > adx_threshold))


# ---- STEPS 2-3: consolidation + resistance (consolidation.py) ------------

def is_consolidating(df: pd.DataFrame, window: int = 15,
                     range_pct_max: float = 0.05,
                     atr_lookback: int = 10) -> pd.Series:
    """Tight prior-window range AND falling ATR."""
    rolling_high = df["high"].shift(1).rolling(window).max()
    rolling_low = df["low"].shift(1).rolling(window).min()
    range_pct = (rolling_high - rolling_low) / rolling_low

    atr = calc_atr(df)
    atr_falling = atr.diff(atr_lookback) < 0

    return (range_pct < range_pct_max) & atr_falling


def get_resistance_level(df: pd.DataFrame, window: int = 15) -> pd.Series:
    """Highest high over the PRIOR `window` candles (excludes current bar)."""
    return df["high"].shift(1).rolling(window).max()


# ---- STEP 4: breakout (breakout.py) --------------------------------------

def is_breakout(df: pd.DataFrame, resistance: pd.Series,
                atr_buffer: float = 0.2) -> pd.Series:
    """Close clears resistance by at least atr_buffer x ATR."""
    atr = calc_atr(df)
    return (df["close"] - resistance) >= (atr_buffer * atr)


def breakout_strength(df: pd.DataFrame, resistance: pd.Series) -> pd.Series:
    """How many ATRs above resistance the close is."""
    atr = calc_atr(df)
    return (df["close"] - resistance) / atr


# ---- STEP 5: momentum (momentum.py) --------------------------------------

def is_momentum_accelerating(df: pd.DataFrame, lookback: int = 2) -> pd.Series:
    """MACD histogram positive AND rising vs `lookback` bars ago."""
    _, _, hist = calc_macd(df)
    return (hist > 0) & (hist.diff(lookback) > 0)


# ---- STEPS 7-8: entry / retest (entry_retest.py) -------------------------

def classify_entry_mode(df: pd.DataFrame, resistance: pd.Series,
                        strong_threshold: float = 0.5) -> pd.Series:
    """Per bar: "IMMEDIATE", "WAIT_RETEST", or "NONE"."""
    strength = breakout_strength(df, resistance)
    mode = pd.Series("NONE", index=df.index)
    mode[strength >= strong_threshold] = "IMMEDIATE"
    mode[(strength > 0) & (strength < strong_threshold)] = "WAIT_RETEST"
    return mode


def is_valid_retest(df: pd.DataFrame, resistance: pd.Series,
                    retest_window: int = 10,
                    tolerance_pct: float = 0.015) -> pd.Series:
    """Low touches resistance +/- tolerance, close holds above it,
    bullish candle. Run only on bars after a flagged breakout."""
    near_support = (df["low"] - resistance).abs() / resistance <= tolerance_pct
    held_as_support = df["close"] > resistance
    bullish_candle = df["close"] > df["open"]
    return near_support & held_as_support & bullish_candle


# ---- STEPS 9-10: risk management (risk_management.py) --------------------

def calc_stop_loss(entry_price: float, structural_low: float, atr_value: float,
                   atr_buffer: float = 0.5, max_risk_pct: float = 1.0) -> float:
    """structural_low - buffer*ATR, capped at max_risk_pct of entry;
    returns the tighter (higher) stop."""
    atr_based_stop = structural_low - (atr_buffer * atr_value)
    max_risk_stop = entry_price * (1 - max_risk_pct / 100)
    return round(max(atr_based_stop, max_risk_stop), 2)


def calc_targets(entry_price: float, atr_value: float,
                 t1_atr_mult: float = 2.0, t2_atr_mult: float = 3.5) -> tuple:
    """ATR-based targets. Returns (target_1, target_2)."""
    t1 = round(entry_price + t1_atr_mult * atr_value, 2)
    t2 = round(entry_price + t2_atr_mult * atr_value, 2)
    return t1, t2


def check_exit_signal(df: pd.DataFrame, trailing_stop: pd.Series) -> pd.Series:
    """True where close has fallen below the ATR trailing stop."""
    return df["close"] < trailing_stop
