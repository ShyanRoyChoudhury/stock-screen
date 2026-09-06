"""Session-anchored 1h → 4h resampling for NSE.

Yahoo has no 4h interval, so 4h candles are built from hourly ones.
The NSE session is 09:15–15:30, giving two bins per day:
09:15–13:15 (hours 09:15, 10:15, 11:15, 12:15) and 13:15–15:30
(hours 13:15, 14:15, 15:15). Bin ts = bin start, matching the 1h convention.
"""

from datetime import timedelta

import pandas as pd

from app.market_calendar import now_ist, session_close_dt, session_open_dt

BIN_HOURS = 4


def resample_1h_to_4h(hourly: pd.DataFrame) -> pd.DataFrame:
    """`hourly`: IST tz-aware index, columns open/high/low/close/volume.
    Returns the same shape at 4h resolution; still-open bins are dropped.
    """
    if hourly.empty:
        return hourly.copy()

    df = hourly.sort_index().copy()
    dates = pd.Series(df.index.date, index=df.index)

    def bin_start(ts):
        open_dt = session_open_dt(ts.date())
        hours_in = (ts - open_dt).total_seconds() / 3600
        return open_dt + timedelta(hours=BIN_HOURS * int(hours_in // BIN_HOURS))

    df["bin"] = [bin_start(ts) for ts in df.index]

    out = df.groupby("bin").agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        volume=("volume", "sum"),
    )
    out.index = pd.DatetimeIndex(out.index, name="ts")

    # Drop the bin that is still forming.
    now = now_ist()
    ends = [
        min(ts + timedelta(hours=BIN_HOURS), session_close_dt(ts.date()))
        for ts in out.index
    ]
    out = out[[end <= now for end in ends]]
    return out
