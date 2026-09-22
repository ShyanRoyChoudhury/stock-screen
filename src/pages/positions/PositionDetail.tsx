// Position detail — handoff §5.4. Header, stat grid, levels, latest
// evaluation, verdict history, match panel (with re-match dialog), fills.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { usePosition, usePositionEvaluations, useTrades, useSignals, useMatchPosition } from '../../api/hooks'
import { useSettings } from '../../lib/settings'
import { fmtInr, fmtFrac, fmtPct, fmtIstDate, fmtIstDateTime, fmtNum, signedClass, istDateKey } from '../../lib/format'
import { reasonLabel, warningLabel } from '../../lib/domain'
import { ApiError } from '../../api/types'
import type { Position, Evaluation, Trade } from '../../api/types'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { Panel } from '../../components/Panel'
import { Stat } from '../../components/Stat'
import { Chip } from '../../components/Chip'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Loading } from '../../components/Loading'
import { ApiKeyPrompt } from '../../components/ApiKeyPrompt'
import { AvgEntryCell, ReasonsInline, WarningsBadge } from './cells'
import { subDaysIso, unrealizedInr } from './helpers'

const HISTORY_COLUMNS: DataTableColumn<Evaluation>[] = [
  { key: 'date', header: 'Date', sortValue: (e) => e.as_of, render: (e) => fmtIstDate(e.as_of) },
  { key: 'verdict', header: 'Verdict', sortValue: (e) => e.verdict, render: (e) => <Chip variant="verdict" value={e.verdict} /> },
  { key: 'close', header: 'Close', align: 'right', sortValue: (e) => e.close, render: (e) => <span className="num">{fmtInr(e.close)}</span> },
  { key: 'stop', header: 'Stop', align: 'right', sortValue: (e) => e.stop_level, render: (e) => <span className="num">{fmtInr(e.stop_level)}</span> },
  { key: 'trail', header: 'Trail', align: 'right', sortValue: (e) => e.trail_level, render: (e) => <span className="num">{fmtInr(e.trail_level)}</span> },
  {
    key: 'unreal',
    header: 'Unreal %',
    align: 'right',
    sortValue: (e) => e.unrealized_pnl_pct,
    render: (e) => <span className={`num ${signedClass(e.unrealized_pnl_pct)}`}>{fmtFrac(e.unrealized_pnl_pct)}</span>,
  },
  { key: 'days', header: 'Days', align: 'right', sortValue: (e) => e.days_held, render: (e) => e.days_held },
  { key: 'reasons', header: 'Reasons', render: (e) => <ReasonsInline reasons={e.reasons} /> },
  { key: 'warnings', header: 'Warnings', render: (e) => <WarningsBadge warnings={e.warnings} /> },
]

const FILLS_COLUMNS: DataTableColumn<Trade>[] = [
  { key: 'ts', header: 'Date/time', sortValue: (t) => t.trade_ts, render: (t) => fmtIstDateTime(t.trade_ts) },
  {
    key: 'side',
    header: 'Side',
    sortValue: (t) => t.side,
    render: (t) => <span className={t.side === 'BUY' ? 'font-medium text-up' : 'font-medium text-down'}>{t.side}</span>,
  },
  { key: 'qty', header: 'Qty', align: 'right', sortValue: (t) => t.quantity, render: (t) => <span className="num">{fmtNum(t.quantity, 0)}</span> },
  { key: 'price', header: 'Price', align: 'right', sortValue: (t) => t.price, render: (t) => <span className="num">{fmtInr(t.price)}</span> },
]

