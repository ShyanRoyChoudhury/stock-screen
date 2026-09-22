// Handoff §5.7: filter by symbol/type/limit, browse the raw NSE corporate-action rows.

import { useState } from 'react'
import { Link } from 'react-router'
import { useCorporateActions } from '../../api/hooks'
import { Panel } from '../../components/Panel'
import { Chip } from '../../components/Chip'
import { Select } from '../../components/Select'
import { Tooltip } from '../../components/Tooltip'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { fmtInr, fmtIstDate, fmtNum } from '../../lib/format'
import { ACTION_TYPE_LABELS } from '../../lib/domain'
import type { ActionType, CorporateAction } from '../../api/types'

function TypeChip({ type }: { type: ActionType }) {
  const label = ACTION_TYPE_LABELS[type]
  if (type === 'demerger') {
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-warn px-1.5 py-0.5 text-xs font-medium text-warn"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-warn) 12%, transparent)' }}
        title="Prices are not demerger-adjusted; the chart may show a false cliff"
      >
        {label}
      </span>
    )
  }
  return <Chip variant="neutral">{label}</Chip>
}

const LIMIT_OPTIONS = [
  { value: '50', label: '50' },
  { value: '200', label: '200' },
  { value: '500', label: '500' },
]

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  ...Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => ({ value, label })),
]

const columns: DataTableColumn<CorporateAction>[] = [
  {
    key: 'symbol',
    header: 'Symbol',
    sortValue: (a) => a.symbol,
    render: (a) => (
      <Link to={`/symbols/${a.symbol}`} className="text-accent hover:underline">
        {a.symbol}
      </Link>
    ),
  },
  { key: 'type', header: 'Type', sortValue: (a) => a.action_type, render: (a) => <TypeChip type={a.action_type} /> },
  { key: 'ex_date', header: 'Ex-date', align: 'right', sortValue: (a) => a.ex_date, render: (a) => fmtIstDate(a.ex_date) },
  {
    key: 'record_date',
    header: 'Record date',
    align: 'right',
    sortValue: (a) => a.record_date ?? '',
    render: (a) => fmtIstDate(a.record_date),
  },
  { key: 'value', header: 'Value', align: 'right', sortValue: (a) => a.value ?? -Infinity, render: (a) => fmtInr(a.value) },
  {
    key: 'ratio',
    header: 'Ratio',
    align: 'right',
    render: (a) => (a.ratio_from !== null && a.ratio_to !== null ? `${fmtNum(a.ratio_from, 0)}:${fmtNum(a.ratio_to, 0)}` : '—'),
  },
  {
    key: 'price_factor',
    header: 'Price factor',
    align: 'right',
    sortValue: (a) => a.price_factor ?? -Infinity,
    render: (a) => (a.price_factor === null ? '—' : a.price_factor.toFixed(4)),
  },
  { key: 'extraordinary', header: 'Extraordinary', align: 'center', render: (a) => (a.is_extraordinary ? '✓' : '') },
  { key: 'affects_shares', header: 'Affects shares', align: 'center', render: (a) => (a.affects_share_count ? '✓' : '') },
  {
    key: 'subject',
    header: 'Subject',
    render: (a) => (
      <Tooltip text={a.subject}>
        <span className="inline-block max-w-[240px] truncate align-bottom">{a.subject}</span>
      </Tooltip>
    ),
  },
]

export function CorporateActionsBrowser() {
  const [symbol, setSymbol] = useState('')
  const [actionType, setActionType] = useState('')
  const [limit, setLimit] = useState('50')

  const { data, isLoading, isError, error } = useCorporateActions({
    symbol: symbol.trim() ? symbol.trim().toUpperCase() : undefined,
    action_type: actionType ? (actionType as ActionType) : undefined,
    limit: Number(limit),
  })
  const rows = data ?? []

  return (
    <Panel title="Corporate actions browser">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Symbol (exact)"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-sm"
        />
        <Select value={actionType} onChange={setActionType} options={TYPE_OPTIONS} />
        <Select value={limit} onChange={setLimit} options={LIMIT_OPTIONS} />
      </div>
      {isLoading && <Loading label="Loading corporate actions…" />}
      {isError && <ErrorState error={error} />}
      {!isLoading && !isError && rows.length === 0 && <EmptyState title="No corporate actions match these filters" />}
      {!isLoading && !isError && rows.length > 0 && (
        <DataTable columns={columns} rows={rows} rowKey={(a) => `${a.symbol}-${a.action_type}-${a.ex_date}`} />
      )}
    </Panel>
  )
}
