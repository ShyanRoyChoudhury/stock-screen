// Trades — BUILD_BRIEF "Deliverable 2", mirroring
// design/prototype/src/app.jsx:459-508 (Trades + Reattribute).

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { usePositions, useReattributeSell, useTrades } from '../../api/hooks'
import { ApiError } from '../../api/types'
import type { Trade } from '../../api/types'
import {
  ApiKeyPrompt,
  Badge,
  Banner,
  Button,
  type Column,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Num,
  PageHead,
  Tabs,
  fmt,
} from '../../ds'
import { useSettings } from '../../lib/settings'
import { useToast } from '../../lib/toast'

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} · ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

type Side = 'all' | 'BUY' | 'SELL'

export default function TradesPage() {
  const { settings } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const symbolParam = searchParams.get('symbol') ?? ''
  const fromParam = searchParams.get('from') ?? ''
  const toParam = searchParams.get('to') ?? ''
  const sideParamRaw = searchParams.get('side')
  const sideParam: Side = sideParamRaw === 'BUY' || sideParamRaw === 'SELL' ? sideParamRaw : 'all'

  const { data: trades, isLoading, isError, error } = useTrades({
    from_date: fromParam || undefined,
    to_date: toParam || undefined,
    symbol: symbolParam || undefined,
  })

  function updateParam(key: string, value: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      if (value) p.set(key, value)
      else p.delete(key)
      return p
    })
  }

  const all = trades ?? []
  const rows = useMemo(() => all.filter((t) => sideParam === 'all' || t.side === sideParam), [all, sideParam])
  const unmapped = all.filter((t) => !t.symbol).length

  const columns: Column<Trade>[] = [
    {
      key: 'trade_ts',
      label: 'Date / time (IST)',
      sortable: true,
      sortValue: (t) => t.trade_ts,
      render: (t) => (
        <span className="ss-n">
          {fmt.date(t.trade_ts)} <span className="ss-muted">{fmt.time(t.trade_ts, false)}</span>
        </span>
      ),
    },
    { key: 'broker', label: 'Broker', render: (t) => <span className="ss-muted">{t.broker}</span> },
    { key: 'tradingsymbol', label: 'Tradingsymbol', render: (t) => <span className="ss-mono">{t.tradingsymbol}</span> },
    {
      key: 'symbol',
      label: 'Mapped',
      render: (t) =>
        t.symbol ? (
          <Link to={`/symbols/${t.symbol}`} className="app-link ss-sym" onClick={(e) => e.stopPropagation()}>
            {t.symbol}
          </Link>
        ) : (
          <Badge tone="down">Unmapped</Badge>
        ),
    },
    { key: 'isin', label: 'ISIN', render: (t) => <span className="ss-n ss-faint">{t.isin ?? '—'}</span> },
    { key: 'side', label: 'Side', render: (t) => <Badge tone={t.side === 'BUY' ? 'up' : 'down'}>{t.side}</Badge> },
    { key: 'quantity', label: 'Qty', align: 'right', render: (t) => <Num kind="qty" value={t.quantity} /> },
    { key: 'price', label: 'Price', align: 'right', render: (t) => <Num value={t.price} /> },
    {
      key: 'pos',
      label: 'Position',
      render: (t) =>
        t.position_id ? (
          <Link to={`/positions/${t.position_id}`} className="app-link ss-n" onClick={(e) => e.stopPropagation()}>
            #{t.position_id}
          </Link>
        ) : (
          <span className="ss-faint">—</span>
        ),
    },
    {
      key: 'applied',
      label: 'Applied',
      render: (t) => (t.applied_at ? <span className="ss-n ss-muted">✓ {fmt.date(t.applied_at)}</span> : <span className="ss-down app-small">skipped · unmapped</span>),
    },
  ]

  if (!settings.apiKey) return <ApiKeyPrompt message="Trades needs your API key to load your fills." />

  return (
    <div className="ss-page">
      <PageHead title="Trades" sub={`${all.length} broker fills · ledger audit`} />

      {unmapped ? (
        <Banner tone="degraded" title={`${unmapped} unmapped fill${unmapped > 1 ? 's' : ''}`}>
          The broker symbol didn’t resolve to a Nifty 500 symbol, so the ledger skipped it. No position was opened.
        </Banner>
      ) : null}

      <div className="app-filters">
        <div className="app-inline-field">
          <label className="ss-label" htmlFor="tr-sym">
            Symbol
          </label>
          <input
            id="tr-sym"
            className="ss-input ss-input-mono"
            value={symbolParam}
            onChange={(e) => updateParam('symbol', e.target.value.toUpperCase())}
            placeholder="Any"
          />
        </div>
        <div className="app-inline-field">
          <label className="ss-label" htmlFor="tr-from">
            From
          </label>
          <input id="tr-from" type="date" className="ss-input ss-input-mono" value={fromParam} onChange={(e) => updateParam('from', e.target.value)} />
        </div>
        <div className="app-inline-field">
          <label className="ss-label" htmlFor="tr-to">
            To
          </label>
          <input id="tr-to" type="date" className="ss-input ss-input-mono" value={toParam} onChange={(e) => updateParam('to', e.target.value)} />
        </div>
        <Tabs
          variant="segmented"
          ariaLabel="Side"
          value={sideParam}
          onChange={(v) => updateParam('side', v === 'all' ? '' : v)}
          items={[
            { id: 'all', label: 'All' },
            { id: 'BUY', label: 'BUY' },
            { id: 'SELL', label: 'SELL' },
          ]}
        />
      </div>

      {isLoading ? <Loading label="Loading trades…" /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {!isLoading && !isError && all.length === 0 ? <EmptyState title="No fills yet">Sync a broker account or import a tradebook CSV.</EmptyState> : null}
      {!isLoading && !isError && all.length > 0 ? (
        <DataTable
          ariaLabel="Trades"
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          renderExpanded={(t) =>
            t.side === 'SELL' && t.symbol ? (
              <Reattribute trade={t} />
            ) : (
              <span className="ss-muted">
                {t.side === 'BUY'
                  ? t.position_id
                    ? `This BUY opened lot #${t.position_id}.`
                    : `Not applied: no Nifty 500 symbol for ${t.tradingsymbol}.`
                  : 'Unmapped SELL — nothing to reattribute.'}
              </span>
            )
          }
          footer={
            <>
              <span>{rows.length} fills</span>
              <span className="ss-spacer" />
              <span>Expand a SELL to reattribute it across lots</span>
            </>
          }
        />
      ) : null}
    </div>
  )
}

