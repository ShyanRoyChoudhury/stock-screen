"""Tests for the daily orchestration job.

(a) reap_stale_runs against the real dev DB.
(b) daily_sync's --steps parsing.
(c) the summary/exit-code logic given a fake step result list.

The pipeline itself (ingest/indicators/signals/broker/ledger/evaluate) is
NOT run here -- see the task's Verify section for the smoke-run coverage.
This file only exercises the pure/DB-adjacent pieces, per daily_sync.py's
importable parse_steps/summarize/exit_code_for.
"""

from datetime import timedelta

import pytest
from sqlalchemy import delete

from app.db import SessionLocal
from app.market_calendar import now_ist
from app.models import IngestRun
from scripts.daily_sync import STEP_ORDER, exit_code_for, parse_steps, summarize
from scripts.reap_stale_runs import reap_stale_runs


# --- (a) reap_stale_runs against the real dev DB ------------------------

def test_reap_stale_runs_fails_a_run_stuck_running_past_the_cutoff():
    with SessionLocal() as session:
        stale = IngestRun(
            mode="incremental",
            status="running",
            timeframes=["1d"],
            started_at=now_ist() - timedelta(hours=7),
        )
        session.add(stale)
        session.commit()
        stale_id = stale.id

        try:
            reaped_ids = reap_stale_runs(session, older_than_hours=6.0)
            assert stale_id in reaped_ids

            session.refresh(stale)
            assert stale.status == "failed"
            assert "reaped" in stale.message
            assert "running" in stale.message
            assert stale.finished_at is not None
        finally:
            session.execute(delete(IngestRun).where(IngestRun.id == stale_id))
            session.commit()


def test_reap_stale_runs_leaves_a_recent_running_run_alone():
    with SessionLocal() as session:
        fresh = IngestRun(
            mode="incremental",
            status="running",
            timeframes=["1d"],
            started_at=now_ist() - timedelta(hours=1),
        )
        session.add(fresh)
        session.commit()
        fresh_id = fresh.id

        try:
            reaped_ids = reap_stale_runs(session, older_than_hours=6.0)
            assert fresh_id not in reaped_ids

            session.refresh(fresh)
            assert fresh.status == "running"
        finally:
            session.execute(delete(IngestRun).where(IngestRun.id == fresh_id))
            session.commit()


# --- (b) --steps parsing --------------------------------------------------

def test_parse_steps_default_is_every_step_in_canonical_order():
    assert parse_steps(None) == list(STEP_ORDER)
    assert parse_steps("") == list(STEP_ORDER)


def test_parse_steps_reorders_input_to_canonical_order():
    assert parse_steps("signals,reap,ledger") == ["reap", "signals", "ledger"]


def test_parse_steps_rejects_unknown_step_names():
    with pytest.raises(ValueError):
        parse_steps("reap,bogus")


def test_parse_steps_dedupes_repeated_names():
    assert parse_steps("reap,reap,ingest") == ["reap", "ingest"]


# --- (c) summary / exit-code logic -----------------------------------

def test_summarize_counts_each_status():
    results = [
        {"step": "reap", "status": "ok", "message": "", "detail": {}},
        {"step": "ingest", "status": "warning", "message": "", "detail": {}},
        {"step": "signals", "status": "failed", "message": "", "detail": {}},
    ]
    summary = summarize(results)
    assert summary["counts"] == {"ok": 1, "warning": 1, "failed": 1}
    assert summary["steps"] == results


def test_exit_code_for_is_zero_when_nothing_failed():
    results = [
        {"step": "reap", "status": "ok"},
        {"step": "ledger", "status": "warning"},
    ]
    assert exit_code_for(results) == 0


def test_exit_code_for_is_nonzero_when_any_step_failed():
    results = [
        {"step": "reap", "status": "ok"},
        {"step": "ingest", "status": "failed"},
    ]
    assert exit_code_for(results) == 1
