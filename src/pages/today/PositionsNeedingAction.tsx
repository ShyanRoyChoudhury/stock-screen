// app.jsx 108-121: "Positions needing action" — the left column of Today. Open positions sorted
// EXIT -> PARTIAL -> REVIEW, HOLD collapsed under a toggle. Needs an API key (positions are
// per-user); per BUILD_BRIEF, this is the one place on Today that renders an ApiKeyPrompt for the
// whole "positions column" (broker banners are simply skipped elsewhere when there's no key).

import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ApiKeyPrompt,
  Badge,
  Button,
  CodeList,
  type Column,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Num,
  Panel,
  StrategyTag,
  SymbolCell,
  VerdictChip,
  fmt,
} from '../../ds'
import { useBrokerAccounts, usePositions } from '../../api/hooks'
import { useSettings } from '../../lib/settings'
import type { Position } from '../../api/types'
import { VERDICT_ORDER, verdictOf } from './utils'

const columns: Column<Position>[] = [
  { key: 'verdict', label: 'Verdict', render: (p) => <VerdictChip verdict={verdictOf(p)} size="sm" /> },
  { key: 'symbol', label: 'Symbol', render: (p) => <SymbolCell symbol={p.symbol} /> },
  { key: 'qty', label: 'Qty', align: 'right', render: (p) => <Num kind="qty" value={p.qty_open} /> },
  { key: 'close', label: 'Close ₹', align: 'right', render: (p) => <Num value={p.latest_evaluation?.close ?? null} /> },
  {
    key: 'pnl',
    label: 'Unrl %',
    align: 'right',
    render: (p) => <Num kind="frac" value={p.latest_evaluation?.unrealized_pnl_pct ?? null} signed tone="auto" />,
  },
  {
    key: 'why',
    label: 'Why',
    render: (p) => <CodeList reasons={p.latest_evaluation?.reasons ?? []} warnings={p.latest_evaluation?.warnings ?? []} showLabel={false} />,
  },
  {
    key: 'matched',
    label: 'Matched',
    render: (p) =>
      p.is_unmatched || !p.matched_strategy ? (
        <Badge>Unmatched</Badge>
      ) : (
        <StrategyTag strategy={p.matched_strategy} extra={p.match_confidence != null ? ` ${Math.round(p.match_confidence * 100)}%` : undefined} />
      ),
  },
]

function PositionsTable({ session }: { session: string }) {
  const navigate = useNavigate()
  const brokerAccounts = useBrokerAccounts()
  const positions = usePositions('open')
  const [showHold, setShowHold] = useState(false)

  if (brokerAccounts.isLoading || positions.isLoading) {
    return (
      <Panel title="Positions">
        <Loading label="Loading positions…" />
      </Panel>
    )
  }
  if (brokerAccounts.isError) {
    return (
      <Panel title="Positions">
        <ErrorState error={brokerAccounts.error} />
      </Panel>
    )
  }
  if (positions.isError) {
    return (
      <Panel title="Positions">
        <ErrorState error={positions.error} />
      </Panel>
    )
  }

  const accounts = brokerAccounts.data ?? []
  if (accounts.length === 0) {
    return (
      <Panel title="Positions">
        <EmptyState
          title="No broker account linked"
          action={
            <Button variant="primary" onClick={() => navigate('/brokers?add=1')}>
              Add Groww account
            </Button>
          }
        >
          Positions and verdicts start the evening after your first sync. You can also import a tradebook CSV.
        </EmptyState>
      </Panel>
    )
  }

  const open = positions.data ?? []
  if (open.length === 0) {
    return (
      <Panel title="Positions">
        <EmptyState title="No open positions">Buys you place at the broker appear here after the next 16:15 IST sync.</EmptyState>
      </Panel>
    )
  }

  const act = open.filter((p) => verdictOf(p) !== 'HOLD').sort((a, b) => VERDICT_ORDER[verdictOf(a)] - VERDICT_ORDER[verdictOf(b)])
  const hold = open.filter((p) => verdictOf(p) === 'HOLD')

  return (
    <Panel
      title="Positions needing action"
      pad={false}
      right={
        <Button size="sm" variant="ghost" kbd="g p" onClick={() => navigate('/positions')}>
          All positions
        </Button>
      }
    >
      {act.length ? (
        <DataTable ariaLabel="Positions needing action" columns={columns} rows={act} rowKey={(p) => p.id} onRowOpen={(p) => navigate(`/positions/${p.id}`)} />
      ) : (
        <EmptyState title="Nothing to act on" glyph="· · ·">
          All {hold.length} open positions say HOLD.
        </EmptyState>
      )}
      <div className="ss-table-foot">
        <button type="button" className="app-link" onClick={() => setShowHold((s) => !s)} aria-expanded={showHold}>
          {showHold ? '▾' : '▸'} {hold.length} HOLD position{hold.length === 1 ? '' : 's'}
        </button>
        <span className="ss-spacer" />
        <span>as of close {fmt.date(session)}</span>
      </div>
      {showHold ? (
        <DataTable ariaLabel="HOLD positions" columns={columns} rows={hold} rowKey={(p) => p.id} onRowOpen={(p) => navigate(`/positions/${p.id}`)} />
      ) : null}
    </Panel>
  )
}

export function PositionsNeedingAction({ session }: { session: string }) {
  const { settings } = useSettings()
  if (!settings.apiKey) {
    return (
      <Panel title="Positions">
        <ApiKeyPrompt message="Positions and broker status need an API key to load." />
      </Panel>
    )
  }
  return <PositionsTable session={session} />
}
