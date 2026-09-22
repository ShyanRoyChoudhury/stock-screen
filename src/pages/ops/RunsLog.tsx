// Handoff §5.7: every job, with a live progress bar for `running` rows. The progress cell is
// its own component so useRun(id, {poll:true}) is called per-row-component (a proper React
// component instance) rather than inside DataTable's row-render loop, which would break the
// rules of hooks.

import { useRun, useRuns } from '../../api/hooks'
import { Panel } from '../../components/Panel'
import { Chip } from '../../components/Chip'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { fmtIstDateTime, fmtNum } from '../../lib/format'
import { RUN_MODE_LABELS } from '../../lib/domain'
import type { IngestRun, RunStatus } from '../../api/types'
import { formatDuration } from './utils'

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
}

function ProgressCell({ run }: { run: IngestRun }) {
  const { data } = useRun(run.status === 'running' ? run.id : undefined, { poll: true })
  const live = data ?? run
  const total = live.symbols_total
  const done = live.symbols_ok + live.symbols_failed
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded bg-surface-2">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-xs text-muted">
        {done}/{total}
      </span>
    </div>
  )
}

const columns: DataTableColumn<IngestRun>[] = [
  { key: 'id', header: 'Id', align: 'right', sortValue: (r) => r.id, render: (r) => r.id },
  { key: 'mode', header: 'Mode', sortValue: (r) => r.mode, render: (r) => RUN_MODE_LABELS[r.mode] },
  {
    key: 'status',
    header: 'Status',
    sortValue: (r) => r.status,
    render: (r) => (
      <Chip variant="status" value={r.status}>
        {STATUS_LABEL[r.status]}
      </Chip>
    ),
  },
  { key: 'started', header: 'Started', sortValue: (r) => r.started_at, render: (r) => fmtIstDateTime(r.started_at) },
  {
    key: 'finished',
    header: 'Finished',
    sortValue: (r) => r.finished_at ?? '',
    render: (r) => fmtIstDateTime(r.finished_at),
  },
  { key: 'duration', header: 'Duration', render: (r) => formatDuration(r.started_at, r.finished_at) },
  { key: 'timeframes', header: 'Timeframes', render: (r) => (r.timeframes.length ? r.timeframes.join(', ') : '—') },
  { key: 'progress', header: 'Progress', render: (r) => <ProgressCell run={r} /> },
  {
    key: 'rows',
    header: 'Rows written',
    align: 'right',
    sortValue: (r) => r.candles_written,
    render: (r) => fmtNum(r.candles_written, 0),
  },
  { key: 'message', header: 'Message', render: (r) => r.message ?? '—' },
]

export function RunsLog() {
  const { data: runs, isLoading, isError, error } = useRuns(50)
  const rows = runs ?? []

  return (
    <div id="runs-log" className="scroll-mt-16">
      <Panel title="Runs log">
        {isLoading && <Loading label="Loading runs…" />}
        {isError && <ErrorState error={error} />}
        {!isLoading && !isError && rows.length === 0 && <EmptyState title="No runs yet" />}
        {!isLoading && !isError && rows.length > 0 && (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            expandable={(r) =>
              r.errors.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted">No errors</p>
              ) : (
                <ul className="flex flex-col gap-0.5 px-2 py-1 text-xs">
                  {r.errors.map((e, i) => (
                    <li key={i}>
                      {e.symbol ?? (e.position_id !== undefined ? `Position ${e.position_id}` : '—')}: {e.error}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        )}
      </Panel>
    </div>
  )
}
