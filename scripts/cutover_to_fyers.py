"""One-time cutover of stored price history from yfinance to Fyers.

For every active symbol: download the full Fyers history (daily + hourly, 4h
built from hourly) and replace the symbol's stored candles in ONE transaction
(app.ingest.service.rebuild_symbol_history fetches before it wipes, so a failed
fetch leaves the old data intact). Then recompute indicators and signals for
all timeframes and print signal counts before/after.

Resumable: a symbol whose stored 1d, 1h and 4h candles are all source='fyers'
is skipped, so after an interruption (or the 06:00 IST token expiry) log in
again and rerun. Turn the daily job OFF on the Admin page first, or the 19:00
job can collide with this script (the script refuses to start otherwise).

Exit codes: 0 every symbol succeeded; 1 some symbol/step failed; 2 Fyers login
needed (not logged in, or the token died mid-run); 3 daily job still enabled.

Run (on the VPS, inside the image):
  python scripts/cutover_to_fyers.py --dry-run
  python scripts/cutover_to_fyers.py
"""

import argparse
import logging
import sys
import time
from types import SimpleNamespace

sys.path.insert(0, ".")
from sqlalchemy import case, func, select  # noqa: E402

from app import settings_store  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import SessionLocal, assert_schema_current, engine  # noqa: E402
from app.ingest.fyers_fetcher import FyersFetcher  # noqa: E402
from app.ingest.fyers_session import FyersLoginRequired  # noqa: E402
from app.ingest.service import FYERS_SOURCE, rebuild_symbol_history  # noqa: E402
from app.market_calendar import last_trading_day, now_ist  # noqa: E402
from app.models import TIMEFRAMES, Candle, Signal, Symbol  # noqa: E402

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger("cutover_to_fyers")

REQUIRED_TFS = ("1d", "1h", "4h")
DAILY_REQUESTS_PER_SYMBOL = 5   # 5y of daily bars / 366-day chunks
HOURLY_REQUESTS_PER_SYMBOL = 8  # 728 days of hourly bars / 100-day chunks

EXIT_OK, EXIT_FAILED, EXIT_LOGIN, EXIT_SCHEDULER = 0, 1, 2, 3


def is_cutover_done(tf_rows: dict[str, tuple[int, int]]) -> bool:
    """tf_rows: {timeframe: (row_count, non_fyers_row_count)} for one symbol.
    Done when 1d, 1h and 4h each have rows and none is from another source."""
    for tf in REQUIRED_TFS:
        n, non_fyers = tf_rows.get(tf, (0, 0))
        if n == 0 or non_fyers > 0:
            return False
    return True


def plan_rebuild(
    symbols: list[str], rows: list[tuple[str, str, int, int]],
) -> tuple[list[str], list[str]]:
    """Pure. rows are the grouped (symbol, timeframe, n, non_fyers_n) tuples.
    Returns (to_rebuild, already_done), both in `symbols` order."""
    by_symbol: dict[str, dict[str, tuple[int, int]]] = {}
    for sym, tf, n, non_fyers in rows:
        by_symbol.setdefault(sym, {})[tf] = (int(n), int(non_fyers))
    todo, done = [], []
    for sym in symbols:
        (done if is_cutover_done(by_symbol.get(sym, {})) else todo).append(sym)
    return todo, done


# Measured in the 2026-10-07 rehearsal: ~5.3 s per symbol end to end (the
# 13 requests at 3/s plus the DB wipe and insert), above the request floor.
MEASURED_SECONDS_PER_SYMBOL = 5.3


def request_estimate(n_symbols: int) -> tuple[int, float]:
    """(requests, best-case seconds) to rebuild `n_symbols` at settings.fyers_rps."""
    reqs = n_symbols * (DAILY_REQUESTS_PER_SYMBOL + HOURLY_REQUESTS_PER_SYMBOL)
    return reqs, reqs / max(settings.fyers_rps, 0.1)


def load_symbols(session, only: list[str] | None) -> list[SimpleNamespace]:
    stmt = select(Symbol.id, Symbol.symbol).order_by(Symbol.symbol)
    if only:
        stmt = stmt.where(Symbol.symbol.in_(only))
    else:
        stmt = stmt.where(Symbol.active.is_(True))
    return [SimpleNamespace(id=i, symbol=s) for i, s in session.execute(stmt)]


def load_grouped_rows(session) -> list[tuple[str, str, int, int]]:
    """ONE grouped query: (symbol, timeframe, rows, rows with source != fyers)."""
    stmt = (
        select(
            Symbol.symbol, Candle.timeframe, func.count(),
            func.coalesce(func.sum(case((Candle.source != FYERS_SOURCE, 1), else_=0)), 0),
        )
        .join(Symbol, Symbol.id == Candle.symbol_id)
        .group_by(Symbol.symbol, Candle.timeframe)
    )
    return [(s, tf, int(n), int(x)) for s, tf, n, x in session.execute(stmt)]


def signal_counts(session) -> dict[str, int]:
    out = {tf: 0 for tf in TIMEFRAMES}
    for tf, n in session.execute(
        select(Signal.timeframe, func.count()).group_by(Signal.timeframe)
    ):
        out[tf] = int(n)
    return out


def _fmt_eta(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m}m{s:02d}s"


