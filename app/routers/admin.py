from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import settings_store
from app.auth import get_current_user
from app.db import get_session
from app.models import User

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminSettingsOut(BaseModel):
    daily_job_time: str
    recheck_time: str
    daily_job_enabled: bool
    daily_job_last_run: str | None
    recheck_last_run: str | None


class AdminSettingsIn(BaseModel):
    """Editable keys only; anything else (e.g. *_last_run) is a 422."""

    model_config = ConfigDict(extra="forbid")

    daily_job_time: str | None = None
    recheck_time: str | None = None
    daily_job_enabled: bool | None = None


@router.get("/settings", response_model=AdminSettingsOut)
def get_settings(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return settings_store.get_all(session)


@router.put("/settings", response_model=AdminSettingsOut)
def put_settings(
    body: AdminSettingsIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    updates = body.model_dump(exclude_none=True)
    try:
        return settings_store.set_many(session, updates, user.id)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
