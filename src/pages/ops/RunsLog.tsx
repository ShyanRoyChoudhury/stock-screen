// app.jsx 588-596: the runs table, unwrapped (no Panel) between Triggers and Corporate actions,
// exactly as the prototype lays it out. The currently-running run's counters are kept live: since
// only one run can ever be active at a time, a single useRun(id, {poll:true}) at the table level
// substitutes the polled row in place of the stale one from useRuns before rendering — equivalent
// to a per-row live child component, without forking the shared DataTable to support row-level
// component boundaries.

import { type Column, DataTable, ErrorState, Loading, Num, StatusDot, TimeframeBadge, fmt } from '../../ds'
import { useRun, useRuns } from '../../api/hooks'
import type { IngestRun, Timeframe } from '../../api/types'

const columns: Column<IngestRun>[] = [
  { key: 'id', label: 'Run', render: (r) => <span className="ss-n">#{r.id}</span> },
  { key: 'mode', label: 'Mode', render: (r) => <span className="ss-mono">{r.mode}</span> },
  { key: 'status', label: 'Status', render: (r) => <StatusDot status={r.status} /> },
  {
    key: 'tf',
    label: 'TF',
    render: (r) => (
      <span className="app-row" style={{ gap: 4 }}>
        {r.timeframes.map((t) => (
          <TimeframeBadge key={t} timeframe={t as Timeframe} />
        ))}
      </span>
    ),
  },
  {
    key: 'started_at',
    label: 'Started (IST)',
    render: (r) => (
      <span className="ss-n">
        {fmt.date(r.started_at)} {fmt.time(r.started_at, false)}
      </span>
    ),
  },
  { key: 'dur', label: 'Took', align: 'right', render: (r) => <span className="ss-n">{r.finished_at ? fmt.dur(r.started_at, r.finished_at) : '…'}</span> },
  {
    key: 'syms',
    label: 'Symbols ok/total',
    align: 'right',
    render: (r) => (
      <span className="ss-n">
        {r.symbols_ok}/{r.symbols_total}
        {r.symbols_failed ? <span className="ss-down"> · {r.symbols_failed} failed</span> : null}
      </span>
    ),
  },
  { key: 'rows', label: 'Rows written', align: 'right', render: (r) => <Num kind="int" value={r.candles_written} /> },
  { key: 'message', label: 'Message', render: (r) => <span className="ss-muted app-trunc app-trunc-l">{r.message}</span> },
]

export function RunsLog() {
  const { data: runsData, isLoading, isError, error } = useRuns(50)
  const runs = runsData ?? []
  const runningId = runs.find((r) => r.status === 'running')?.id
  const { data: liveRun } = useRun(runningId, { poll: true })
  const rows = liveRun ? runs.map((r) => (r.id === liveRun.id ? liveRun : r)) : runs

  if (isLoading) return <Loading label="Loading runs…" />
  if (isError) return <ErrorState error={error} />
  if (rows.length === 0) return <span className="ss-muted">No runs yet.</span>

  return (
    <DataTable
      ariaLabel="Runs"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      renderExpanded={(r) =>
        r.errors.length ? (
          <div className="app-col" style={{ gap: 4 }}>
            <span className="ss-label">Per-symbol errors</span>
            {r.errors.map((e, i) => (
              <span key={i} className="ss-mono app-small">
                <b>{e.symbol ?? (e.position_id != null ? `Position ${e.position_id}` : '—')}</b> — {e.error}
              </span>
            ))}
          </div>
        ) : (
          <span className="ss-muted">{r.message || 'No errors.'}</span>
        )
      }
    />
  )
}
