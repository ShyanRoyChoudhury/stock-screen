"""Typed access to the `app_settings` key-value table.

Editable keys come from the admin UI; bookkeeping keys are written by the
scheduler only. Values live as JSONB; dates are stored as ISO strings.
"""

import re
from datetime import date

from sqlalchemy.orm import Session

from app.models import AppSetting

DEFAULTS: dict[str, object] = {
    "daily_job_time": "19:00",
    "recheck_time": "21:30",
    "daily_job_enabled": True,
    "daily_job_last_run": None,
    "recheck_last_run": None,
}
EDITABLE = ("daily_job_time", "recheck_time", "daily_job_enabled")
BOOKKEEPING = ("daily_job_last_run", "recheck_last_run")

_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def validate_value(key: str, value: object) -> object:
    """Return the normalised value for an editable key; ValueError if bad."""
    if key not in EDITABLE:
        raise ValueError(f"setting {key!r} is not editable")
    if key.endswith("_time"):
        if not isinstance(value, str) or not _HHMM.match(value):
            raise ValueError(f"{key} must be HH:MM (24h, IST), got {value!r}")
        return value
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be true or false")
    return value


def validate_updates(updates: dict[str, object]) -> dict[str, object]:
    return {k: validate_value(k, v) for k, v in updates.items()}


def parse_hhmm(value: str) -> tuple[int, int]:
    m = _HHMM.match(value)
    if not m:
        raise ValueError(f"not HH:MM: {value!r}")
    return int(m.group(1)), int(m.group(2))


def get_all(session: Session) -> dict[str, object]:
    out = dict(DEFAULTS)
    for row in session.query(AppSetting).all():
        if row.key in DEFAULTS:
            out[row.key] = row.value
    return out


def get_date(settings: dict[str, object], key: str) -> date | None:
    raw = settings.get(key)
    return date.fromisoformat(raw) if isinstance(raw, str) else None


def _put(session: Session, key: str, value: object, user_id: int | None) -> None:
    row = session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=value, updated_by_user_id=user_id))
    else:
        row.value = value
        row.updated_by_user_id = user_id


def set_many(session: Session, updates: dict[str, object], user_id: int) -> dict[str, object]:
    """Validate then upsert editable settings; commits. Returns all settings."""
    clean = validate_updates(updates)
    for key, value in clean.items():
        _put(session, key, value, user_id)
    session.commit()
    return get_all(session)


def set_last_run(session: Session, key: str, day: date) -> None:
    """Scheduler bookkeeping write; commits."""
    if key not in BOOKKEEPING:
        raise ValueError(f"{key!r} is not a bookkeeping key")
    _put(session, key, day.isoformat(), None)
    session.commit()
