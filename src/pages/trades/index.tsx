// Trades — handoff §5.5. Audit raw broker fills, filter by date/symbol, and
// reattribute a SELL fill across open lots when FIFO guessed wrong.

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTrades, usePositions, useReattributeSell } from '../../api/hooks'
import { useSettings } from '../../lib/settings'
import { fmtIstDateTime, fmtInr, fmtNum, fmtIstDate } from '../../lib/format'
import type { Trade } from '../../api/types'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { Panel } from '../../components/Panel'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Tooltip } from '../../components/Tooltip'
import { ApiKeyPrompt } from '../../components/ApiKeyPrompt'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { Loading } from '../../components/Loading'

export default function TradesPage() {
  const { settings } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const fromDate = searchParams.get('from') ?? ''
  const toDate = searchParams.get('to') ?? ''
  const symbolFilter = searchParams.get('symbol') ?? ''

  const { data: trades, isLoading, isError, error } = useTrades({
    from_date: fromDate || undefined,
    to_date: toDate || undefined,
    symbol: symbolFilter || undefined,
  })

  const [reattributeTrade, setReattributeTrade] = useState<Trade | null>(null)

  function updateParam(key: string, value: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      if (value) p.set(key, value)
      else p.delete(key)
      return p
    })
  }

  const columns: DataTableColumn<Trade>[] = useMemo(
    () => [
      { key: 'ts', header: 'Date/time', sortValue: (t) => t.trade_ts, render: (t) => fmtIstDateTime(t.trade_ts) },
      { key: 'broker', header: 'Broker', sortValue: (t) => t.broker, render: (t) => t.broker },
      { key: 'tradingsymbol', header: 'Tradingsymbol', sortValue: (t) => t.tradingsymbol, render: (t) => t.tradingsymbol },
      {
        key: 'symbol',
        header: 'Mapped symbol',
        sortValue: (t) => t.symbol ?? '',
        render: (t) =>
          t.symbol ? (
            <Link to={`/symbols/${t.symbol}`} className="text-accent hover:underline">
              {t.symbol}
            </Link>
          ) : (
            <Tooltip text="Broker symbol did not resolve to a Nifty 500 symbol; the ledger skips it">
              <span className="inline-flex items-center rounded border border-warn px-1.5 py-0.5 text-xs text-warn">unmapped</span>
            </Tooltip>
          ),
      },
      { key: 'isin', header: 'ISIN', render: (t) => t.isin ?? '—' },
      {
        key: 'side',
        header: 'Side',
        sortValue: (t) => t.side,
        render: (t) => <span className={t.side === 'BUY' ? 'font-medium text-up' : 'font-medium text-down'}>{t.side}</span>,
      },
      { key: 'qty', header: 'Qty', align: 'right', sortValue: (t) => t.quantity, render: (t) => <span className="num">{fmtNum(t.quantity, 0)}</span> },
      { key: 'price', header: 'Price', align: 'right', sortValue: (t) => t.price, render: (t) => <span className="num">{fmtInr(t.price)}</span> },
      {
        key: 'position',
        header: 'Position',
        sortValue: (t) => t.position_id ?? -1,
        render: (t) =>
          t.position_id ? (
            <Link to={`/positions/${t.position_id}`} className="text-accent hover:underline">
              #{t.position_id}
            </Link>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        key: 'applied',
        header: 'Applied',
        render: (t) =>
          t.applied_at ? (
            <span className="text-up">✓ {fmtIstDate(t.applied_at)}</span>
          ) : (
            <span className="text-muted">pending</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        render: (t) =>
          t.side === 'SELL' && t.symbol ? (
            <Button size="sm" onClick={() => setReattributeTrade(t)}>
              Reattribute
            </Button>
          ) : null,
      },
    ],
    [],
  )

  if (!settings.apiKey) return <ApiKeyPrompt message="Trades needs your API key to load your fills." />

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Trades</h1>
        <p className="text-sm text-muted">Audit the raw broker fills and fix the ledger when FIFO guessed wrong.</p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => updateParam('from', e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => updateParam('to', e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Symbol
            <input
              type="text"
              value={symbolFilter}
              onChange={(e) => updateParam('symbol', e.target.value.toUpperCase())}
              placeholder="e.g. RELIANCE"
              className="rounded border border-border bg-surface px-2 py-1 text-sm text-text"
            />
          </label>
        </div>
      </Panel>

      {isLoading && <Loading label="Loading trades…" />}
      {isError && <ErrorState error={error} />}
      {!isLoading && !isError && (!trades || trades.length === 0) && (
        <EmptyState
          title="No trades yet"
          message="Sync a broker account or import a tradebook CSV."
          action={
            <Link to="/brokers" className="text-accent underline">
              Go to Brokers
            </Link>
          }
        />
      )}
      {!isLoading && !isError && trades && trades.length > 0 && (
        <Panel>
          <DataTable columns={columns} rows={trades} rowKey={(t) => t.id} />
        </Panel>
      )}

      {reattributeTrade && <ReattributeDialog trade={reattributeTrade} onClose={() => setReattributeTrade(null)} />}
    </div>
  )
}

function ReattributeDialog({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const { data: allPositions } = usePositions()
  const positions = useMemo(() => (allPositions ?? []).filter((p) => p.symbol === trade.symbol), [allPositions, trade.symbol])

  const [allocations, setAllocations] = useState<Record<number, number>>({})

  useEffect(() => {
    setAllocations((prev) => {
      const next: Record<number, number> = { ...prev }
      for (const p of positions) {
        if (!(p.id in next)) next[p.id] = p.id === trade.position_id ? trade.quantity : 0
      }
      return next
    })
  }, [positions, trade])

  const mutation = useReattributeSell()

  const sum = Object.values(allocations).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0)
  const valid = sum === trade.quantity && positions.length > 0

  function submit() {
    const body = {
      allocations: positions
        .filter((p) => (allocations[p.id] ?? 0) > 0)
        .map((p) => ({ position_id: p.id, quantity: allocations[p.id] })),
    }
    mutation.mutate({ sellId: trade.id, body }, { onSuccess: onClose })
  }

  return (
    <Dialog open onClose={onClose} title={`Reattribute SELL #${trade.id} — ${trade.tradingsymbol}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-muted">
          Allocate this {fmtNum(trade.quantity, 0)}-qty SELL across {trade.symbol}'s open lots. Quantities must sum to {fmtNum(trade.quantity, 0)}.
        </p>

        {positions.length === 0 ? (
          <p className="text-xs text-down">No positions found for {trade.symbol}.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {positions.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted">
                  #{p.id} · opened {fmtIstDate(p.opened_on)} · qty total {fmtNum(p.qty_total, 0)}
                </span>
                <input
                  type="number"
                  min={0}
                  value={allocations[p.id] ?? 0}
                  onChange={(e) =>
                    setAllocations((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))
                  }
                  className="num w-24 rounded border border-border bg-surface px-2 py-1 text-sm text-text"
                />
              </div>
            ))}
          </div>
        )}

        <p className={`text-xs ${valid ? 'text-up' : 'text-down'}`}>
          Sum: {fmtNum(sum, 0)} / {fmtNum(trade.quantity, 0)} {valid ? '✓' : ''}
        </p>

        {mutation.isError && <ErrorState error={mutation.error} title="Could not reattribute" />}

        <div className="flex gap-2">
          <Button variant="primary" disabled={!valid || mutation.isPending} onClick={submit}>
            {mutation.isPending ? 'Submitting…' : 'Submit'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  )
}
