"""OHLCV fetch from Yahoo Finance (ported from nifty500_scanner.ipynb)."""

import logging
from datetime import date, datetime, timedelta

import pandas as pd
import yfinance as yf

from app.market_calendar import IST, now_ist, session_close_dt

logger = logging.getLogger(__name__)


def fetch_ohlcv(
    symbol: str,
    interval: str,  # "60m" | "1d"
    period: str | None = None,
    start: datetime | date | None = None,
) -> pd.DataFrame:
    """Fetch OHLCV for an NSE symbol. Returns a tz-aware (IST) indexed frame
    with columns open/high/low/close/volume; empty frame if Yahoo has nothing.
    """
    ticker = f"{symbol}.NS"
    kwargs: dict = {"interval": interval, "progress": False, "auto_adjust": True}
    if start is not None:
        kwargs["start"] = start
    else:
        kwargs["period"] = period

    data = yf.download(ticker, **kwargs)
    if data is None or data.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    # yfinance returns MultiIndex columns like ('Close', 'RELIANCE.NS').
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)
    data = data.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]]
    data = data.dropna(subset=["open", "high", "low", "close"])

    # Normalise the index to tz-aware IST. Hourly comes back tz-aware already;
    # daily comes back tz-naive at midnight.
    if data.index.tz is None:
        data.index = data.index.tz_localize(IST)
    else:
        data.index = data.index.tz_convert(IST)

    data = drop_incomplete_candles(data, interval)
    return data


def drop_incomplete_candles(df: pd.DataFrame, interval: str) -> pd.DataFrame:
    """Remove the still-forming candle so we never store a shape that can change.

    A candle is complete once its end time has passed:
    - 60m: start + 1h, capped at that day's 15:30 session close
      (the 15:15 candle is only 15 minutes long);
    - 1d: 15:30 IST on the candle's date.
    """
    if df.empty:
        return df
    now = now_ist()
    last = df.index[-1]
    if interval == "60m":
        end = min(last + timedelta(hours=1), session_close_dt(last.date()))
    else:  # 1d
        end = session_close_dt(last.date())
    if end > now:
        df = df.iloc[:-1]
    return df
