// app.jsx 81-82, 122-124: "Daily job" — one row per pipeline step, reconstructed from
// /ingest/runs since there's no daily-job summary endpoint. KEEPS the richer derivation from the
// previous implementation: the latest run per mode (not only today's), with a "stale · ran {date}"
// message when that run belongs to an earlier session than the one Today is reporting on. The
// running step's counters are polled live via useRun(id, {poll:true}).

import { useNavigate } from 'react-router'
import { Button, ErrorState, fmt, Loading, Panel, PipelineSteps, type Step } from '../../ds'
import { useRun, useRuns } from '../../api/hooks'
import { istDateKey } from '../../lib/format'
import type { IngestRun, RunMode } from '../../api/types'
import { latestForModes } from './utils'

const STEPS: { name: string; modes: RunMode[] }[] = [
  { name: 'Ingest candles', modes: ['incremental', 'backfill'] },
  { name: 'Indicators', modes: ['indicators'] },
  { name: 'Signals', modes: ['signals'] },
  { name: 'Broker sync', modes: ['broker_sync'] },
  { name: 'Evaluate positions', modes: ['evaluate'] },
]

function countsFor(r: IngestRun): string {
  const base =
    r.mode === 'evaluate'
      ? `${r.symbols_ok} evaluated`
      : r.mode === 'broker_sync'
        ? `${r.symbols_ok}/${r.symbols_total} accounts`
        : `${r.symbols_ok}/${r.symbols_total}`
  return r.finished_at ? `${base} · ${fmt.dur(r.started_at, r.finished_at)}` : base
}

function stepFor(name: string, modes: RunMode[], runs: IngestRun[], live: IngestRun | undefined, session: string): Step {
  const found = latestForModes(runs, modes)
  if (!found) return { name, status: 'pending', counts: 'not run' }
  const r = live && live.id === found.id ? live : found

  const startedKey = istDateKey(r.started_at)
  const stale = startedKey !== null && startedKey < session

  const status: Step['status'] = r.status === 'running' ? 'running' : r.status === 'failed' ? 'failed' : r.symbols_failed > 0 ? 'warning' : 'ok'
  const message = stale ? `stale · ran ${fmt.date(r.started_at)}` : r.status === 'failed' || r.symbols_failed > 0 ? r.message : null

  return {
    name,
    status,
    finishedAt: r.finished_at ?? undefined,
    counts: countsFor(r),
    message,
    progress: r.status === 'running' && r.symbols_total > 0 ? r.symbols_ok / r.symbols_total : undefined,
  }
}

export function PipelineStatus({ session }: { session: string }) {
  const navigate = useNavigate()
  const { data: runsData, isLoading, isError, error } = useRuns(50)
  const runs = runsData ?? []
  const runningId = runs.find((r) => r.status === 'running')?.id
  const { data: liveRun } = useRun(runningId, { poll: true })

  return (
    <Panel title="Daily job" right={<span className="ss-muted ss-n app-small">{fmt.date(session)}</span>}>
      {isLoading ? (
        <Loading label="Loading pipeline status…" />
      ) : isError ? (
        <ErrorState error={error} />
      ) : (
        <PipelineSteps steps={STEPS.map((s) => stepFor(s.name, s.modes, runs, liveRun, session))} />
      )}
      <div className="app-row" style={{ marginTop: 8, alignItems: 'center' }}>
        <span className="ss-muted app-small">Reap, corporate-actions and ledger steps don’t record runs yet.</span>
        <span className="ss-spacer" />
        <Button size="sm" variant="ghost" kbd="g o" onClick={() => navigate('/ops')}>
          All runs
        </Button>
      </div>
    </Panel>
  )
}
