from datetime import date

import pytest
from sqlalchemy import select

# app.positions.ledger is being written in parallel by another agent; skip
# this whole module until it exists rather than failing at import time.
pytest.importorskip("app.positions.ledger")

from app.db import SessionLocal  # noqa: E402
from app.models import CorporateAction, Symbol  # noqa: E402

RELIANCE_BONUS_EX_DATE = date(2024, 10, 28)


def _has_reliance_bonus() -> bool:
    with SessionLocal() as session:
        sym = session.scalar(select(Symbol).where(Symbol.symbol == "RELIANCE"))
        if sym is None:
            return False
        action = session.scalar(
            select(CorporateAction).where(
                CorporateAction.symbol_id == sym.id,
                CorporateAction.action_type == "bonus",
                CorporateAction.ex_date == RELIANCE_BONUS_EX_DATE,
            )
        )
        return action is not None


def test_csv_import_builds_bonus_adjusted_position(client, auth, master_key):
    if not _has_reliance_bonus():
        pytest.skip(
            "RELIANCE bonus (ex 2024-10-28) not loaded in this DB; "
            "run POST /corporate-actions/load for RELIANCE first."
        )

    create_resp = client.post(
        "/broker-accounts",
        headers=auth,
        json={
            "broker": "zerodha",
            "label": "csv-import",
            "api_key": "dummy",
            "totp_secret": "dummy",
        },
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    account_id = create_resp.json()["id"]

    csv_text = (
        "trade_date,symbol,side,quantity,price\n"
        "2024-10-15,RELIANCE,BUY,10,2688.00\n"
        "2024-11-06,RELIANCE,SELL,20,1325.35\n"
    )
    files = {"file": ("tradebook.csv", csv_text, "text/csv")}
    import_resp = client.post(
        f"/broker-accounts/{account_id}/import-tradebook", headers=auth, files=files
    )
    assert import_resp.status_code == 200, import_resp.text
    body = import_resp.json()
    assert body["rows"] == 2
    assert body["upserted"] == 2

    pos_resp = client.get(
        "/positions", headers=auth, params={"status": "closed"}
    )
    assert pos_resp.status_code == 200, pos_resp.text
    reliance_positions = [
        p for p in pos_resp.json() if p["symbol"] == "RELIANCE"
    ]
    assert len(reliance_positions) == 1, reliance_positions
    pos = reliance_positions[0]
    assert pos["status"] == "closed"
    assert pos["qty_total"] == 20
    assert abs(pos["avg_entry_price"] - 1344.0) <= 0.5
    expected_pnl = (1325.35 - 1344.0) * 20
    assert abs(pos["realized_pnl"] - expected_pnl) <= 1

    # Final path is /broker-accounts/trades (see app/routers/brokers.py: the
    # task spec mounts trade listing alongside the broker-account endpoints).
    trades_resp = client.get("/broker-accounts/trades", headers=auth)
    assert trades_resp.status_code == 200, trades_resp.text
    symbols_seen = {t["symbol"] for t in trades_resp.json()}
    assert "RELIANCE" in symbols_seen