def _run_compute_steps(day, symbols: list[str] | None) -> list[dict]:
    # Reuse daily_sync's steps (own IngestRun rows, same messages/status rules).
    from scripts import daily_sync

    results = []
    for step in (daily_sync._step_indicators, daily_sync._step_signals):
        try:
            res = step(day, symbols, list(TIMEFRAMES))
        except Exception as e:
            logger.exception("compute step crashed")
            res = {"step": step.__name__, "status": "failed", "message": str(e)}
        print(f"  {res['status'].upper():8s} {res['step']:11s} {res['message']}")
        results.append(res)
    return results


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dry-run", action="store_true",
                   help="list what would be rebuilt/skipped and the request "
                        "estimate; change nothing")
    p.add_argument("--symbols", help="comma-separated symbols (default: all active)")
    p.add_argument("--limit", type=int, help="rebuild at most N symbols")
    p.add_argument("--allow-scheduler", action="store_true",
                   help="start even though the daily job is enabled")
    p.add_argument("--compute-anyway", action="store_true",
                   help="run indicators/signals even if some symbols failed")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    only = [s.strip().upper() for s in args.symbols.split(",") if s.strip()] \
        if args.symbols else None

    assert_schema_current(engine)

    with SessionLocal() as session:
        cfg = settings_store.get_all(session)
        if cfg.get("daily_job_enabled") and not args.allow_scheduler:
            print("Refusing to start: the daily job is enabled, so the scheduled "
                  "run could collide with the cutover. Turn it off on the Admin "
                  "page (or pass --allow-scheduler).")
            return EXIT_SCHEDULER
        try:
            fetcher = FyersFetcher.from_session(session)
        except FyersLoginRequired:
            print("Fyers login needed. Log in to Fyers on the Admin page, then rerun")
            return EXIT_LOGIN
        syms = load_symbols(session, only)
        grouped = load_grouped_rows(session)

    by_name = {s.symbol: s for s in syms}
    todo_names, done_names = plan_rebuild([s.symbol for s in syms], grouped)
    if args.limit is not None:
        todo_names = todo_names[: max(args.limit, 0)]
    todo = [by_name[n] for n in todo_names]
    reqs, secs = request_estimate(len(todo))

    print(f"{len(syms)} symbols: {len(todo)} to rebuild, {len(done_names)} "
          f"already source='fyers' (skipped)")
    print(f"estimate: ~{reqs} requests ({DAILY_REQUESTS_PER_SYMBOL} daily + "
          f"{HOURLY_REQUESTS_PER_SYMBOL} hourly per symbol); ~"
          f"{_fmt_eta(len(todo) * MEASURED_SECONDS_PER_SYMBOL)} at the measured "
          f"~{MEASURED_SECONDS_PER_SYMBOL}s per symbol (best case "
          f"~{_fmt_eta(secs)} at {settings.fyers_rps} req/s), plus the "
          f"indicator/signal recompute")
    if args.dry_run:
        print("DRY RUN, nothing changed. Would rebuild: " + ", ".join(todo_names[:50])
              + (" ..." if len(todo_names) > 50 else ""))
        if done_names:
            print("Would skip: " + ", ".join(done_names[:50])
                  + (" ..." if len(done_names) > 50 else ""))
        return EXIT_OK

    today = now_ist().date()
    with SessionLocal() as session:
        before = signal_counts(session)

    failures: list[tuple[str, str]] = []
    done = 0
    started = time.monotonic()
    for i, sym in enumerate(todo, 1):
        with SessionLocal() as session:
            try:
                wrote = rebuild_symbol_history(session, sym, fetcher, today)
                session.commit()
            except FyersLoginRequired:
                session.rollback()
                print(f"Fyers login lost after {done} of {len(todo)} symbols "
                      f"(stopped at {sym.symbol}). Log in again on the Admin "
                      f"page and rerun to resume.")
                return EXIT_LOGIN
            except Exception as e:  # incl. FyersFetchError: old data untouched
                session.rollback()
                failures.append((sym.symbol, str(e)))
                logger.error("[%d/%d] %s FAILED: %s", i, len(todo), sym.symbol, e)
                continue
        done += 1
        elapsed = time.monotonic() - started
        eta = elapsed / i * (len(todo) - i)
        logger.info("[%d/%d] %s ok, %d candles, ETA %s",
                    i, len(todo), sym.symbol, wrote, _fmt_eta(eta))

    print(f"rebuilt {done}/{len(todo)} symbols, {len(failures)} failed")
    for name, err in failures:
        print(f"  FAILED {name}: {err}")

    if failures and not args.compute_anyway:
        print("Not recomputing indicators/signals because of the failures above. "
              "Rerun to retry the failed symbols (done ones are skipped), or "
              "pass --compute-anyway.")
        return EXIT_FAILED

    print("recomputing indicators and signals ...")
    results = _run_compute_steps(last_trading_day(today), only)
    with SessionLocal() as session:
        after = signal_counts(session)
    print("signal counts (before -> after):")
    for tf in TIMEFRAMES:
        print(f"  {tf:>3}: {before[tf]:>6} -> {after[tf]:>6}  "
              f"({after[tf] - before[tf]:+d})")

    compute_failed = any(r["status"] == "failed" for r in results)
    return EXIT_FAILED if failures or compute_failed else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
