"""Daily orchestration job: reap -> ingest -> indicators -> signals ->
actions -> broker -> ledger -> evaluate, for one trading day.

Meant to be invoked by cron/launchd shortly after the 15:30 IST close (see
scripts/launchd/com.stockscreen.daily-sync.plist and README.md's "Daily
job" section). Every step is isolated: a failure in one is recorded in the
summary and the remaining steps still run, so a bad ingest never prevents
today's evaluation of already-open positions from happening.

Run: .venv/bin/python scripts/daily_sync.py
Smoke run (fast, no market-data steps):
    .venv/bin/python scripts/daily_sync.py --steps reap,actions,ledger,evaluate
Smoke run (market-data steps, a couple of symbols only):
    .venv/bin/python scripts/daily_sync.py --steps ingest,indicators,signals \\
        --symbols RELIANCE,TCS --timeframes 1d
"""

import argparse
import json
import logging
import sys
from datetime import date, timedelta

sys.path.insert(0, ".")
from sqlalchemy import select  # noqa: E402

from app.brokers.service import sync_account  # noqa: E402
from app.db import assert_schema_current, engine, SessionLocal  # noqa: E402
from app.indicators.service import run_compute  # noqa: E402
from app.ingest.corporate_actions import load_actions  # noqa: E402
from app.ingest.service import run_ingest  # noqa: E402
from app.market_calendar import is_trading_day, last_trading_day, now_ist  # noqa: E402
from app.models import TIMEFRAMES, BrokerAccount, IngestRun  # noqa: E402
from app.positions.evaluator import evaluate_all  # noqa: E402
from app.positions.ledger import apply_unapplied_trades  # noqa: E402
from app.signals.service import run_signals  # noqa: E402
from scripts.reap_stale_runs import reap_stale_runs  # noqa: E402

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

STEP_ORDER = (
    "reap", "ingest", "indicators", "signals",
    "actions", "broker", "ledger", "evaluate",
)


# --- step selection / summary / exit code: pure, unit-testable -------------

def parse_steps(raw: str | None) -> list[str]:
    """Parse a `--steps` value into the canonical STEP_ORDER subset.
    None/empty means "all steps". Raises ValueError on an unknown name."""
    if raw is None or not raw.strip():
        return list(STEP_ORDER)
    requested = [s.strip() for s in raw.split(",") if s.strip()]
    unknown = [s for s in requested if s not in STEP_ORDER]
    if unknown:
        raise ValueError(
            f"unknown step(s): {unknown}; valid steps are: {', '.join(STEP_ORDER)}"
        )
    wanted = set(requested)
    return [s for s in STEP_ORDER if s in wanted]


def summarize(step_results: list[dict]) -> dict:
    """Roll a list of {"step", "status", "message", "detail"} dicts into a
    summary with per-status counts. Pure -- takes no DB/IO."""
    counts = {"ok": 0, "warning": 0, "failed": 0}
    for r in step_results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"steps": step_results, "counts": counts}


def exit_code_for(step_results: list[dict]) -> int:
    """Non-zero iff any step's status is 'failed'. A 'warning' step (e.g. a
    handful of symbols failed within an otherwise-completed run) does not
    fail the job -- only a step that could not complete does."""
    return 1 if any(r.get("status") == "failed" for r in step_results) else 0


