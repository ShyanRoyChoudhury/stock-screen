"""Technical indicator computations.

Faithful port of the strategy gist (indicators.py, trend_filter.py, and the
screener's helper indicators). The gist is the SPEC: known deviations from
textbook formulas are preserved deliberately —

- ATR/ADX smooth with ewm(alpha=1/period) from the first bar (no Wilder
  SMA-seeded warm-up).
- ADX zeroes the smaller of +DM/-DM via two sequential masks, so an exact
  tie keeps both (textbook zeroes both).
- Bollinger uses pandas' sample std (ddof=1), not population std, so values
  differ slightly from TradingView.

scripts/verify_indicators.py holds the gist's verbatim code and asserts
these implementations match it exactly on real data. Any edit here must
keep that parity check passing.

All functions take a DataFrame with columns open, high, low, close, volume
and a DatetimeIndex.
"""

import numpy as np
import pandas as pd


def calc_atr(df: pd.DataFrame, period: int = 10) -> pd.Series:
    """Average True Range with Wilder's smoothing (ewm alpha=1/period)."""
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)

    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    return true_range.ewm(alpha=1 / period, adjust=False).mean()


def calc_supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0):
    """Supertrend. Returns (st_line, direction) where direction is +1/-1.

    Same recurrence as the gist's pandas loop, run on numpy arrays for
    speed (the gist's .iloc loop is ~50x slower; outputs are identical —
    proven by the parity script).
    """
    atr = calc_atr(df, period).to_numpy()
    hl2 = ((df["high"] + df["low"]) / 2).to_numpy()
    close = df["close"].to_numpy()
    n = len(df)

    final_upper = hl2 + multiplier * atr
    final_lower = hl2 - multiplier * atr
    basic_upper = final_upper.copy()
    basic_lower = final_lower.copy()
    direction = np.ones(n, dtype=np.int64)
    st_line = np.zeros(n)

    for i in range(1, n):
        close_prev = close[i - 1]

        # Final upper band only moves down, or resets if price broke above it
        if not (basic_upper[i] < final_upper[i - 1]
                or close_prev > final_upper[i - 1]):
            final_upper[i] = final_upper[i - 1]

        # Final lower band only moves up, or resets if price broke below it
        if not (basic_lower[i] > final_lower[i - 1]
                or close_prev < final_lower[i - 1]):
            final_lower[i] = final_lower[i - 1]

        if direction[i - 1] == 1:
            direction[i] = -1 if close[i] < final_lower[i] else 1
        else:
            direction[i] = 1 if close[i] > final_upper[i] else -1

        st_line[i] = final_lower[i] if direction[i] == 1 else final_upper[i]

    return (pd.Series(st_line, index=df.index),
            pd.Series(direction, index=df.index))


def calc_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9):
    """MACD. Returns (macd_line, signal_line, histogram)."""
    ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line, signal_line, macd_line - signal_line


def calc_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def calc_adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average Directional Index (trend strength)."""
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    prev_high = high.shift(1)
    prev_low = low.shift(1)

    plus_dm = (high - prev_high).clip(lower=0)
    minus_dm = (prev_low - low).clip(lower=0)
    # Zero out the smaller of the two per bar (sequential, as per spec:
    # an exact nonzero tie keeps both).
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


def calc_bollinger(df: pd.DataFrame, period: int = 20, std_dev: float = 2.0):
    """Bollinger Bands. Returns (upper, middle, lower, bandwidth)."""
    middle = df["close"].rolling(period).mean()
    sd = df["close"].rolling(period).std()
    upper = middle + std_dev * sd
    lower = middle - std_dev * sd
    bw = (upper - lower) / middle
    return upper, middle, lower, bw


def calc_volume_ma(df: pd.DataFrame, period: int = 20) -> pd.Series:
    return df["volume"].rolling(period).mean()


def calc_keltner_channels(df: pd.DataFrame, ema_period: int = 20,
                          atr_period: int = 10, multiplier: float = 1.5):
    """Keltner Channels: EMA +/- (multiplier x ATR)."""
    ema = df["close"].ewm(span=ema_period, adjust=False).mean()
    atr = calc_atr(df, atr_period)
    return ema + multiplier * atr, ema, ema - multiplier * atr


def calc_ttm_squeeze(df: pd.DataFrame, bb_period: int = 20, bb_std: float = 2.0,
                     kc_ema_period: int = 20, kc_atr_period: int = 10,
                     kc_mult: float = 1.5):
    """TTM Squeeze. Returns (squeeze_on, squeeze_off, momentum)."""
    bb_upper, _, bb_lower, _ = calc_bollinger(df, bb_period, bb_std)
    kc_upper, kc_mid, kc_lower = calc_keltner_channels(
        df, kc_ema_period, kc_atr_period, kc_mult
    )

    squeeze_on = (bb_upper < kc_upper) & (bb_lower > kc_lower)
    squeeze_off = squeeze_on.shift(1, fill_value=False) & ~squeeze_on

    highest_high = df["high"].rolling(bb_period).max()
    lowest_low = df["low"].rolling(bb_period).min()
    mid_range = (highest_high + lowest_low) / 2
    delta = df["close"] - ((mid_range + kc_mid) / 2)
    momentum = delta.ewm(span=bb_period, adjust=False).mean()

    return squeeze_on, squeeze_off, momentum


def check_volume_divergence(df: pd.DataFrame, lookback: int = 5) -> bool:
    """True when price makes higher highs while volume declines (bearish
    divergence over the last `lookback` bars) — an early-exit warning."""
    if len(df) < lookback + 1:
        return False

    recent = df.iloc[-lookback:]
    price_rising = recent["close"].iloc[-1] > recent["close"].iloc[0]
    vol_trend = np.polyfit(range(len(recent)), recent["volume"].values, 1)[0]
    return bool(price_rising and vol_trend < 0)


def calc_atr_trailing_stop(df: pd.DataFrame, atr_multiple: float = 2.5) -> pd.Series:
    """Chandelier-style trailing stop for an OPEN LONG: rolling max high
    minus atr_multiple x ATR, never trailing down. Position-scoped — feed it
    the bars from entry onward, not full history. Not stored per-candle."""
    atr = calc_atr(df)
    trailing_stop = df["high"].cummax() - atr_multiple * atr
    return trailing_stop.cummax()


# --------------------------------------------------------------------------
# Relative volume (Step 6 of the pipeline) — from volume_confirm.py
# --------------------------------------------------------------------------

def calc_rvol(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """Relative Volume — current volume / rolling average volume."""
    vol_ma = df["volume"].rolling(period).mean()
    return df["volume"] / vol_ma


def volume_confirmed(df: pd.DataFrame, period: int = 20,
                     min_rvol: float = 1.5) -> pd.Series:
    """True where RVOL >= min_rvol."""
    return calc_rvol(df, period) >= min_rvol


def volume_strength_label(rvol_value: float) -> str:
    """Classifies a single RVOL reading into a strength tag."""
    if rvol_value >= 2.0:
        return "STRONG (>=2x avg)"
    elif rvol_value >= 1.5:
        return "CONFIRMED (>=1.5x avg)"
    else:
        return "WEAK (<1.5x avg)"
