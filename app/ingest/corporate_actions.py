"""Corporate actions from NSE: fetch, parse, upsert.

NSE publishes actions as free-form English in a `subject` field, so parsing is
heuristic by necessity. Every row keeps the raw subject, and anything the
parser does not recognise is counted and reported rather than silently dropped
— a missed split is a 50% phantom gap in the price series.

Only price-affecting actions are stored. NSE also publishes AGMs, EGMs and
interest payments, which do not move the equity price.
"""

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime

import requests
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import CorporateAction, Symbol

logger = logging.getLogger(__name__)

NSE_CA_URL = (
    "https://www.nseindia.com/api/corporates-corporateActions"
    "?index=equities&from_date={frm}&to_date={to}"
)
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# "Rs 8", "Rs8", "Re 0.01", "Rs. 12.50" — Re is the Indian singular, used for
# amounts below one rupee, so both spellings must be accepted.
# The optional dash absorbs an NSE transposition typo: COLPAL publishes
# "Special Dividend Rs -10 Per Share" where the separator hyphen landed
# after the currency instead of before it. Dividends are never negative,
# so accepting it cannot mis-read a real value.
_MONEY = r"R(?:s|e)\.?\s*-?\s*(\d+(?:\.\d+)?)"
# NSE abbreviates inconsistently: "Per Share", "Per Sh", "Per Shares", and
# "Per Unit" for REITs and InvITs. Missing a variant silently drops a real
# dividend (SUNTV publishes "Per Sh"), so accept all of them.
_DIV_RE = re.compile(
    _MONEY + r"\s*/?-?\s*Per\s+(?:Sh(?:are)?s?|Unit)", re.I)
_SPLIT_RE = re.compile(
    r"From\s+" + _MONEY + r"\s*/?-?\s*Per\s+Share\s+To\s+" + _MONEY, re.I)
_RATIO_RE = re.compile(r"(\d+)\s*:\s*(\d+)")


@dataclass
class ParsedAction:
    action_type: str
    value: float | None = None
    ratio_from: float | None = None
    ratio_to: float | None = None
    price_factor: float | None = None
    is_extraordinary: bool = False
    affects_share_count: bool = False


def classify(subject: str) -> str | None:
    """Map NSE's subject text to an action type, or None if it does not move
    the price. Order matters: 'Bonus' is checked before 'Dividend' because a
    record can mention both."""
    u = (subject or "").upper()
    if "SPLIT" in u or "SUB-DIVISION" in u or "SUBDIVISION" in u:
        return "split"
    if "BONUS" in u:
        return "bonus"
    if "RIGHT" in u:
        return "rights"
    if "DEMERGER" in u or "SPIN" in u or "ARRANGEMENT" in u:
        return "demerger"
    if "DIVIDEND" in u:
        return "dividend"
    return None


def parse_subject(subject: str) -> ParsedAction | None:
    """Structure one NSE subject line. Returns None if unparseable, so the
    caller can report it rather than store a half-understood action."""
    kind = classify(subject)
    if kind is None:
        return None

    if kind == "dividend":
        amounts = [float(m) for m in _DIV_RE.findall(subject)]
        if not amounts:
            return None
        u = subject.upper()
        if "CONSIST" in u:
            # A REIT/InvIT distribution states the total first and then breaks
            # it down ("Rs 5.1 Per Unit Consisting Dividend Rs 2 ... Interest
            # Rs 2.28 ..."). Summing would double-count, so take the total.
            value = amounts[0]
        else:
            # Several distinct dividends can go ex together, e.g. "Interim
            # Dividend - Rs 9 Per Share Special Dividend - Rs 18 Per Share":
            # Rs 27 leaves the company that day, so the total is the factor.
            value = sum(amounts)
        return ParsedAction(
            action_type="dividend",
            value=value,
            is_extraordinary="SPECIAL" in u,
        )

    if kind == "split":
        m = _SPLIT_RE.search(subject)
        if not m:
            return None
        fv_from, fv_to = float(m.group(1)), float(m.group(2))
        if fv_from <= 0 or fv_to <= 0:
            return None
        # Face value 10 -> 2 is a 5:1 split: prior prices divide by 5.
        return ParsedAction(
            action_type="split",
            ratio_from=fv_from,
            ratio_to=fv_to,
            price_factor=fv_to / fv_from,
            is_extraordinary=True,
            affects_share_count=True,
        )

    if kind == "bonus":
        m = _RATIO_RE.search(subject)
        if not m:
            return None
        a, b = float(m.group(1)), float(m.group(2))
        if a <= 0 or b <= 0:
            return None
        # "Bonus 3:1" = 3 free per 1 held, so 1 share becomes 4.
        return ParsedAction(
            action_type="bonus",
            ratio_from=a,
            ratio_to=b,
            price_factor=b / (a + b),
            is_extraordinary=True,
            affects_share_count=True,
        )

    if kind == "rights":
        m = _RATIO_RE.search(subject)
        prem = re.search(_MONEY, subject)
        # The factor needs the theoretical ex-rights price, which needs the
        # cum-rights market price — left for read time.
        return ParsedAction(
            action_type="rights",
            ratio_from=float(m.group(1)) if m else None,
            ratio_to=float(m.group(2)) if m else None,
            value=float(prem.group(1)) if prem else None,
            is_extraordinary=True,
            affects_share_count=True,
        )

    # Demerger: NSE publishes the event with no ratio. The factor depends on
    # the demerged entity's value and must be supplied externally.
    return ParsedAction(action_type="demerger", is_extraordinary=True)


