#!/bin/sh
# Container entrypoint: resolve the port, wait for Postgres, put the schema
# at Alembic's head, then hand off to the command.
#
# The wait and the migration are here rather than in app/main.py because
# app.db.assert_schema_current deliberately never applies a migration — it
# only verifies one, and the service refuses to start if the DB is behind.
#
#   PORT              set by most hosting platforms; mapped to UVICORN_PORT
#   RUN_MIGRATIONS=0  skip `alembic upgrade head` (job containers and extra
#                     API replicas, so they don't race the migrating one)
#   WAIT_FOR_DB=0     skip the readiness wait
#   DB_WAIT_SECONDS   how long to wait for the DB before failing (default 60)
set -e

if [ -n "${PORT:-}" ]; then
    export UVICORN_PORT="$PORT"
fi

if [ "${WAIT_FOR_DB:-1}" != "0" ]; then
    python - <<'PY'
import os
import sys
import time

from sqlalchemy import create_engine, text

from app.config import settings

deadline = time.monotonic() + float(os.environ.get("DB_WAIT_SECONDS", "60"))
engine = create_engine(settings.database_url, pool_pre_ping=True)
attempt = 0
while True:
    attempt += 1
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        break
    except Exception as exc:  # noqa: BLE001 — any failure here is "not ready yet"
        if time.monotonic() >= deadline:
            print(f"entrypoint: database unreachable after {attempt} attempts: {exc}",
                  file=sys.stderr)
            sys.exit(1)
        if attempt == 1:
            print("entrypoint: waiting for the database...", file=sys.stderr)
        time.sleep(1)
PY
fi

if [ "${RUN_MIGRATIONS:-1}" != "0" ]; then
    echo "entrypoint: alembic upgrade head" >&2
    alembic upgrade head
fi

exec "$@"
