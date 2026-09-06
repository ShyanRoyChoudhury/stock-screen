from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.ingest.service import run_ingest
from app.models import TIMEFRAMES, IngestRun
from app.schemas import IngestRequest, IngestRunOut

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("/run", response_model=IngestRunOut, status_code=202)
def start_ingest(
    req: IngestRequest,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
):
    if req.mode not in ("backfill", "incremental"):
        raise HTTPException(422, "mode must be 'backfill' or 'incremental'")
    bad = [tf for tf in req.timeframes if tf not in TIMEFRAMES]
    if bad or not req.timeframes:
        raise HTTPException(422, f"timeframes must be a subset of {TIMEFRAMES}")

    running = session.scalar(
        select(IngestRun).where(IngestRun.status == "running").limit(1)
    )
    if running:
        raise HTTPException(409, f"Ingest run {running.id} is already in progress")

    run = IngestRun(mode=req.mode, timeframes=req.timeframes)
    session.add(run)
    session.commit()

    background.add_task(run_ingest, run.id, req.mode, req.timeframes, req.symbols)
    return run


@router.get("/runs", response_model=list[IngestRunOut])
def list_runs(limit: int = 20, session: Session = Depends(get_session)):
    return list(
        session.scalars(
            select(IngestRun).order_by(IngestRun.id.desc()).limit(limit)
        )
    )


@router.get("/runs/{run_id}", response_model=IngestRunOut)
def get_run(run_id: int, session: Session = Depends(get_session)):
    run = session.get(IngestRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run