def _parse_date(s: str | None) -> date | None:
    if not s or s in ("-", "NA"):
        return None
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    return None


def fetch_nse_actions(frm: date, to: date, timeout: int = 60) -> list[dict]:
    """Raw NSE corporate-action records for a date range."""
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.nseindia.com/companies-listing/"
                   "corporate-filings-actions",
    })
    try:  # seeds cookies; NSE serves the API even when the homepage 403s
        s.get("https://www.nseindia.com/", timeout=timeout)
    except Exception:
        pass
    url = NSE_CA_URL.format(
        frm=frm.strftime("%d-%m-%Y"), to=to.strftime("%d-%m-%Y"))
    r = s.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()


def load_actions(
    session: Session, frm: date, to: date, symbols: list[str] | None = None
) -> dict:
    """Fetch, parse and upsert. Returns counts including what failed to parse,
    so an unrecognised format surfaces instead of vanishing."""
    raw = fetch_nse_actions(frm, to)
    known = {s.symbol: s.id for s in session.scalars(select(Symbol))}
    wanted = set(symbols) if symbols else None

    rows, unparsed, skipped_unknown, not_price = [], [], 0, 0
    for rec in raw:
        sym = (rec.get("symbol") or "").strip()
        if wanted and sym not in wanted:
            continue
        subject = (rec.get("subject") or "").strip()
        if classify(subject) is None:
            not_price += 1
            continue
        sid = known.get(sym)
        if sid is None:
            skipped_unknown += 1
            continue
        ex = _parse_date(rec.get("exDate"))
        if ex is None:
            unparsed.append({"symbol": sym, "subject": subject,
                             "why": "unparseable exDate"})
            continue
        parsed = parse_subject(subject)
        if parsed is None:
            unparsed.append({"symbol": sym, "subject": subject,
                             "why": "unrecognised format"})
            continue
        rows.append({
            "symbol_id": sid,
            "action_type": parsed.action_type,
            "ex_date": ex,
            "record_date": _parse_date(rec.get("recDate")),
            "value": parsed.value,
            "ratio_from": parsed.ratio_from,
            "ratio_to": parsed.ratio_to,
            "price_factor": parsed.price_factor,
            "is_extraordinary": parsed.is_extraordinary,
            "affects_share_count": parsed.affects_share_count,
            "subject": subject[:512],
            "source": "nse",
        })

    # One row per (symbol, ex_date, action_type). NSE often publishes several
    # dividends going ex the same day as SEPARATE records — NESTLEIND's
    # 2023-04-21 is "Interim Rs 27" and "Final Rs 75" in two rows. Last-wins
    # would keep Rs 75 and lose Rs 27, understating the factor. What leaves
    # the company that day is the total, so dividends are summed.
    deduped: dict[tuple, dict] = {}
    for r in rows:
        key = (r["symbol_id"], r["ex_date"], r["action_type"])
        prev = deduped.get(key)
        if prev is None:
            deduped[key] = r
        elif r["action_type"] == "dividend":
            prev["value"] = (prev["value"] or 0.0) + (r["value"] or 0.0)
            prev["is_extraordinary"] = (
                prev["is_extraordinary"] or r["is_extraordinary"])
            prev["subject"] = f"{prev['subject']} + {r['subject']}"[:512]
        # Two structural actions on one ex-date would be an NSE anomaly;
        # keep the first and let the raw subject show what happened.
    written = 0
    if deduped:
        stmt = pg_insert(CorporateAction).values(list(deduped.values()))
        stmt = stmt.on_conflict_do_update(
            constraint="uq_corp_action",
            set_={c: stmt.excluded[c] for c in (
                "record_date", "value", "ratio_from", "ratio_to",
                "price_factor", "is_extraordinary", "affects_share_count",
                "subject", "source")},
        )
        session.execute(stmt)
        session.commit()
        written = len(deduped)

    return {
        "fetched": len(raw),
        "price_affecting": len(rows) + len(unparsed),
        "written": written,
        "not_price_affecting": not_price,
        "unknown_symbol": skipped_unknown,
        "unparsed": unparsed,
    }
