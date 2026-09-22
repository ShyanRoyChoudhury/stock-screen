// Positions list — handoff §5.4. Tabs Open/Closed (?status=), group-by-symbol
// toggle, header stat row, Re-evaluate action, wide table + narrow card list.

import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { usePositions, useEvaluatePositions } from '../../api/hooks'
import { useSettings } from '../../lib/settings'
import { fmtInr, fmtFrac, fmtIstDate, fmtNum, signedClass } from '../../lib/format'
import { reasonLabel } from '../../lib/domain'
import type { Position, Verdict } from '../../api/types'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { Chip } from '../../components/Chip'
import { Panel } from '../../components/Panel'
import { Stat } from '../../components/Stat'
import { Toggle } from '../../components/Toggle'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Loading } from '../../components/Loading'
import { ApiKeyPrompt } from '../../components/ApiKeyPrompt'
import { ReasonsInline, WarningsBadge, AvgEntryCell, MatchCell } from './cells'
import {
  VERDICT_PRECEDENCE,
  verdictRank,
  positionVerdict,
  sortByVerdict,
  unrealizedInr,
  groupBySymbol,
  winRate,
  maxEvaluatedOn,
  daysBetween,
  type SymbolGroup,
} from './helpers'

type Status = 'open' | 'closed'