def _parse_symbols(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    return [s.strip().upper() for s in raw.split(",") if s.strip()]


def _parse_timeframes(raw: str | None) -> list[str]:
    if not raw:
        return list(TIMEFRAMES)
    tfs = [t.strip() for t in raw.split(",") if t.strip()]
    bad = [t for t in tfs if t not in TIMEFRAMES]
    if bad:
        raise ValueError(f"timeframes must be a subset of {TIMEFRAMES}, got {bad}")
    return tfs


# --- individual steps --------------------------------------------------
# Each takes (day, symbols, timeframes) for a uniform call signature, even
# when a given step ignores some of them, and always returns a result dict
# rather than raising -- expected/partial failures (one bad symbol, one bad
# broker account, one bad position) are caught internally and folded into
# the result; only a genuinely unexpected crash propagates, and the caller
# in main() catches that too so the remaining steps still run.

def _step_reap(day: date, symbols: list[str] | None, timeframes: list[str]) -> dict:
    with SessionLocal() as session:
        ids = reap_stale_runs(session)
    message = f"reaped {len(ids)} stale run(s)" if ids else "no stale runs found"
    return {"step": "reap", "status": "ok", "message": message,
            "detail": {"reaped_ids": ids}}


def _create_run(mode: str, timeframes: list[str]) -> int:
    session = SessionLocal()
    try:
        run = IngestRun(mode=mode, timeframes=list(timeframes))
        session.add(run)
        session.commit()
        return run.id
    finally:
        session.close()


def _finalize_worker_step(step: str, run_id: int) -> dict:
    """Re-read a worker-owned IngestRun row (run_ingest/run_compute/
    run_signals each manage their own status/counters/finished_at) and turn
    it into a step result. Only status == 'failed' (the worker itself
    crashed) counts as a step failure; a completed run with symbols_failed >
    0, or one that somehow isn't 'completed', is a warning."""
    with SessionLocal() as session:
        run = session.get(IngestRun, run_id)
        status = run.status
        total, ok, failed = run.symbols_total, run.symbols_ok, run.symbols_failed
        message = run.message or f"run {run_id}: status={status}"

    if status == "failed":
        step_status = "failed"
    elif status != "completed" or failed > 0:
        step_status = "warning"
    else:
        step_status = "ok"

    return {
        "step": step,
        "status": step_status,
        "message": message,
        "detail": {
            "run_id": run_id, "run_status": status,
            "symbols_total": total, "symbols_ok": ok, "symbols_failed": failed,
        },
    }


def _step_ingest(day: date, symbols: list[str] | None, timeframes: list[str]) -> dict:
    run_id = _create_run("incremental", timeframes)
    run_ingest(run_id, "incremental", timeframes, symbols)
    return _finalize_worker_step("ingest", run_id)


def _step_indicators(day: date, symbols: list[str] | None, timeframes: list[str]) -> dict:
    run_id = _create_run("indicators", timeframes)
    run_compute(run_id, timeframes, symbols)
    return _finalize_worker_step("indicators", run_id)


def _step_signals(day: date, symbols: list[str] | None, timeframes: list[str]) -> dict:
    run_id = _create_run("signals", timeframes)
    run_signals(run_id, timeframes, symbols, None)
    return _finalize_worker_step("signals", run_id)


def _step_actions(day: date, symbols: list[str] | None, timeframes: list[str]) -> dict:
    """A failure here is a warning, not fatal -- NSE's site can 403 or time
    out independently of everything else in the pipeline."""
    frm = day - timedelta(days=7)
    to = day + timedelta(days=30)
    try:
        with SessionLocal() as session:
            result = load_actions(session, frm, to)
        message = (
            f"{result['written']} written, {len(result['unparsed'])} unparsed, "
            f"{result['unknown_symbol']} unknown symbol"
        )
        return {"step": "actions", "status": "ok", "message": message,
                "detail": result}
    except Exception as e:
        logger.exception("corporate actions load failed")
        return {"step": "actions", "status": "warning", "message": str(e),
                "detail": {}}


def _step_broker(day: date, symbols: list[str] | None, timeframes: list[str]) -> dict:
    """Sync every active BrokerAccount, across all users. Each account is
    isolated: one account's failure doesn't stop the others. Recorded in one
    IngestRun(mode='broker_sync') row so it shows up in GET /ingest/runs."""
    with SessionLocal() as session:
        run = IngestRun(mode="broker_sync", timeframes=[])
        session.add(run)
        session.commit()
        run_id = run.id

        accounts = list(
            session.scalars(
                select(BrokerAccount).where(BrokerAccount.active.is_(True))
            )
        )
        run.symbols_total = len(accounts)
        session.commit()

        ok = 0
        errors: list[dict] = []
        for account in accounts:
            try:
                sync_account(session, account, day)
                ok += 1
            except Exception as e:
                message = str(e)
                # sync_account sets last_sync_status="auth_failed" (on the
                # same session/object) before re-raising -- see app.brokers.
                # service.sync_account. Groww's trades endpoint only ever
                # serves the CURRENT day, so an auth failure means today's
                # window is gone for good, not just delayed to the next run.
                if getattr(account, "last_sync_status", None) == "auth_failed":
                    note = (
                        f"trades for {day} on account {account.id} were NOT "
                        "captured; Groww's API only serves the current day "
                        f"— recover via POST /broker-accounts/{account.id}"
                        "/import-tradebook"
                    )
                    logger.error("broker sync auth failure for account %s: %s",
                                 account.id, note)
                    errors.append({"account_id": account.id, "error": message,
                                   "note": note})
                else:
                    logger.error("broker sync failed for account %s: %s",
                                 account.id, message)
                    errors.append({"account_id": account.id, "error": message})

        failed = len(errors)
        run = session.get(IngestRun, run_id)
        run.symbols_ok = ok
        run.symbols_failed = failed
        run.errors = errors
        run.status = "completed"
        run.message = f"{ok}/{len(accounts)} accounts synced"
        run.finished_at = now_ist()
        session.commit()
        message = run.message

    step_status = "ok" if failed == 0 else "warning"
    return {
        "step": "broker",
        "status": step_status,
        "message": message,
        "detail": {"run_id": run_id, "accounts": len(accounts), "ok": ok,
                   "failed": failed, "errors": errors},
    }


def _step_ledger(day: date, symbols: list[str] | None, timeframes: list[str]) -> dict:
    with SessionLocal() as session:
        result = apply_unapplied_trades(session)
    errors = result.get("errors", [])
    status = "warning" if errors else "ok"
    message = (
        f"{result['buys_opened']} buys opened, "
        f"{result['sells_allocated']} sells allocated, "
        f"{result['skipped_unmapped']} skipped unmapped, "
        f"{len(errors)} error(s)"
    )
    return {"step": "ledger", "status": status, "message": message, "detail": result}


def _step_evaluate(day: date, symbols: list[str] | None, timeframes: list[str]) -> dict:
    with SessionLocal() as session:
        run = IngestRun(mode="evaluate", timeframes=[])
        session.add(run)
        session.commit()
        run_id = run.id

        try:
            result = evaluate_all(session, as_of=day)
        except Exception as e:
            logger.exception("evaluate step crashed")
            run = session.get(IngestRun, run_id)
            run.status = "failed"
            run.message = str(e)
            run.finished_at = now_ist()
            session.commit()
            return {"step": "evaluate", "status": "failed", "message": str(e),
                    "detail": {"run_id": run_id}}

        errors = result["errors"]
        run = session.get(IngestRun, run_id)
        run.symbols_total = result["evaluated"] + len(errors)
        run.symbols_ok = result["evaluated"]
        run.symbols_failed = len(errors)
        run.errors = errors
        run.status = "completed"
        verdicts = ", ".join(
            f"{k}={v}" for k, v in sorted(result["by_verdict"].items())
        )
        run.message = f"{result['evaluated']} evaluated ({verdicts or 'none'})"
        run.finished_at = now_ist()
        session.commit()
        message = run.message

    status = "warning" if errors else "ok"
    return {
        "step": "evaluate",
        "status": status,
        "message": message,
        "detail": {
            "run_id": run_id, "as_of": str(result["as_of"]),
            "evaluated": result["evaluated"], "by_verdict": result["by_verdict"],
            "errors": errors,
        },
    }


STEP_FUNCS = {
    "reap": _step_reap,
    "ingest": _step_ingest,
    "indicators": _step_indicators,
    "signals": _step_signals,
    "actions": _step_actions,
    "broker": _step_broker,
    "ledger": _step_ledger,
    "evaluate": _step_evaluate,
}


# --- CLI ---------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Daily orchestration job: reap stale runs, ingest, compute "
            "indicators, generate signals, load corporate actions, sync "
            "broker accounts, apply the trade ledger, and evaluate open "
            "positions -- in that order, for one trading day."
        )
    )
    parser.add_argument(
        "--day", type=date.fromisoformat, default=None,
        help="trading day to run for, YYYY-MM-DD (default: last trading day)",
    )
    parser.add_argument(
        "--steps", type=str, default=None,
        help=f"comma-separated subset of {','.join(STEP_ORDER)} (default: all)",
    )
    parser.add_argument(
        "--symbols", type=str, default=None,
        help="comma-separated symbols, passthrough to ingest/indicators/signals",
    )
    parser.add_argument(
        "--timeframes", type=str, default=None,
        help=f"comma-separated subset of {TIMEFRAMES} (default: all)",
    )
    parser.add_argument(
        "--json", action="store_true", help="print only the JSON summary",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        steps = parse_steps(args.steps)
    except ValueError as e:
        parser.error(str(e))
    try:
        timeframes = _parse_timeframes(args.timeframes)
    except ValueError as e:
        parser.error(str(e))
    symbols = _parse_symbols(args.symbols)

    assert_schema_current(engine)

    today = now_ist().date()
    day = args.day or last_trading_day(today)
    if not is_trading_day(today):
        logger.info("not a trading day; catching up to %s", day)

    step_results: list[dict] = []
    degraded = False
    for step in steps:
        logger.info("running step: %s", step)
        try:
            result = STEP_FUNCS[step](day, symbols, timeframes)
        except Exception as e:
            logger.exception("step %s crashed unexpectedly", step)
            result = {"step": step, "status": "failed", "message": str(e),
                      "detail": {}}
        step_results.append(result)
        logger.info("step %s: %s - %s", step, result["status"], result["message"])
        if step == "ingest" and result["status"] == "failed":
            # Signals on yesterday's candles beat no signals at all -- the
            # rest of the pipeline still runs. This flag just says so.
            degraded = True

    summary = summarize(step_results)
    summary["day"] = str(day)
    summary["degraded"] = degraded

    if args.json:
        print(json.dumps(summary, indent=2, default=str))
    else:
        header = f"daily_sync {day}"
        if degraded:
            header += " [DEGRADED: ingest failed]"
        print(header)
        for r in step_results:
            print(f"  {r['status'].upper():8s} {r['step']:11s} {r['message']}")
        print(f"  counts: {summary['counts']}")

    return exit_code_for(step_results)


if __name__ == "__main__":
    sys.exit(main())
