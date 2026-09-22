// app.jsx 601-609: browse the raw NSE corporate-action rows, filtered server-side by symbol,
// type and limit (KEEPS the current implementation's server-side filtering via useCorporateActions'
// params, rather than the prototype's client-side filter over a fixed limit:500 fetch).

import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Badge, type Column, CorpActionMarker, DataTable, EmptyState, ErrorState, Loading, Menu, Num, Panel, fmt, labels } from '../../ds'
import { useCorporateActions } from '../../api/hooks'
import type { ActionType, CorporateAction } from '../../api/types'

const TYPE_OPTIONS = (['dividend', 'split', 'bonus', 'rights', 'demerger'] as ActionType[]).map((t) => ({
  value: t,
  label: labels.actions[t][1],
}))
const LIMIT_OPTIONS = [50, 200, 500].map((n) => ({ value: n, label: String(n) }))

function columns(navigate: ReturnType<typeof useNavigate>): Column<CorporateAction>[] {
  return [
    { key: 'ex_date', label: 'Ex-date', sortable: true, render: (a) => <span className="ss-n">{fmt.date(a.ex_date)}</span> },
    {
      key: 'symbol',
      label: 'Symbol',
      sortable: true,
      render: (a) => (
        <button
          type="button"
          className="app-link ss-sym"
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/symbols/${a.symbol}`)
          }}
        >
          {a.symbol}
        </button>
      ),
    },
    { key: 'type', label: 'Type', render: (a) => <CorpActionMarker type={a.action_type} showLabel={false} /> },
    { key: 'record_date', label: 'Record', render: (a) => <span className="ss-n ss-muted">{fmt.date(a.record_date ?? '')}</span> },
    { key: 'value', label: 'Value ₹', align: 'right', render: (a) => <Num value={a.value} /> },
    {
      key: 'ratio',
      label: 'Ratio',
      align: 'right',
      render: (a) => <span className="ss-n">{a.ratio_from != null && a.ratio_to != null ? `${fmt.qty(a.ratio_from)}:${fmt.qty(a.ratio_to)}` : '—'}</span>,
    },
    { key: 'pf', label: 'Price factor', align: 'right', render: (a) => <Num value={a.price_factor} decimals={4} /> },
    { key: 'x', label: 'Extra', render: (a) => (a.is_extraordinary ? <Badge tone="warn">Extraordinary</Badge> : null) },
    { key: 'subject', label: 'NSE subject', render: (a) => <span className="ss-muted">{a.subject}</span> },
  ]
}

export function CorporateActionsBrowser() {
  const navigate = useNavigate()
  const [symbol, setSymbol] = useState('')
  const [actionType, setActionType] = useState<ActionType | null>(null)
  const [limit, setLimit] = useState(50)

  const { data, isLoading, isError, error } = useCorporateActions({
    symbol: symbol.trim() ? symbol.trim().toUpperCase() : undefined,
    action_type: actionType ?? undefined,
    limit,
  })
  const rows = data ?? []

  return (
    <Panel
      title="Corporate actions"
      pad={false}
      right={
        <div className="app-row" style={{ gap: 8 }}>
          <input
            aria-label="Filter by symbol"
            className="ss-input ss-input-mono"
            style={{ width: 140 }}
            placeholder="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
          <Menu label="Type" value={actionType} onChange={setActionType} onClear={() => setActionType(null)} options={TYPE_OPTIONS} />
          <Menu label="Limit" value={limit} onChange={setLimit} options={LIMIT_OPTIONS} />
        </div>
      }
    >
      {isLoading ? (
        <Loading label="Loading corporate actions…" />
      ) : isError ? (
        <ErrorState error={error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No corporate actions match these filters" />
      ) : (
        <DataTable
          ariaLabel="Corporate actions"
          columns={columns(navigate)}
          rows={rows}
          rowKey={(a) => `${a.symbol}-${a.action_type}-${a.ex_date}`}
          initialSort={{ key: 'ex_date', dir: 'desc' }}
        />
      )}
    </Panel>
  )
}
