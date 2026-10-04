"""Step 1 tests: Fyers session/state/JWT, admin settings validation, scheduler
due-logic. No live DB or network: sessions are fakes, requests.post is mocked.
"""

import base64
import json
import time
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from pydantic import SecretStr

import app.config as config_module
from app import settings_store
from app.auth import get_current_user
from app.db import get_session
from app.ingest import fyers_session as fs
from app.main import app
from app.market_calendar import IST
from app.models import DataFeedSession
from scripts.scheduler_tick import is_due

SECRET = "s3cret-value"


@pytest.fixture(autouse=True)
def fyers_env(monkeypatch):
    s = config_module.settings
    monkeypatch.setattr(s, "broker_master_key", SecretStr(Fernet.generate_key().decode()))
    monkeypatch.setattr(s, "fyers_client_id", "APP-100")
    monkeypatch.setattr(s, "fyers_secret_key", SecretStr(SECRET))
    monkeypatch.setattr(s, "fyers_redirect_uri", "https://example.test/fyers/callback")


def make_jwt(exp: int) -> str:
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{b64({'alg': 'HS256'})}.{b64({'exp': exp})}.sig"


class FakeSession:
    def __init__(self):
        self.rows = {}
        self.commits = 0

    def get(self, model, key):
        return self.rows.get((model.__name__, key))

    def add(self, obj):
        self.rows[(type(obj).__name__, obj.provider)] = obj

    def delete(self, obj):
        self.rows = {k: v for k, v in self.rows.items() if v is not obj}

    def commit(self):
        self.commits += 1


USER = SimpleNamespace(id=7, name="shyan")


# --- state -------------------------------------------------------------------

def test_login_url_contains_expected_params():
    url = fs.login_url(7)
    assert url.startswith("https://api-t1.fyers.in/api/v3/generate-authcode?")
    assert "client_id=APP-100" in url and "response_type=code" in url
    assert SECRET not in url


def test_state_roundtrip_ok():
    fs.verify_state(fs.make_state(7), 7)


def test_state_wrong_user_rejected():
    with pytest.raises(fs.FyersLoginError, match="different user"):
        fs.verify_state(fs.make_state(7), 8)


def test_state_expired_rejected():
    state = fs.make_state(7)
    time.sleep(2.2)
    with pytest.raises(fs.FyersLoginError, match="expired"):
        fs.verify_state(state, 7, ttl=1)


def test_state_garbage_rejected():
    with pytest.raises(fs.FyersLoginError):
        fs.verify_state("not-a-token", 7)


def test_not_configured(monkeypatch):
    monkeypatch.setattr(config_module.settings, "fyers_client_id", "")
    with pytest.raises(fs.FyersNotConfigured):
        fs.login_url(7)


# --- JWT -----------------------------------------------------------------------

def test_parse_jwt_exp():
    exp = int(datetime(2026, 10, 6, 0, 30, tzinfo=timezone.utc).timestamp())  # 06:00 IST
    got = fs.parse_jwt_exp(make_jwt(exp))
    assert got == datetime(2026, 10, 6, 0, 30, tzinfo=timezone.utc)
    assert got.astimezone(IST).hour == 6


@pytest.mark.parametrize("bad", ["", "abc", "a.b.c", make_jwt(1).replace(".", ".!", 1)])
def test_parse_jwt_exp_bad(bad):
    with pytest.raises(fs.FyersLoginError):
        fs.parse_jwt_exp(bad)


# --- complete_login ------------------------------------------------------------

class FakeResp:
    def __init__(self, body):
        self._body = body

    def json(self):
        return self._body


def test_complete_login_success(monkeypatch):
    exp = int(time.time()) + 3600
    token = make_jwt(exp)
    calls = {}

    def fake_post(url, json=None, timeout=None):
        calls.update(url=url, json=json)
        return FakeResp({"s": "ok", "access_token": token, "refresh_token": "r"})

    monkeypatch.setattr(fs.requests, "post", fake_post)
    session = FakeSession()
    row = fs.complete_login(session, "AUTHCODE", fs.make_state(7), USER)
    assert calls["url"].endswith("/validate-authcode")
    assert calls["json"]["code"] == "AUTHCODE"
    import hashlib
    assert calls["json"]["appIdHash"] == hashlib.sha256(f"APP-100:{SECRET}".encode()).hexdigest()
    assert row.logged_in_by_user_id == 7
    assert token not in row.access_token_enc and "refresh" not in row.access_token_enc
    assert fs.get_token(session) == token
    assert session.commits == 1


