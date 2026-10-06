"""Cron-driven scheduler: run once every 5 minutes (`*/5 * * * *`).

Reads the admin job settings (app_settings) and, when due, runs:
  - the daily job (scripts/daily_sync.py, all steps, in-process) at
    `daily_job_time` IST on a trading day, once per day;
  - the bhavcopy re-check at `recheck_time` IST, once per day: runs the
    reconcile and regenerates signals only for the symbols it changed (a
    late-published bhavcopy resolving pending/failed rows, or a close patch);
    nothing changed, nothing regenerated.

A Postgres advisory lock makes overlapping ticks (a long daily job still
running when the next cron fires) exit immediately.

Run: .venv/bin/python scripts/scheduler_tick.py [--dry-run]
"""

import argparse
import logging
import sys
from datetime import date, datetime

sys.path.insert(0, ".")
from sqlalchemy import text  # noqa: E402

from app import settings_store  # noqa: E402
from app.db import SessionLocal, assert_schema_current, engine  # noqa: E402
from app.market_calendar import is_trading_day, now_ist  # noqa: E402

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger("scheduler_tick")

LOCK_KEY = 7_204_001  # arbitrary app-wide advisory lock id


def is_due(
    now: datetime,
    job_time: str,
    last_run: date | None,
    trading_day: bool,
    enabled: bool = True,
) -> bool:
    """Pure: should a job scheduled at `job_time` (HH:MM IST) run now?
    Due once per trading day, from job_time onwards, until it has run."""
    if not enabled or not trading_day:
        return False
    hh, mm = settings_store.parse_hhmm(job_time)
    if (now.hour, now.minute) < (hh, mm):
        return False
    return last_run != now.date()


def run_daily_job() -> int:
    from scripts import daily_sync

    return daily_sync.main([])


def run_recheck() -> int:
    """Re-run the reconcile (resolves pending/failed days once the bhavcopy is
    out or ingest re-fetched good bars), then regenerate signals ONLY for the
    symbols it changed: a pending/fail row that now passes (its signal hold
    lifts) or a last-close patch. Returns daily_sync's exit code when signals
    ran, else 0."""
    from app.ingest.reconcile_service import run_reconcile
    from scripts import daily_sync

    summary = run_reconcile()  # default day, all active symbols
    logger.info("recheck: reconcile summary %s", summary)
    changed = summary["changed_symbols"]
    if not changed:
        logger.info("recheck: nothing changed, signals not regenerated")
        return 0
    logger.info("recheck: regenerating signals for %d symbol(s)", len(changed))
    return daily_sync.main(["--steps", "signals", "--symbols", ",".join(changed)])


def tick(dry_run: bool = False) -> None:
    now = now_ist()
    trading = is_trading_day(now.date())
    with SessionLocal() as session:
        cfg = settings_store.get_all(session)

    if is_due(now, cfg["daily_job_time"], settings_store.get_date(cfg, "daily_job_last_run"),
              trading, bool(cfg["daily_job_enabled"])):
        logger.info("daily job due (%s IST)", cfg["daily_job_time"])
        if dry_run:
            return
        code: int | None = None
        try:
            code = run_daily_job()
        except Exception:
            logger.exception("daily job raised")
        finally:
            # Marked done even on a non-zero exit or an exception: re-running
            # the whole job every 5 minutes would be worse; fix and trigger
            # from Ops -> Triggers.
            with SessionLocal() as session:
                settings_store.set_last_run(session, "daily_job_last_run", now.date())
        logger.info("daily job finished, exit code %s", "FAILED (exception)" if code is None else code)
        return

    if is_due(now, cfg["recheck_time"], settings_store.get_date(cfg, "recheck_last_run"),
              trading, bool(cfg["daily_job_enabled"])):
        logger.info("recheck due (%s IST)", cfg["recheck_time"])
        if dry_run:
            return
        code: int | None = None
        try:
            code = run_recheck()
        except Exception:
            logger.exception("recheck raised")
        finally:
            # Marked done even on failure, like the daily job: retrying every
            # 5 minutes would be worse; trigger manually from Ops -> Triggers.
            with SessionLocal() as session:
                settings_store.set_last_run(session, "recheck_last_run", now.date())
        logger.info("recheck finished, exit code %s",
                    "FAILED (exception)" if code is None else code)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true",
                        help="log what would run, run nothing")
    args = parser.parse_args(argv)

    assert_schema_current(engine)
    # The lock is session-level, so hold one connection for the whole tick.
    # AUTOCOMMIT so no transaction stays open for the whole job.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as lock_conn:
        got = lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar()
        if not got:
            logger.info("another tick is running; exiting")
            return 0
        try:
            tick(args.dry_run)
        finally:
            lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
    return 0


if __name__ == "__main__":
    sys.exit(main())
