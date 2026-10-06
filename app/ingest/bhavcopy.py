"""NSE UDiFF daily bhavcopy: download and per-symbol row lookup.

Moved here from scripts/validate.py so the nightly reconcile
(app.ingest.reconcile_service), scripts/validate.py and the intraday probe
share one implementation. Bhavcopy prices are RAW (unadjusted).
"""

import io
import ssl
import urllib.error
import urllib.request
import zipfile
from datetime import date

import pandas as pd

try:
    import certifi

    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl.create_default_context()

_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

SERIES_KEPT = ("EQ", "BE", "BZ")
# Preference order when a symbol has several rows. A stock moved to the
# trade-to-trade segment (BE) or the "Z" category (BZ) is still traded and
# still has a real OHLC/volume, so it is checked like any other.
SERIES_PREFERENCE = ("EQ", "BE", "BZ")
# HTTP statuses meaning "not published (yet)": archives answer 404 before
# the file exists and 403 for a path they never created (holidays).
NOT_PUBLISHED = (403, 404)


def bhavcopy_url(day: date) -> str:
    return ("https://nsearchives.nseindia.com/content/cm/"
            f"BhavCopy_NSE_CM_0_0_0_{day.strftime('%Y%m%d')}_F_0000.csv.zip")


def parse_bhavcopy(raw_csv: bytes) -> pd.DataFrame:
    """CSV bytes -> frame of EQ/BE/BZ rows indexed by TckrSymb."""
    df = pd.read_csv(io.BytesIO(raw_csv))
    df = df[df["SctySrs"].isin(SERIES_KEPT)]
    return df.set_index("TckrSymb")


def fetch_bhavcopy(day: date) -> pd.DataFrame | None:
    """Download and parse the day's bhavcopy. None when it is not published
    (HTTP 404/403). Other network errors propagate."""
    req = urllib.request.Request(bhavcopy_url(day), headers={
        "User-Agent": _UA, "Referer": "https://www.nseindia.com/"})
    try:
        with urllib.request.urlopen(req, timeout=45, context=_SSL_CTX) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code in NOT_PUBLISHED:
            return None
        raise
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        raw = z.read(z.namelist()[0])
    return parse_bhavcopy(raw)


def eq_row(bhav: pd.DataFrame | None, symbol: str) -> dict | None:
    """The row for `symbol` as a dict, preferring series EQ, then BE, then BZ
    (the row's `SctySrs` says which). None if the frame is missing or the
    symbol is absent."""
    if bhav is None or symbol not in bhav.index:
        return None
    rows = bhav.loc[[symbol]]
    for series in SERIES_PREFERENCE:
        hit = rows[rows["SctySrs"] == series]
        if not hit.empty:
            return hit.iloc[0].to_dict()
    return None
