from app.auth import hash_api_key, new_api_key
from app.db import SessionLocal
from app.models import User

_CREDENTIAL_FIELDS = ("api_key", "totp_secret", "credentials", "credentials_enc",
                       "access_token_enc")


def test_get_me_without_key_401(client):
    # app/auth.py declares X-API-Key as an optional Header(default=None) so
    # it can raise its own 401 ("missing API key") instead of FastAPI's
    # default 422 when the header is absent entirely; an invalid key hits
    # the other 401 branch ("invalid API key"). Cover both.
    missing = client.get("/me")
    assert missing.status_code == 401

    invalid = client.get("/me", headers={"X-API-Key": "sk_not-a-real-key"})
    assert invalid.status_code == 401


def test_get_me_with_key(client, auth, test_user):
    resp = client.get("/me", headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == test_user["id"]
    assert body["name"] == "Test User"


def test_create_broker_account_without_master_key_503(client, auth):
    resp = client.post(
        "/broker-accounts",
        headers=auth,
        json={
            "broker": "zerodha",
            "label": "primary",
            "api_key": "k",
            "totp_secret": "s",
        },
    )
    assert resp.status_code == 503


def test_create_list_delete_test_account(client, auth, master_key):
    create_resp = client.post(
        "/broker-accounts",
        headers=auth,
        json={
            "broker": "zerodha",
            "label": "primary",
            "api_key": "k",
            "totp_secret": "s",
        },
    )
    assert create_resp.status_code in (200, 201)
    body = create_resp.json()
    for field in _CREDENTIAL_FIELDS:
        assert field not in body, f"{field} leaked in BrokerAccountOut"

    list_resp = client.get("/broker-accounts", headers=auth)
    assert list_resp.status_code == 200
    assert body["id"] in [a["id"] for a in list_resp.json()]

    del_resp = client.delete(f"/broker-accounts/{body['id']}", headers=auth)
    assert del_resp.status_code == 200
    assert del_resp.json()["active"] is False

    # No broker client is registered yet in this phase (Groww lands later).
    test_resp = client.post(f"/broker-accounts/{body['id']}/test", headers=auth)
    assert test_resp.status_code == 501


def test_invalid_broker_422(client, auth, master_key):
    resp = client.post(
        "/broker-accounts",
        headers=auth,
        json={
            "broker": "not-a-broker",
            "label": "x",
            "api_key": "k",
            "totp_secret": "s",
        },
    )
    assert resp.status_code == 422


def test_duplicate_broker_account_409(client, auth, master_key):
    payload = {
        "broker": "zerodha",
        "label": "dup",
        "api_key": "k",
        "totp_secret": "s",
    }
    first = client.post("/broker-accounts", headers=auth, json=payload)
    assert first.status_code in (200, 201)
    second = client.post("/broker-accounts", headers=auth, json=payload)
    assert second.status_code == 409


def test_other_users_account_is_404(client, auth, master_key):
    create_resp = client.post(
        "/broker-accounts",
        headers=auth,
        json={
            "broker": "zerodha",
            "label": "mine",
            "api_key": "k",
            "totp_secret": "s",
        },
    )
    account_id = create_resp.json()["id"]

    raw_key2 = new_api_key()
    with SessionLocal() as session:
        other = User(
            name="Other User",
            email=None,
            api_key_hash=hash_api_key(raw_key2),
        )
        session.add(other)
        session.commit()
        other_id = other.id

    try:
        other_headers = {"X-API-Key": raw_key2}
        list_resp = client.get("/broker-accounts", headers=other_headers)
        assert list_resp.status_code == 200
        assert list_resp.json() == []

        del_resp = client.delete(
            f"/broker-accounts/{account_id}", headers=other_headers
        )
        assert del_resp.status_code == 404
    finally:
        with SessionLocal() as session:
            session.query(User).filter(User.id == other_id).delete()
            session.commit()
