"""Fyers daily login: OAuth URL, code exchange, token storage.

The access token dies at 06:00 IST the next morning and Fyers' refresh API is
disabled, so a person logs in through the browser once per trading day. The
token is shared by the whole app (one `data_feed_sessions` row, provider
'fyers'), encrypted with the broker master key.

Never log tokens, auth codes or the secret key (same rule as brokers/groww.py).
"""

import base64
import hashlib
import json
import logging
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

import requests
from cryptography.fernet import InvalidToken
from sqlalchemy.orm import Session

from app.brokers.crypto import decrypt_json, decrypt_text, encrypt_json, encrypt_text
from app.config import settings
from app.models import DataFeedSession, User

logger = logging.getLogger(__name__)

API_BASE = "https://api-t1.fyers.in/api/v3"
PROVIDER = "fyers"
STATE_TTL_SECONDS = 600


class FyersLoginRequired(RuntimeError):
    def __init__(self, message: str = "Fyers login needed"):
        super().__init__(message)


class FyersLoginError(RuntimeError):
    """The login attempt itself failed (bad state, Fyers rejected the code)."""


class FyersNotConfigured(RuntimeError):
    def __init__(self):
        super().__init__(
            "FYERS_CLIENT_ID, FYERS_SECRET_KEY and FYERS_REDIRECT_URI must all be set"
        )


def _credentials() -> tuple[str, str, str]:
    if (
        not settings.fyers_client_id
        or settings.fyers_secret_key is None
        or not settings.fyers_redirect_uri
    ):
        raise FyersNotConfigured()
    return (
        settings.fyers_client_id,
        settings.fyers_secret_key.get_secret_value(),
        settings.fyers_redirect_uri,
    )


# --- OAuth state -----------------------------------------------------------

def make_state(user_id: int) -> str:
    return encrypt_text(json.dumps({"user_id": user_id, "nonce": secrets.token_urlsafe(8)}))


def verify_state(state: str, user_id: int, ttl: int = STATE_TTL_SECONDS) -> None:
    """Raise FyersLoginError unless `state` is one we issued to `user_id`
    within the last `ttl` seconds."""
    try:
        payload = json.loads(decrypt_text(state, ttl=ttl))
    except (InvalidToken, ValueError):
        raise FyersLoginError("login state is invalid or expired; start the login again")
    if not isinstance(payload, dict) or payload.get("user_id") != user_id:
        raise FyersLoginError("login state belongs to a different user")


def login_url(user_id: int) -> str:
    client_id, _, redirect_uri = _credentials()
    return f"{API_BASE}/generate-authcode?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "state": make_state(user_id),
    })


# --- token handling ----------------------------------------------------------

def parse_jwt_exp(token: str) -> datetime:
    """`exp` claim of a JWT as an aware UTC datetime. No signature check: we
    only read our own freshly issued token to know when it dies."""
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        exp = json.loads(base64.urlsafe_b64decode(payload_b64))["exp"]
        return datetime.fromtimestamp(int(exp), tz=timezone.utc)
    except (IndexError, KeyError, ValueError, TypeError):
        raise FyersLoginError("Fyers returned an access token without a readable expiry")


def complete_login(session: Session, auth_code: str, state: str, user: User) -> DataFeedSession:
    verify_state(state, user.id)
    client_id, secret_key, _ = _credentials()
    app_id_hash = hashlib.sha256(f"{client_id}:{secret_key}".encode()).hexdigest()
    try:
        resp = requests.post(
            f"{API_BASE}/validate-authcode",
            json={"grant_type": "authorization_code", "appIdHash": app_id_hash, "code": auth_code},
            timeout=settings.fyers_request_timeout,
        )
        body = resp.json()
    except (requests.RequestException, ValueError):
        raise FyersLoginError("could not reach Fyers to exchange the auth code")
    if not isinstance(body, dict) or body.get("s") != "ok" or not body.get("access_token"):
        # Fyers' message is safe to surface (it never echoes the code/secret).
        msg = body.get("message") if isinstance(body, dict) else None
        raise FyersLoginError(f"Fyers rejected the login: {msg or 'unknown error'}")

    token = body["access_token"]
    expires_at = parse_jwt_exp(token)
    row = session.get(DataFeedSession, PROVIDER)
    if row is None:
        row = DataFeedSession(provider=PROVIDER)
        session.add(row)
    row.access_token_enc = encrypt_json({"access_token": token})
    row.expires_at = expires_at
    row.logged_in_by_user_id = user.id
    row.logged_in_at = datetime.now(timezone.utc)
    session.commit()
    logger.info("Fyers login stored by user %s, expires %s", user.id, expires_at.isoformat())
    return row


def get_token(session: Session, now: datetime | None = None) -> str:
    """The live access token, or FyersLoginRequired if missing/expired."""
    row = session.get(DataFeedSession, PROVIDER)
    now = now or datetime.now(timezone.utc)
    if row is None or row.expires_at <= now:
        raise FyersLoginRequired()
    return decrypt_json(row.access_token_enc)["access_token"]


def logout(session: Session) -> None:
    row = session.get(DataFeedSession, PROVIDER)
    if row is not None:
        session.delete(row)
        session.commit()


def status(session: Session, now: datetime | None = None) -> dict:
    row = session.get(DataFeedSession, PROVIDER)
    now = now or datetime.now(timezone.utc)
    if row is None:
        return {"connected": False, "expires_at": None, "logged_in_by": None, "logged_in_at": None}
    by = session.get(User, row.logged_in_by_user_id) if row.logged_in_by_user_id else None
    return {
        "connected": row.expires_at > now,
        "expires_at": row.expires_at,
        "logged_in_by": by.name if by else None,
        "logged_in_at": row.logged_in_at,
    }
