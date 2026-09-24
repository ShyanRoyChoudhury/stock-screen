from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

_REPO_ROOT = Path(__file__).resolve().parents[1]


class Base(DeclarativeBase):
    pass


def get_session():
    with Session(engine) as session:
        yield session


def assert_schema_current(engine) -> None:
    """Verify the DB is at Alembic's latest migration head; raise otherwise.

    Schema management is Alembic's job (see alembic/); this only verifies the
    DB is at the latest migration, it never applies one. `alembic.ini` is
    resolved relative to the repo root (not the caller's CWD) so this works
    no matter where the process was started from.
    """
    alembic_cfg = Config(str(_REPO_ROOT / "alembic.ini"))
    script = ScriptDirectory.from_config(alembic_cfg)
    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        db_heads = set(context.get_current_heads())
    script_heads = set(script.get_heads())
    if db_heads != script_heads:
        raise RuntimeError(
            "database schema is not at the latest migration; run: "
            ".venv/bin/alembic upgrade head"
        )