function Reattribute({ trade }: { trade: Trade }) {
  const toast = useToast()
  const { data: allPositions } = usePositions()
  const lots = (allPositions ?? []).filter((p) => p.symbol === trade.symbol)
  const [alloc, setAlloc] = useState<Record<number, string | number>>({})
  const mutation = useReattributeSell()

  // `lots` arrives asynchronously (usePositions() fetches fresh on this row's first mount), so
  // the default allocation is filled in here rather than in useState's initializer, which would
  // run before the query resolves and leave every lot defaulted to 0.
  useEffect(() => {
    setAlloc((prev) => {
      let changed = false
      const next = { ...prev }
      for (const p of lots) {
        if (!(p.id in next)) {
          next[p.id] = p.id === trade.position_id ? trade.quantity : 0
          changed = true
        }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots.map((p) => p.id).join(','), trade.id])

  const sum = Object.values(alloc).reduce((s: number, v) => s + (Number(v) || 0), 0)
  const over = lots.find((p) => (Number(alloc[p.id]) || 0) > p.qty_total)
  const err = sum !== trade.quantity ? `Allocations sum to ${sum}; the SELL is for ${trade.quantity}.` : over ? `Lot #${over.id} only has ${over.qty_total} shares.` : null

  function submit() {
    const allocations = lots.filter((p) => (Number(alloc[p.id]) || 0) > 0).map((p) => ({ position_id: p.id, quantity: Number(alloc[p.id]) }))
    mutation.mutate(
      { sellId: trade.id, body: { allocations } },
      {
        onSuccess: () => toast(`Reattributed SELL #${trade.id} across ${allocations.length} lot${allocations.length === 1 ? '' : 's'}.`),
      },
    )
  }

  if (lots.length === 0) {
    return <span className="ss-down app-small">No positions found for {trade.symbol}.</span>
  }

  return (
    <div className="app-col" style={{ gap: 10, maxWidth: 560 }}>
      <div className="ss-label">
        Reattribute SELL #{trade.id} · {fmt.qty(trade.quantity)} {trade.symbol} @ {fmt.price(trade.price)}
      </div>
      {lots.map((p) => (
        <div key={p.id} className="app-alloc">
          <span className="ss-n">#{p.id}</span>
          <span className="ss-n ss-muted">
            {fmt.date(p.opened_on)} · {fmt.qty(p.qty_total)} @ {fmt.price(p.avg_entry_price)}
          </span>
          <span className="ss-spacer" />
          <input
            aria-label={`Quantity from lot ${p.id}`}
            className="ss-input ss-input-mono"
            style={{ width: 90, textAlign: 'right' }}
            type="number"
            min="0"
            value={alloc[p.id] ?? 0}
            onChange={(e) => setAlloc((a) => ({ ...a, [p.id]: e.target.value }))}
          />
        </div>
      ))}
      <div className="app-row">
        {err ? <span className="ss-down app-small">422 · {err}</span> : <span className="ss-up app-small">✓ Sums to {fmt.qty(trade.quantity)}</span>}
        <span className="ss-spacer" />
        <Button size="sm" variant="primary" disabled={!!err || mutation.isPending} onClick={submit}>
          Submit allocation
        </Button>
      </div>
      {mutation.isError ? <span className="ss-down app-small">{errorMessage(mutation.error)}</span> : null}
    </div>
  )
}
