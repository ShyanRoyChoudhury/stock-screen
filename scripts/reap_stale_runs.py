"""Fail IngestRun rows stuck in status='running' because their process died.

A run left "running" (a crashed backfill, a killed daily_sync, a Ctrl-C'd
manual run) blocks every subsequent manual /ingest, /indicators and /signals
POST via their 409 "already in progress" guard (see app/routers/ingest.py,
app/routers/indicators.py, app/routers/signals.py), which all just check for
ANY row with status == "running" regardless of mode. Reaping is the release
valve. daily_sync.py runs this first so a dead run from a prior day never
wedges the rest of the pipeline.

Run: .venv/bin/python scripts/reap_stale_runs.py [--hours 6]
"""

import argparse
import sys

sys.path.insert(0, ".")
from datetime import timedelta  # noqa: E402

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.market_calendar import now_ist  # noqa: E402
from app.models import IngestRun  # noqa: E402


def reap_stale_runs(session: Session, older_than_hours: float = 6.0) -> list[int]:
    """Mark every IngestRun still 'running' after `older_than_hours` as
    'failed' (the process that owned it almost certainly died). Commits and
    returns the ids it reaped."""
    cutoff = now_ist() - timedelta(hours=older_than_hours)
    stale = list(
        session.scalars(
            select(IngestRun).where(
                IngestRun.status == "running",
                IngestRun.started_at < cutoff,
            )
        )
    )
    ids = []
    for run in stale:
        run.status = "failed"
        run.message = (
            f"reaped: still 'running' after {older_than_hours}h "
            "(process probably died)"
        )
        run.finished_at = now_ist()
        ids.append(run.id)
    if ids:
        session.commit()
    return ids


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fail IngestRun rows stuck in 'running' for too long."
    )
    parser.add_argument(
        "--hours", type=float, default=6.0,
        help="age threshold in hours (default: 6.0)",
    )
    args = parser.parse_args(argv)

    with SessionLocal() as session:
        ids = reap_stale_runs(session, older_than_hours=args.hours)

    if ids:
        print(f"reaped {len(ids)} stale run(s): {ids}")
    else:
        print("no stale runs found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
