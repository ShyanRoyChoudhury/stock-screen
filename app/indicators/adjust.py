"""Read-time price adjustment from the corporate actions table.

Candles are stored splits_only (see fetch_ohlcv). This turns that stored
series into any other convention on demand, so the stored numbers stay
immutable while the convention becomes a query parameter.

    adjusted(t) = stored(t) x product of factors of every action after t

THE SHARE-TERMS TRAP: NSE publishes a dividend in the share terms of its own
ex-date, but a stored price is already adjusted for every split and bonus
since. TATASTEEL's 2022-06-15 dividend of Rs 51 was per pre-split share; the
10:1 split on 2022-07-28 means the stored 2022-06-15 close is Rs 99.6, not
Rs 996. Dividing Rs 51 by Rs 99.6 claims a 51% drop against a real one of
about 5%. So a dividend must first be restated into current share terms by
the structural factors that followed it.
"""

import pandas as pd


def structural_factor_after(actions: pd.DataFrame, when) -> float:
    """Cumulative split/bonus price factor for actions strictly after `when`."""
    if actions.empty:
        return 1.0
    m = actions[(actions["action_type"].isin(("split", "bonus")))
                & (actions["ex_date"] > when)
                & actions["price_factor"].notna()]
    f = 1.0
    for v in m["price_factor"]:
        f *= float(v)
    return f


def adjustment_series(
    closes: pd.Series, actions: pd.DataFrame, basis: str = "total_return"
) -> pd.Series:
    """Per-bar cumulative factor to convert a splits_only series to `basis`.

    `closes`: DatetimeIndex -> stored close. `actions`: columns action_type,
    ex_date (date), value, price_factor. Returns a factor per bar; multiply
    the stored OHLC by it.

    Only 'total_return' differs from the stored basis — splits and bonuses are
    already applied, so re-applying them would double-count.
    """
    if basis == "splits_only" or actions.empty or closes.empty:
        return pd.Series(1.0, index=closes.index)
    if basis != "total_return":
        raise ValueError(f"unsupported basis {basis!r}")

    divs = actions[(actions["action_type"] == "dividend")
                   & actions["value"].notna()].sort_values("ex_date")

    per_action: list[tuple[pd.Timestamp, float]] = []
    for _, a in divs.iterrows():
        ex = pd.Timestamp(a["ex_date"])
        prior = closes[closes.index < ex]
        if prior.empty:
            continue
        # Restate the dividend into the share terms the stored price uses.
        amount = float(a["value"]) * structural_factor_after(actions, a["ex_date"])
        prior_close = float(prior.iloc[-1])
        if prior_close <= 0:
            continue
        f = 1.0 - amount / prior_close
        if f <= 0:
            # A dividend at or above the whole share price is a data error,
            # not a real action; applying it would zero or invert the series.
            continue
        per_action.append((ex, f))

    if not per_action:
        return pd.Series(1.0, index=closes.index)

    # factor(t) = product of factors dated after t; walk backwards once so
    # this stays O(n + a) rather than O(n * a).
    per_action.sort()
    out = pd.Series(1.0, index=closes.index, dtype=float)
    running, i = 1.0, len(per_action) - 1
    for pos in range(len(closes.index) - 1, -1, -1):
        bar = closes.index[pos]
        while i >= 0 and per_action[i][0] > bar:
            running *= per_action[i][1]
            i -= 1
        out.iloc[pos] = running
    return out


def volume_factor_series(volumes: pd.Series, actions: pd.DataFrame) -> pd.Series:
    """Share-count factor per bar. Splits and bonuses multiply the share
    count, so pre-event volume must be scaled to compare with post-event
    volume — otherwise a 20-bar RVOL window spanning a 2:1 split reads a
    phantom 2x surge. Dividends do not change share count.
    """
    if actions.empty or volumes.empty:
        return pd.Series(1.0, index=volumes.index)
    ev = actions[(actions["action_type"].isin(("split", "bonus")))
                 & actions["price_factor"].notna()].sort_values("ex_date")
    if ev.empty:
        return pd.Series(1.0, index=volumes.index)
    pairs = [(pd.Timestamp(r["ex_date"]), 1.0 / float(r["price_factor"]))
             for _, r in ev.iterrows()]
    out = pd.Series(1.0, index=volumes.index, dtype=float)
    running, i = 1.0, len(pairs) - 1
    for pos in range(len(volumes.index) - 1, -1, -1):
        bar = volumes.index[pos]
        while i >= 0 and pairs[i][0] > bar:
            running *= pairs[i][1]
            i -= 1
        out.iloc[pos] = running
    return out
