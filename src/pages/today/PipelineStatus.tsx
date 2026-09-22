// Handoff §5.1: "Pipeline status for the last trading day". One row per step,
// reconstructed from /ingest/runs since there is no daily-job summary endpoint (§11).

import { Link } from 'react-router'
import { useRuns } from '../../api/hooks'
import { Panel } from '../../components/Panel'
import { Chip } from '../../components/Chip'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { fmtIstDateTime, istDateKey } from '../../lib/format'
import type { IngestRun, RunMode, RunStatus } from '../../api/types'
import { formatDuration, todayIstKey } from './utils'

interface Step {
  key: string
  label: string
  modes: RunMode[]
}

const STEPS: Step[] = [
  { key: 'ingest', label: 'Ingest', modes: ['incremental', 'backfill'] },
  { key: 'indicators', label: 'Indicators', modes: ['indicators'] },
  { key: 'signals', label: 'Signals', modes: ['signals'] },
  { key: 'broker_sync', label: 'Broker sync', modes: ['broker_sync'] },
  { key: 'evaluate', label: 'Evaluate', modes: ['evaluate'] },
]

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
}

/** `runs` is newest-first per the API contract, so the first match per mode set is the latest run for that step. */
function latestForModes(runs: IngestRun[], modes: RunMode[]): IngestRun | undefined {
  return runs.find((r) => modes.includes(r.mode))
}

function StepRow({ label, run }: { label: string; run?: IngestRun }) {
  if (!run) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-2 py-1.5">
        <span className="text-sm font-medium">{label}</span>
        <Chip variant="neutral">No run</Chip>
      </div>
    )
  }

  const startedKey = istDateKey(run.started_at)
  const stale = startedKey !== null && startedKey < todayIstKey()

  return (
    <div className="flex flex-col gap-1 rounded border border-border px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Chip variant="status" value={run.status}>
          {STATUS_LABEL[run.status]}
        </Chip>
        {stale && <Chip variant="neutral">stale</Chip>}
      </div>
      <div className="num flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        <span>{fmtIstDateTime(run.started_at)}</span>
        <span>{formatDuration(run.started_at, run.finished_at)}</span>
        <span>
          {run.symbols_ok}/{run.symbols_total} ok
          {run.symbols_failed > 0 && <span className="text-warn"> · {run.symbols_failed} failed</span>}
        </span>
      </div>
      {run.message && <p className="text-xs text-muted">{run.message}</p>}
    </div>
  )
}

export function PipelineStatus() {
  const { data: runs, isLoading, isError, error } = useRuns(50)
  const runsList = runs ?? []
  const ingestRun = latestForModes(runsList, STEPS[0].modes)
  const degraded = ingestRun?.status === 'failed'

  return (
    <Panel
      title="Pipeline status"
      actions={
        <Link to="/ops" className="text-xs text-accent underline">
          All runs →
        </Link>
      }
    >
      {isLoading && <Loading label="Loading pipeline status…" />}
      {isError && <ErrorState error={error} />}
      {!isLoading && !isError && (
        <div className="flex flex-col gap-2">
          {degraded && (
            <div className="rounded border border-warn bg-surface-2 px-2 py-1.5 text-sm font-medium text-warn">
              DEGRADED: last ingest failed — signals and verdicts ran on the previous day's candles
            </div>
          )}
          {STEPS.map((step) => (
            <StepRow key={step.key} label={step.label} run={latestForModes(runsList, step.modes)} />
          ))}
          <p className="text-xs text-muted">Reap, corporate-actions and ledger steps don't record runs yet (see handoff §11).</p>
        </div>
      )}
    </Panel>
  )
}
