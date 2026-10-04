from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.brokers.crypto import MasterKeyMissing
from app.db import get_session
from app.ingest import fyers_session as fs
from app.models import User

router = APIRouter(prefix="/fyers", tags=["fyers"])


class FyersStatus(BaseModel):
    connected: bool
    expires_at: datetime | None
    logged_in_by: str | None
    logged_in_at: datetime | None


class LoginUrlOut(BaseModel):
    url: str


class SessionIn(BaseModel):
    auth_code: str
    state: str


@router.get("/status", response_model=FyersStatus)
def get_status(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return fs.status(session)


@router.post("/login-url", response_model=LoginUrlOut)
def post_login_url(user: User = Depends(get_current_user)):
    try:
        return {"url": fs.login_url(user.id)}
    except (fs.FyersNotConfigured, MasterKeyMissing) as e:
        raise HTTPException(503, str(e))


@router.post("/session", response_model=FyersStatus)
def post_session(
    body: SessionIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    try:
        fs.complete_login(session, body.auth_code, body.state, user)
    except (fs.FyersNotConfigured, MasterKeyMissing) as e:
        raise HTTPException(503, str(e))
    except fs.FyersLoginError as e:
        raise HTTPException(400, str(e))
    return fs.status(session)


@router.delete("/session", status_code=204)
def delete_session(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    fs.logout(session)