export function PositionsList() {
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const status: Status = searchParams.get('status') === 'closed' ? 'closed' : 'open'
  const [grouped, setGrouped] = useState(false)
  const [evaluateOpen, setEvaluateOpen] = useState(false)

  const { data: positions, isLoading, isError, error, refetch } = usePositions(status)

  function setStatus(next: Status) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('status', next)
      return p
    })
  }

  const sorted = useMemo(() => sortByVerdict(positions ?? []), [positions])
  const groups = useMemo(() => groupBySymbol(sorted), [sorted])

  const verdictCounts = useMemo(() => {
    const counts: Record<Verdict, number> = { EXIT: 0, PARTIAL: 0, REVIEW: 0, HOLD: 0 }
    for (const p of sorted) {
      const v = positionVerdict(p)
      if (v) counts[v]++
    }
    return counts
  }, [sorted])

  const totalUnrealized = useMemo(() => sorted.reduce((s, p) => s + (unrealizedInr(p) ?? 0), 0), [sorted])
  const totalRealized = useMemo(() => sorted.reduce((s, p) => s + (p.realized_pnl ?? 0), 0), [sorted])
  const rate = useMemo(() => winRate(sorted), [sorted])
  // "Open lots" here is exactly `sorted` when status === 'open' (the branch this is shown in).
  const lastEvaluated = useMemo(() => maxEvaluatedOn(sorted), [sorted])

  if (!settings.apiKey) return <ApiKeyPrompt message="Positions needs your API key to load your book." />
  if (isLoading) return <Loading label="Loading positions…" />
  if (isError) return <ErrorState error={error} />

  const openColumns: DataTableColumn<Position>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      sortValue: (p) => p.symbol,
      render: (p) => (
        <Link to={`/symbols/${p.symbol}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
          {p.symbol}
        </Link>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      sortValue: (p) => p.qty_open,
      render: (p) => (
        <span className="num">
          {fmtNum(p.qty_open, 0)}/{fmtNum(p.qty_total, 0)}
        </span>
      ),
    },
    { key: 'avgEntry', header: 'Avg entry', align: 'right', sortValue: (p) => p.avg_entry_price, render: (p) => <AvgEntryCell position={p} /> },
    {
      key: 'lastClose',
      header: 'Last close',
      align: 'right',
      sortValue: (p) => p.latest_evaluation?.close ?? null,
      render: (p) => <span className="num">{fmtInr(p.latest_evaluation?.close ?? null)}</span>,
    },
    {
      key: 'unrealPct',
      header: 'Unreal %',
      align: 'right',
      sortValue: (p) => p.latest_evaluation?.unrealized_pnl_pct ?? null,
      render: (p) => (
        <span className={`num ${signedClass(p.latest_evaluation?.unrealized_pnl_pct)}`}>{fmtFrac(p.latest_evaluation?.unrealized_pnl_pct ?? null)}</span>
      ),
    },
    {
      key: 'unrealInr',
      header: 'Unreal ₹',
      align: 'right',
      sortValue: (p) => unrealizedInr(p),
      render: (p) => {
        const v = unrealizedInr(p)
        return <span className={`num ${signedClass(v)}`}>{fmtInr(v)}</span>
      },
    },
    { key: 'daysHeld', header: 'Days', align: 'right', sortValue: (p) => p.latest_evaluation?.days_held ?? null, render: (p) => p.latest_evaluation?.days_held ?? '—' },
    { key: 'stop', header: 'Stop', align: 'right', sortValue: (p) => p.latest_evaluation?.stop_level ?? null, render: (p) => fmtInr(p.latest_evaluation?.stop_level ?? null) },
    { key: 'trail', header: 'Trail', align: 'right', sortValue: (p) => p.latest_evaluation?.trail_level ?? null, render: (p) => fmtInr(p.latest_evaluation?.trail_level ?? null) },
    { key: 't1', header: 'T1', align: 'right', sortValue: (p) => p.latest_evaluation?.target_1 ?? null, render: (p) => fmtInr(p.latest_evaluation?.target_1 ?? null) },
    { key: 't2', header: 'T2', align: 'right', sortValue: (p) => p.latest_evaluation?.target_2 ?? null, render: (p) => fmtInr(p.latest_evaluation?.target_2 ?? null) },
    {
      key: 'verdict',
      header: 'Verdict',
      sortValue: (p) => verdictRank(positionVerdict(p)),
      render: (p) => (p.latest_evaluation ? <Chip variant="verdict" value={p.latest_evaluation.verdict} /> : <span className="text-muted">—</span>),
    },
    { key: 'reasons', header: 'Reasons', width: 260, render: (p) => <ReasonsInline reasons={p.latest_evaluation?.reasons ?? []} /> },
    { key: 'warnings', header: 'Warnings', render: (p) => <WarningsBadge warnings={p.latest_evaluation?.warnings ?? []} /> },
    { key: 'match', header: 'Match', render: (p) => <MatchCell position={p} /> },
  ]

  const closedColumns: DataTableColumn<Position>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      sortValue: (p) => p.symbol,
      render: (p) => (
        <Link to={`/symbols/${p.symbol}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
          {p.symbol}
        </Link>
      ),
    },
    { key: 'opened', header: 'Opened', sortValue: (p) => p.opened_on, render: (p) => fmtIstDate(p.opened_on) },
    { key: 'closed', header: 'Closed', sortValue: (p) => p.closed_on ?? '', render: (p) => fmtIstDate(p.closed_on) },
    { key: 'qty', header: 'Qty', align: 'right', sortValue: (p) => p.qty_total, render: (p) => <span className="num">{fmtNum(p.qty_total, 0)}</span> },
    { key: 'avgEntry', header: 'Avg entry', align: 'right', sortValue: (p) => p.avg_entry_price, render: (p) => <AvgEntryCell position={p} /> },
    {
      key: 'realizedInr',
      header: 'Realised ₹',
      align: 'right',
      sortValue: (p) => p.realized_pnl,
      render: (p) => <span className={`num ${signedClass(p.realized_pnl)}`}>{fmtInr(p.realized_pnl)}</span>,
    },
    {
      key: 'realizedPct',
      header: 'Realised %',
      align: 'right',
      sortValue: (p) => p.realized_pnl_pct,
      render: (p) => <span className={`num ${signedClass(p.realized_pnl_pct)}`}>{fmtFrac(p.realized_pnl_pct)}</span>,
    },
    { key: 'daysHeld', header: 'Days held', align: 'right', render: (p) => (p.closed_on ? daysBetween(p.opened_on, p.closed_on) : '—') },
    {
      key: 'match',
      header: 'Matched strategy',
      render: (p) => (p.matched_strategy ? <Chip variant="strategy" value={p.matched_strategy} /> : <span className="text-xs text-muted">Unmatched</span>),
    },
  ]

  const groupColumnsOpen: DataTableColumn<SymbolGroup>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      sortValue: (g) => g.symbol,
      render: (g) => (
        <Link to={`/symbols/${g.symbol}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
          {g.symbol}
        </Link>
      ),
    },
    { key: 'lots', header: 'Lots', align: 'right', sortValue: (g) => g.lots.length, render: (g) => g.lots.length },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      sortValue: (g) => g.qtyOpen,
      render: (g) => (
        <span className="num">
          {fmtNum(g.qtyOpen, 0)}/{fmtNum(g.qtyTotal, 0)}
        </span>
      ),
    },
    { key: 'avgEntry', header: 'Weighted avg entry', align: 'right', sortValue: (g) => g.weightedAvgEntry, render: (g) => <span className="num">{fmtInr(g.weightedAvgEntry)}</span> },
    { key: 'lastClose', header: 'Last close', align: 'right', render: (g) => <span className="num">{fmtInr(g.lastClose)}</span> },
    {
      key: 'unrealInr',
      header: 'Unreal ₹',
      align: 'right',
      sortValue: (g) => g.unrealizedInr,
      render: (g) => (
        <span className={`num ${signedClass(g.unrealizedInr)}`}>{fmtInr(g.unrealizedInr)}</span>
      ),
    },
    {
      key: 'verdict',
      header: 'Worst verdict',
      sortValue: (g) => verdictRank(g.worstVerdict),
      render: (g) => (g.worstVerdict ? <Chip variant="verdict" value={g.worstVerdict} /> : <span className="text-muted">—</span>),
    },
  ]

  const groupColumnsClosed: DataTableColumn<SymbolGroup>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      sortValue: (g) => g.symbol,
      render: (g) => (
        <Link to={`/symbols/${g.symbol}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
          {g.symbol}
        </Link>
      ),
    },
    { key: 'lots', header: 'Lots', align: 'right', sortValue: (g) => g.lots.length, render: (g) => g.lots.length },
    { key: 'qty', header: 'Qty total', align: 'right', sortValue: (g) => g.qtyTotal, render: (g) => <span className="num">{fmtNum(g.qtyTotal, 0)}</span> },
    { key: 'avgEntry', header: 'Weighted avg entry', align: 'right', sortValue: (g) => g.weightedAvgEntry, render: (g) => <span className="num">{fmtInr(g.weightedAvgEntry)}</span> },
    {
      key: 'realizedInr',
      header: 'Realised ₹',
      align: 'right',
      sortValue: (g) => g.realizedInr,
      render: (g) => <span className={`num ${signedClass(g.realizedInr)}`}>{fmtInr(g.realizedInr)}</span>,
    },
  ]

  function lotSubRows(lots: Position[]) {
    return (
      <div className="flex flex-col gap-1 p-2">
        {lots.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/positions/${p.id}`)}
            className="flex items-center justify-between gap-3 rounded border border-border bg-surface px-2 py-1 text-left text-xs hover:bg-surface-2"
          >
            <span>
              #{p.id} · opened {fmtIstDate(p.opened_on)} · qty {fmtNum(p.qty_open, 0)}/{fmtNum(p.qty_total, 0)}
            </span>
            <span className="flex items-center gap-2">
              {p.status === 'open' ? (
                <span className={`num ${signedClass(p.latest_evaluation?.unrealized_pnl_pct)}`}>{fmtFrac(p.latest_evaluation?.unrealized_pnl_pct ?? null)}</span>
              ) : (
                <span className={`num ${signedClass(p.realized_pnl_pct)}`}>{fmtFrac(p.realized_pnl_pct)}</span>
              )}
              {p.latest_evaluation && <Chip variant="verdict" value={p.latest_evaluation.verdict} />}
            </span>
          </button>
        ))}
      </div>
    )
  }

  const emptyOpen = status === 'open' && sorted.length === 0
  const emptyClosed = status === 'closed' && sorted.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Positions</h1>
          <p className="text-sm text-muted">Manage the book: open lots, verdicts, matched strategy, and fills.</p>
        </div>
        <Button variant="primary" onClick={() => setEvaluateOpen(true)}>
          Re-evaluate
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex items-center gap-1">
          {(['open', 'closed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
                status === s ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {s === 'open' ? 'Open' : 'Closed'}
            </button>
          ))}
        </div>
        <div className="pb-1.5">
          <Toggle checked={grouped} onChange={setGrouped} label="Group by symbol" />
        </div>
      </div>

      {!emptyOpen && !emptyClosed && (
        <Panel>
          {status === 'open' ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-6">
                <Stat label="Open lots" value={sorted.length} />
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted">By verdict</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {VERDICT_PRECEDENCE.map((v) => (
                      <Chip key={v} variant="verdict" value={v}>{`${v} · ${verdictCounts[v]}`}</Chip>
                    ))}
                  </div>
                </div>
                <Stat label="Total unrealised ₹" value={<span className={signedClass(totalUnrealized)}>{fmtInr(totalUnrealized)}</span>} />
              </div>
              <p className="text-xs text-muted">Last evaluated: {lastEvaluated ? fmtIstDate(lastEvaluated) : 'never'}</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <Stat label="Closed lots" value={sorted.length} />
              <Stat label="Total realised ₹" value={<span className={signedClass(totalRealized)}>{fmtInr(totalRealized)}</span>} />
              <Stat label="Win rate" value={rate === null ? '—' : `${rate.toFixed(1)}%`} />
            </div>
          )}
        </Panel>
      )}

      {emptyOpen && (
        <EmptyState
          title="No open positions"
          message="Positions appear automatically after a broker sync or tradebook import."
          action={
            <Link to="/brokers" className="text-accent underline">
              Go to Brokers
            </Link>
          }
        />
      )}
      {emptyClosed && <EmptyState title="No closed positions yet" message="Closed lots will show up here once a SELL fill closes them out." />}

      {!emptyOpen && !emptyClosed && (
        <>
          {/* Desktop / tablet: dense table */}
          <div className="hidden md:block">
            <Panel>
              {grouped ? (
                <DataTable
                  columns={status === 'open' ? groupColumnsOpen : groupColumnsClosed}
                  rows={groups}
                  rowKey={(g) => g.symbol}
                  expandable={(g) => lotSubRows(g.lots)}
                />
              ) : (
                <DataTable
                  columns={status === 'open' ? openColumns : closedColumns}
                  rows={sorted}
                  rowKey={(p) => p.id}
                  onRowClick={(p) => navigate(`/positions/${p.id}`)}
                />
              )}
            </Panel>
          </div>

          {/* Narrow screens: card list (per-lot, ungrouped) */}
          <div className="flex flex-col gap-2 md:hidden">
            {sorted.map((p) => (
              <Link
                key={p.id}
                to={`/positions/${p.id}`}
                className="flex flex-col gap-1 rounded border border-border bg-surface p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.symbol}</span>
                  {p.latest_evaluation ? (
                    <Chip variant="verdict" value={p.latest_evaluation.verdict} />
                  ) : (
                    <span className="text-xs text-muted">Not evaluated</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  {status === 'open' ? (
                    <span className={`num ${signedClass(p.latest_evaluation?.unrealized_pnl_pct)}`}>{fmtFrac(p.latest_evaluation?.unrealized_pnl_pct ?? null)}</span>
                  ) : (
                    <span className={`num ${signedClass(p.realized_pnl_pct)}`}>{fmtFrac(p.realized_pnl_pct)}</span>
                  )}
                  <span className="text-muted">
                    Stop {fmtInr(p.latest_evaluation?.stop_level ?? null)} · Trail {fmtInr(p.latest_evaluation?.trail_level ?? null)}
                  </span>
                </div>
                {p.latest_evaluation && p.latest_evaluation.reasons.length > 0 && (
                  <div className="text-xs text-muted">{p.latest_evaluation.reasons.map((r) => reasonLabel(r.code)).join(', ')}</div>
                )}
              </Link>
            ))}
          </div>
        </>
      )}

      <Dialog open={evaluateOpen} onClose={() => setEvaluateOpen(false)} title="Re-evaluate positions">
        <EvaluateDialogBody onDone={() => refetch()} />
      </Dialog>
    </div>
  )
}

function EvaluateDialogBody({ onDone }: { onDone: () => void }) {
  const [asOf, setAsOf] = useState('')
  const mutation = useEvaluatePositions()

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs text-muted">
        As-of date (optional — defaults to the last trading day)
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-text"
        />
      </label>
      <Button
        variant="primary"
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate(
            { as_of: asOf || undefined },
            { onSuccess: onDone },
          )
        }
      >
        {mutation.isPending ? 'Evaluating…' : 'Run'}
      </Button>
      {mutation.isError && <ErrorState error={mutation.error} title="Evaluation failed" />}
      {mutation.isSuccess && mutation.data && (
        <div className="rounded border border-border bg-surface-2 p-2 text-xs">
          <p>
            Evaluated {mutation.data.evaluated} position{mutation.data.evaluated === 1 ? '' : 's'} as of {mutation.data.as_of}.
          </p>
          <ul className="mt-1 flex flex-wrap gap-3">
            {Object.entries(mutation.data.by_verdict).map(([v, n]) => (
              <li key={v}>
                {v}: {n}
              </li>
            ))}
          </ul>
          {mutation.data.errors.length > 0 && (
            <p className="mt-1 text-exit">
              {mutation.data.errors.length} error{mutation.data.errors.length === 1 ? '' : 's'}: {mutation.data.errors.map((e) => e.error).join('; ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
