import hashlib
import secrets

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import User


def new_api_key() -> str:
    return "sk_" + secrets.token_urlsafe(32)


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def get_current_user(
    x_api_key: str = Header(..., alias="X-API-Key"),
    session: Session = Depends(get_session),
) -> User:
    """Resolve the caller's User from X-API-Key. Never log the raw key —
    only its hash is compared, and the hash is not reversible."""
    key_hash = hash_api_key(x_api_key)
    user = session.scalar(
        select(User).where(User.api_key_hash == key_hash, User.active.is_(True))
    )
    if user is None:
        raise HTTPException(401, "invalid API key")
    return user