export function PositionDetail({ id }: { id: number }) {
  const { settings } = useSettings()
  const navigate = useNavigate()
  const { data: position, isLoading, isError, error } = usePosition(id)
  const { data: evaluations } = usePositionEvaluations(id)
  const { data: trades } = useTrades({ symbol: position?.symbol })
  const [matchDialogOpen, setMatchDialogOpen] = useState(false)

  if (!settings.apiKey) return <ApiKeyPrompt message="Position detail needs your API key." />
  if (isLoading) return <Loading label="Loading position…" />
  if (isError) {
    const status = error instanceof ApiError ? error.status : undefined
    if (status === 404) {
      return (
        <EmptyState
          title="Position not found"
          message="It may have been removed, or the id in the URL is wrong."
          action={
            <Link to="/positions" className="text-accent underline">
              Back to positions
            </Link>
          }
        />
      )
    }
    return <ErrorState error={error} />
  }
  if (!position) return null

  const ev = position.latest_evaluation
  const fills = (trades ?? []).filter((t) => t.position_id === id)
  const unrealized = unrealizedInr(position)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/symbols/${position.symbol}`} className="text-lg font-semibold text-accent hover:underline">
              {position.symbol}
            </Link>
            {ev ? <Chip variant="verdict" value={ev.verdict} /> : <span className="text-xs text-muted">Not yet evaluated</span>}
            <span className={`text-xs font-medium ${position.status === 'open' ? 'text-up' : 'text-muted'}`}>{position.status}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
            <span>Opened {fmtIstDate(position.opened_on)}</span>
            {position.closed_on && <span>· Closed {fmtIstDate(position.closed_on)}</span>}
            <span>·</span>
            {position.is_unmatched || !position.matched_strategy ? (
              <span>Unmatched</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Chip variant="strategy" value={position.matched_strategy} />
                {fmtPct((position.match_confidence ?? 0) * 100)} confidence
              </span>
            )}
          </p>
        </div>
        <Button onClick={() => navigate(`/symbols/${position.symbol}`)}>Open chart</Button>
      </div>

      <Panel title="Overview">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Qty open/total" value={`${fmtNum(position.qty_open, 0)}/${fmtNum(position.qty_total, 0)}`} />
          <Stat label="Avg entry" value={<AvgEntryCell position={position} />} />
          <Stat label="Last close" value={fmtInr(ev?.close ?? null)} />
          <Stat
            label="Unrealised %"
            value={<span className={signedClass(ev?.unrealized_pnl_pct)}>{fmtFrac(ev?.unrealized_pnl_pct ?? null)}</span>}
          />
          <Stat label="Unrealised ₹" value={<span className={signedClass(unrealized)}>{fmtInr(unrealized)}</span>} />
          <Stat label="Days held" value={ev?.days_held ?? '—'} />
          {position.status === 'closed' && (
            <>
              <Stat label="Realised ₹" value={<span className={signedClass(position.realized_pnl)}>{fmtInr(position.realized_pnl)}</span>} />
              <Stat label="Realised %" value={<span className={signedClass(position.realized_pnl_pct)}>{fmtFrac(position.realized_pnl_pct)}</span>} />
            </>
          )}
        </div>
      </Panel>

      <Panel title="Levels">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div>
            <p className="text-xs text-muted">Entry</p>
            <AvgEntryCell position={position} />
          </div>
          <div>
            <p className="text-xs text-muted">Stop</p>
            <p className="num">{fmtInr(ev?.stop_level ?? position.frozen_stop ?? null)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Trail</p>
            <p className="num">{fmtInr(ev?.trail_level ?? null)}</p>
          </div>
          {position.is_unmatched ? (
            <div className="col-span-2 flex items-center">
              <p className="text-xs text-warn">Unmatched: trailing stop only, no targets</p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs text-muted">T1</p>
                <p className="num">{fmtInr(ev?.target_1 ?? position.frozen_target_1 ?? null)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">T2</p>
                <p className="num">{fmtInr(ev?.target_2 ?? position.frozen_target_2 ?? null)}</p>
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Latest evaluation">
        {ev ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Chip variant="verdict" value={ev.verdict} />
              <span className="text-xs text-muted">as of {fmtIstDate(ev.as_of)}</span>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted">Reasons</p>
              {ev.reasons.length === 0 ? (
                <p className="text-xs text-muted">None</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {ev.reasons.map((r, i) => (
                    <li key={i}>
                      <span className="font-medium">{reasonLabel(r.code)}</span>
                      {r.detail && <span className="text-muted"> — {r.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs text-muted">Warnings</p>
              {ev.warnings.length === 0 ? (
                <p className="text-xs text-muted">None</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {ev.warnings.map((w, i) => (
                    <li key={i}>
                      <span className="font-medium">{warningLabel(w.code)}</span>
                      {w.detail && <span className="text-muted"> — {w.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Not yet evaluated.</p>
        )}
      </Panel>

      <Panel title="Verdict history">
        {!evaluations || evaluations.length === 0 ? (
          <p className="text-sm text-muted">No evaluation history yet.</p>
        ) : (
          <DataTable columns={HISTORY_COLUMNS} rows={evaluations} rowKey={(e) => e.as_of} />
        )}
      </Panel>

      <Panel
        title="Match"
        actions={
          <Button size="sm" onClick={() => setMatchDialogOpen(true)}>
            Change match
          </Button>
        }
      >
        {position.is_unmatched || !position.matched_strategy ? (
          <p className="text-sm text-muted">Unmatched — trailing stop only, no targets.</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Chip variant="strategy" value={position.matched_strategy} />
              <span className="text-xs text-muted">
                {fmtIstDate(position.matched_signal_ts)} · {fmtPct((position.match_confidence ?? 0) * 100)} confidence
              </span>
            </div>
            {position.match_reason && <p className="text-xs text-muted">{position.match_reason}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted">Frozen entry</p>
                <p className="num">{fmtInr(position.frozen_entry)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Frozen stop</p>
                <p className="num">{fmtInr(position.frozen_stop)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Frozen T1</p>
                <p className="num">{fmtInr(position.frozen_target_1)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Frozen T2</p>
                <p className="num">{fmtInr(position.frozen_target_2)}</p>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Fills">
        {fills.length === 0 ? (
          <p className="text-sm text-muted">No linked fills.</p>
        ) : (
          <DataTable columns={FILLS_COLUMNS} rows={fills} rowKey={(t) => t.id} />
        )}
      </Panel>

      <Dialog open={matchDialogOpen} onClose={() => setMatchDialogOpen(false)} title="Change match">
        {matchDialogOpen && <CandidateSignals position={position} onClose={() => setMatchDialogOpen(false)} />}
      </Dialog>
    </div>
  )
}

function CandidateSignals({ position, onClose }: { position: Position; onClose: () => void }) {
  const since = subDaysIso(position.opened_on, 14)
  const { data: signals, isLoading, isError, error } = useSignals({ symbol: position.symbol, timeframe: '1d', since, limit: 200 })
  const matchMutation = useMatchPosition()

  if (isLoading) return <Loading label="Loading candidate signals…" />
  if (isError) return <ErrorState error={error} />

  const candidates = (signals ?? []).filter((s) => (istDateKey(s.ts) ?? '') <= position.opened_on)

  return (
    <div className="flex flex-col gap-2">
      {matchMutation.isError && <ErrorState error={matchMutation.error} title={matchErrorTitle(matchMutation.error)} />}
      {candidates.length === 0 ? (
        <p className="text-sm text-muted">
          No 1d signals found for {position.symbol} in the two weeks up to {fmtIstDate(position.opened_on)}.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {candidates.map((s) => (
            <div key={`${s.strategy}-${s.ts}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <Chip variant="strategy" value={s.strategy} />
                <span className="text-muted">{fmtIstDate(s.ts)}</span>
              </div>
              <div className="num flex items-center gap-3">
                <span>E {fmtInr(s.entry)}</span>
                <span>S {fmtInr(s.stop_loss)}</span>
                <span>T1 {fmtInr(s.target_1)}</span>
                <span>T2 {fmtInr(s.target_2)}</span>
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={matchMutation.isPending}
                onClick={() => matchMutation.mutate({ id: position.id, body: { strategy: s.strategy, ts: s.ts } }, { onSuccess: onClose })}
              >
                Use this
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function matchErrorTitle(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return 'No matching signal found'
  return 'Could not update match'
}