def test_complete_login_fyers_error(monkeypatch):
    monkeypatch.setattr(
        fs.requests, "post",
        lambda *a, **k: FakeResp({"s": "error", "code": -16, "message": "invalid auth code"}),
    )
    session = FakeSession()
    with pytest.raises(fs.FyersLoginError, match="invalid auth code"):
        fs.complete_login(session, "X", fs.make_state(7), USER)
    assert session.rows == {} and session.commits == 0


def test_complete_login_bad_state_never_calls_fyers(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not call Fyers")
    monkeypatch.setattr(fs.requests, "post", boom)
    with pytest.raises(fs.FyersLoginError):
        fs.complete_login(FakeSession(), "X", fs.make_state(99), USER)


def test_complete_login_network_error(monkeypatch):
    def boom(*a, **k):
        raise fs.requests.ConnectionError("down")
    monkeypatch.setattr(fs.requests, "post", boom)
    with pytest.raises(fs.FyersLoginError, match="could not reach"):
        fs.complete_login(FakeSession(), "X", fs.make_state(7), USER)


# --- get_token / status ----------------------------------------------------------

def test_get_token_missing():
    with pytest.raises(fs.FyersLoginRequired):
        fs.get_token(FakeSession())


def test_get_token_expired():
    session = FakeSession()
    session.add(DataFeedSession(
        provider="fyers",
        access_token_enc=fs.encrypt_json({"access_token": "t"}),
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    ))
    with pytest.raises(fs.FyersLoginRequired):
        fs.get_token(session)


def test_status_never_has_token():
    session = FakeSession()
    assert fs.status(session)["connected"] is False
    session.add(DataFeedSession(
        provider="fyers",
        access_token_enc=fs.encrypt_json({"access_token": "t"}),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        logged_in_by_user_id=None,
    ))
    st = fs.status(session)
    assert st["connected"] is True
    assert set(st) == {"connected", "expires_at", "logged_in_by", "logged_in_at"}


# --- settings validation -------------------------------------------------------------

@pytest.mark.parametrize("bad", ["7:00", "24:00", "19:60", "1900", "", "19:00:00", 1900, None])
def test_bad_time_rejected(bad):
    with pytest.raises(ValueError):
        settings_store.validate_value("daily_job_time", bad)


def test_good_values_accepted():
    assert settings_store.validate_updates(
        {"daily_job_time": "00:00", "recheck_time": "23:59", "daily_job_enabled": False}
    ) == {"daily_job_time": "00:00", "recheck_time": "23:59", "daily_job_enabled": False}


@pytest.mark.parametrize("key", ["daily_job_last_run", "recheck_last_run", "nope"])
def test_non_editable_rejected(key):
    with pytest.raises(ValueError, match="not editable"):
        settings_store.validate_value(key, "2026-10-05")


def test_enabled_must_be_bool():
    with pytest.raises(ValueError):
        settings_store.validate_value("daily_job_enabled", "yes")


def test_set_last_run_rejects_editable_key():
    with pytest.raises(ValueError):
        settings_store.set_last_run(None, "daily_job_time", date(2026, 10, 5))


def test_admin_put_rejects_bad_input_over_http():
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_session] = lambda: None
    try:
        c = TestClient(app)
        assert c.put("/admin/settings", json={"daily_job_time": "7pm"}).status_code == 422
        assert c.put("/admin/settings", json={"daily_job_last_run": "2026-10-05"}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_new_routes_require_auth():
    c = TestClient(app)
    for method, path in [("get", "/fyers/status"), ("post", "/fyers/login-url"),
                         ("delete", "/fyers/session"), ("get", "/admin/settings")]:
        assert getattr(c, method)(path).status_code == 401


# --- scheduler is_due ------------------------------------------------------------------

def at(h, m, d=date(2026, 10, 5)):
    return datetime(d.year, d.month, d.day, h, m, tzinfo=IST)


def test_due_after_time_and_not_yet_run():
    assert is_due(at(19, 0), "19:00", None, True)
    assert is_due(at(22, 0), "19:00", date(2026, 10, 2), True)


def test_not_due_before_time():
    assert not is_due(at(18, 59), "19:00", None, True)


def test_not_due_if_already_ran_today():
    assert not is_due(at(20, 0), "19:00", date(2026, 10, 5), True)


def test_not_due_non_trading_day_or_disabled():
    assert not is_due(at(20, 0), "19:00", None, False)
    assert not is_due(at(20, 0), "19:00", None, True, enabled=False)
