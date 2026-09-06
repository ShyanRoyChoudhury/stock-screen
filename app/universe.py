"""Nifty 500 universe: fetch the official list from NSE and upsert into symbols."""

import io
import logging

import pandas as pd
import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Symbol

logger = logging.getLogger(__name__)

NIFTY500_LIST_URL = (
    "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"
)

# NSE often blocks non-browser requests; used when the live fetch fails.
FALLBACK_SYMBOLS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
    "ITC", "SBIN", "BHARTIARTL", "BAJFINANCE", "HINDZINC", "TATASTEEL",
]


def fetch_nifty500_list() -> list[dict]:
    """Returns [{symbol, name, industry, isin}, ...]. Falls back to a static list."""
    try:
        resp = requests.get(
            NIFTY500_LIST_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=15
        )
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        rows = [
            {
                "symbol": r["Symbol"],
                "name": r.get("Company Name"),
                "industry": r.get("Industry"),
                "isin": r.get("ISIN Code"),
            }
            for _, r in df.iterrows()
        ]
        logger.info("Fetched %d symbols from NSE", len(rows))
        return rows
    except Exception as e:
        logger.warning("NSE list fetch failed (%s); using fallback list", e)
        return [{"symbol": s, "name": None, "industry": None, "isin": None}
                for s in FALLBACK_SYMBOLS]


def refresh_universe(session: Session) -> dict:
    rows = fetch_nifty500_list()
    existing = {
        s.symbol: s for s in session.scalars(select(Symbol)).all()
    }
    created = updated = 0
    for row in rows:
        sym = existing.get(row["symbol"])
        if sym is None:
            session.add(Symbol(**row, active=True))
            created += 1
        else:
            sym.name = row["name"] or sym.name
            sym.industry = row["industry"] or sym.industry
            sym.isin = row["isin"] or sym.isin
            sym.active = True
            updated += 1
    session.commit()
    return {"fetched": len(rows), "created": created, "updated": updated}
