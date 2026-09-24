# Backend image: the FastAPI service and the scripts/ jobs share it — the
# daily job is this app's own code path, not a separate program, so it runs
# from the same image with a different command.
#
#   docker build -t stockscreen-backend .
#   docker run --rm -p 8000:8000 -e DATABASE_URL=... stockscreen-backend
#
# Two stages so the runtime image carries no compiler: everything installs
# into /opt/venv in the builder and is copied over whole.

FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Nearly every dependency here ships a manylinux wheel; build-essential is
# the fallback for any that resolves to an sdist on this platform.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Its own layer: dependencies only rebuild when requirements.txt changes.
COPY requirements.txt ./
RUN pip install -r requirements.txt


FROM python:3.12-slim AS runtime

# TZ matters: a few paths date things off the machine's local clock (e.g.
# the default corporate-actions window in app/routers/corporate_actions.py),
# and "today" for this service always means the Indian trading day.
# UVICORN_HOST/UVICORN_PORT are read by uvicorn's CLI itself (click, with
# auto_envvar_prefix="UVICORN"), which is why CMD passes no --host/--port:
# an explicit flag would win over the environment and defeat $PORT.
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Kolkata \
    UVICORN_HOST=0.0.0.0 \
    UVICORN_PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 stockscreen

COPY --from=builder /opt/venv /opt/venv

# The repo root is the working directory on purpose: scripts/daily_sync.py
# imports `scripts.*` off the CWD, and pydantic-settings looks for .env
# there (absent in the image — config comes in as environment variables).
WORKDIR /srv/stock-screen
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER stockscreen
EXPOSE 8000

# /health opens a DB connection, so "unhealthy" means "cannot serve", not
# merely "process exited". urllib instead of curl: no extra package needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('UVICORN_PORT', '8000') + '/health').read()"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["uvicorn", "app.main:app"]
