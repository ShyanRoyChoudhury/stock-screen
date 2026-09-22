// Positions list — BUILD_BRIEF "Deliverable 1", mirroring
// design/prototype/src/app.jsx:314-386 (Positions). Three tabs (open lots /
// by symbol / closed), verdict+symbol filters on the open tab, all state
// mirrored to the URL.

import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useEvaluatePositions, usePositions } from '../../api/hooks'
import type { Position, Verdict } from '../../api/types'
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
  Menu,
  Num,
  PageHead,
  Panel,
  StrategyTag,
  Tabs,
  VerdictChip,
  fmt,
} from '../../ds'
import { useSettings } from '../../lib/settings'
import { useToast } from '../../lib/toast'
import { AsPaidCell, MatchCell } from './cells'
import { VORDER, errorMessage, groupBySymbol, groupByStrategy, maxEvaluatedOn, unrlInr, type SymbolGroup } from './helpers'

type Tab = 'open' | 'sym' | 'closed'

function isTab(v: string | null): v is Tab {
  return v === 'open' || v === 'sym' || v === 'closed'
}

export function PositionsList() {
  const { settings } = useSettings()
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: positions, isLoading, isError, error } = usePositions()
  const evaluateMutation = useEvaluatePositions()

  const tabParam = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(isTab(tabParam) ? tabParam : settings.positionsDefault === 'sym' ? 'sym' : 'open')
  const [verdictFilter, setVerdictFilter] = useState<Verdict | null>((searchParams.get('verdict') as Verdict) || null)
  const [symbolFilter, setSymbolFilter] = useState<string | null>(searchParams.get('symbol') || null)

  function updateParams(next: Record<string, string | null>) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      return p
    })
  }

  function changeTab(id: string) {
    setTab(id as Tab)
    updateParams({ tab: id })
  }
  function changeVerdict(v: Verdict | null) {
    setVerdictFilter(v)
    updateParams({ verdict: v })
  }
  function changeSymbol(s: string | null) {
    setSymbolFilter(s)
    updateParams({ symbol: s })
  }

  const all = useMemo(() => positions ?? [], [positions])
  const open = useMemo(() => all.filter((p) => p.status === 'open'), [all])
  const closed = useMemo(() => all.filter((p) => p.status === 'closed'), [all])
  const groups = useMemo(() => groupBySymbol(open), [open])
  const rows = useMemo(
    () => open.filter((p) => (!verdictFilter || p.last_verdict === verdictFilter) && (!symbolFilter || p.symbol === symbolFilter)),
    [open, verdictFilter, symbolFilter],
  )
  const sessionDate = useMemo(() => maxEvaluatedOn(open), [open])
  const strategyStats = useMemo(() => groupByStrategy(closed), [closed])
  const totalRealized = useMemo(() => closed.reduce((s, p) => s + (p.realized_pnl ?? 0), 0), [closed])

  function handleReevaluate() {
    evaluateMutation.mutate(
      {},
      {
        onSuccess: (data) => {
          const bv = data.by_verdict
          toast(`${data.evaluated} evaluated · EXIT ${bv.EXIT ?? 0} · PARTIAL ${bv.PARTIAL ?? 0} · REVIEW ${bv.REVIEW ?? 0} · HOLD ${bv.HOLD ?? 0}`)
        },
        onError: (err) => toast(errorMessage(err)),
      },
    )
  }

  if (!settings.apiKey) return <ApiKeyPrompt message="Positions needs your API key to load your book." />
  if (isLoading) return <Loading label="Loading positions…" />
  if (isError) return <ErrorState error={error} />

  const openColumns: Column<Position>[] = [
    {
      key: 'symbol',
      label: 'Symbol',
      sortable: true,
      sortValue: (p) => p.symbol,
      render: (p) => (
        <span>
          <span className="ss-sym">{p.symbol}</span> <span className="ss-faint ss-n app-small">#{p.id}</span>
        </span>
      ),
    },
    {
      key: 'qty',
      label: 'Qty',
      align: 'right',
      render: (p) => (
        <span className="ss-n">
          {fmt.qty(p.qty_open)}
          <span className="ss-faint">/{fmt.qty(p.qty_total)}</span>
        </span>
      ),
    },
    {
      key: 'avg',
      label: 'Avg entry',
      align: 'right',
      title: 'Adjusted terms — comparable to the chart',
      sortValue: (p) => p.avg_entry_price,
      render: (p) => <Num value={p.avg_entry_price} />,
    },
    {
      key: 'raw',
      label: 'As paid',
      align: 'right',
      title: 'What you actually paid; differs only after a split/bonus',
      render: (p) => <AsPaidCell position={p} />,
    },
    { key: 'close', label: 'Last', align: 'right', sortValue: (p) => p.latest_evaluation?.close ?? null, render: (p) => <Num value={p.latest_evaluation?.close ?? null} /> },
    {
      key: 'pnl',
      label: 'Unrl %',
      align: 'right',
      sortable: true,
      sortValue: (p) => p.latest_evaluation?.unrealized_pnl_pct ?? null,
      render: (p) => <Num kind="frac" value={p.latest_evaluation?.unrealized_pnl_pct ?? null} signed tone="auto" />,
    },
    {
      key: 'inr',
      label: 'Unrl ₹',
      align: 'right',
      sortable: true,
      sortValue: (p) => unrlInr(p),
      render: (p) => <Num kind="inr" value={unrlInr(p)} signed tone="auto" />,
    },
    {
      key: 'days',
      label: 'Days',
      align: 'right',
      sortable: true,
      sortValue: (p) => p.latest_evaluation?.days_held ?? null,
      render: (p) => <Num kind="int" value={p.latest_evaluation?.days_held ?? null} />,
    },
    { key: 'stop', label: 'Stop', align: 'right', render: (p) => <Num value={p.latest_evaluation?.stop_level ?? null} /> },
    { key: 'trail', label: 'Trail', align: 'right', render: (p) => <Num value={p.latest_evaluation?.trail_level ?? null} className="ss-muted" /> },
    { key: 't1', label: 'T1', align: 'right', render: (p) => (p.is_unmatched ? <span className="ss-faint">—</span> : <Num value={p.frozen_target_1} />) },
    { key: 't2', label: 'T2', align: 'right', render: (p) => (p.is_unmatched ? <span className="ss-faint">—</span> : <Num value={p.frozen_target_2} />) },
    {
      key: 'verdict',
      label: 'Verdict',
      sortable: true,
      sortValue: (p) => VORDER[p.last_verdict ?? 'HOLD'],
      render: (p) => <VerdictChip verdict={p.last_verdict ?? 'HOLD'} size="sm" />,
    },
    { key: 'why', label: 'Reasons · warnings', render: (p) => <CodeList reasons={p.latest_evaluation?.reasons ?? []} warnings={p.latest_evaluation?.warnings ?? []} showLabel={false} /> },
    { key: 'm', label: 'Matched', render: (p) => <MatchCell position={p} /> },
  ]

  const symbolColumns: Column<SymbolGroup>[] = [
    { key: 'symbol', label: 'Symbol', render: (g) => <span className="ss-sym">{g.symbol}</span> },
    { key: 'lots', label: 'Lots', align: 'right', render: (g) => <Num kind="int" value={g.lots.length} /> },
    { key: 'qty', label: 'Qty', align: 'right', render: (g) => <Num kind="qty" value={g.qty} /> },
    { key: 'avg', label: 'Wtd avg entry', align: 'right', render: (g) => <Num value={g.avg} /> },
    { key: 'close', label: 'Last', align: 'right', render: (g) => <Num value={g.close ?? null} /> },
    { key: 'pnl', label: 'Unrl %', align: 'right', render: (g) => <Num kind="frac" value={g.close != null && g.avg ? g.close / g.avg - 1 : null} signed tone="auto" /> },
    { key: 'inr', label: 'Unrl ₹', align: 'right', render: (g) => <Num kind="inr" value={g.close != null ? g.qty * (g.close - g.avg) : null} signed tone="auto" /> },
    { key: 'v', label: 'Worst verdict', render: (g) => (g.verdict ? <VerdictChip verdict={g.verdict} size="sm" /> : <span className="ss-faint">—</span>) },
  ]

  const closedColumns: Column<Position>[] = [
    { key: 'symbol', label: 'Symbol', sortable: true, sortValue: (p) => p.symbol, render: (p) => <span className="ss-sym">{p.symbol}</span> },
    { key: 'opened_on', label: 'Opened', sortable: true, sortValue: (p) => p.opened_on, render: (p) => <span className="ss-n">{fmt.date(p.opened_on)}</span> },
    { key: 'closed_on', label: 'Closed', sortable: true, sortValue: (p) => p.closed_on ?? '', render: (p) => <span className="ss-n">{p.closed_on ? fmt.date(p.closed_on) : '—'}</span> },
    { key: 'qty_total', label: 'Qty', align: 'right', render: (p) => <Num kind="qty" value={p.qty_total} /> },
    { key: 'avg', label: 'Entry', align: 'right', render: (p) => <Num value={p.avg_entry_price} /> },
    { key: 'realized_pnl', label: 'Realised ₹ (gross)', align: 'right', sortable: true, sortValue: (p) => p.realized_pnl, render: (p) => <Num kind="inr" value={p.realized_pnl} signed tone="auto" /> },
    { key: 'realized_pnl_pct', label: 'Realised %', align: 'right', sortable: true, sortValue: (p) => p.realized_pnl_pct, render: (p) => <Num kind="frac" value={p.realized_pnl_pct} signed tone="auto" /> },
    { key: 'strat', label: 'Strategy', render: (p) => (p.matched_strategy ? <StrategyTag strategy={p.matched_strategy} /> : <Badge>Unmatched</Badge>) },
    { key: 'exit', label: 'Exit on', render: () => <span className="ss-faint">—</span> },
  ]

  return (
    <div className="ss-page">
      <PageHead title="Positions" sub={`${open.length} open lots · ${groups.length} symbols · as of ${sessionDate ? fmt.date(sessionDate) : '—'}`}>
        <Button size="sm" icon="sync" loading={evaluateMutation.isPending} onClick={handleReevaluate}>
          Re-evaluate
        </Button>
      </PageHead>

      <Tabs
        ariaLabel="Positions"
        value={tab}
        onChange={changeTab}
        items={[
          { id: 'open', label: 'Open lots', count: open.length },
          { id: 'sym', label: 'By symbol', count: groups.length },
          { id: 'closed', label: 'Closed', count: closed.length },
        ]}
      />

      {tab === 'open' ? (
        open.length === 0 ? (
          <EmptyState title="No open positions">Buys you place at the broker appear here after the next 16:15 IST sync.</EmptyState>
        ) : (
          <>
            <div className="app-filters">
              <Menu
                label="Verdict"
                value={verdictFilter}
                onChange={changeVerdict}
                onClear={() => changeVerdict(null)}
                options={(['EXIT', 'PARTIAL', 'REVIEW', 'HOLD'] as Verdict[]).map((v) => ({ value: v, label: v, count: open.filter((p) => p.last_verdict === v).length }))}
              />
              <Menu
                label="Symbol"
                value={symbolFilter}
                onChange={changeSymbol}
                onClear={() => changeSymbol(null)}
                options={groups.map((g) => ({ value: g.symbol, label: g.symbol, count: g.lots.length }))}
              />
              <span className="ss-spacer" />
              <span className="ss-muted app-small">One row per BUY fill (lot). SELLs close lots oldest-first.</span>
            </div>
            {rows.length ? (
              <DataTable
                ariaLabel="Open positions"
                density={settings.density}
                columns={openColumns}
                rows={rows}
                rowKey={(p) => p.id}
                initialSort={{ key: 'verdict', dir: 'asc' }}
                onRowOpen={(p) => navigate(`/positions/${p.id}`)}
                footer={
                  <>
                    <span>{rows.length} lots</span>
                    <span className="ss-spacer" />
                    <span>
                      Unrealised total <Num kind="inr" value={rows.reduce((s, p) => s + (unrlInr(p) ?? 0), 0)} signed tone="auto" />
                    </span>
                  </>
                }
              />
            ) : (
              <Panel>
                <EmptyState title="No positions match">Clear the filters to see every open lot.</EmptyState>
              </Panel>
            )}
          </>
        )
      ) : null}

      {tab === 'sym' ? (
        groups.length === 0 ? (
          <EmptyState title="No open positions">Buys you place at the broker appear here after the next 16:15 IST sync.</EmptyState>
        ) : (
          <DataTable
            ariaLabel="Positions by symbol"
            columns={symbolColumns}
            rows={groups}
            rowKey={(g) => g.symbol}
            onRowOpen={(g) => {
              if (g.lots.length === 1) navigate(`/positions/${g.lots[0].id}`)
              else {
                changeSymbol(g.symbol)
                changeTab('open')
              }
            }}
          />
        )
      ) : null}

      {tab === 'closed' ? (
        closed.length === 0 ? (
          <EmptyState title="No closed positions">Closed lots appear here once a SELL fill closes them out.</EmptyState>
        ) : (
          <div className="ss-grid-2">
            {/* min-w-0: src/ds's mobile override of .ss-grid-2 (<720px) drops the desktop
                minmax(0, ...) column clamp, so a wide DataTable/Panel grid item reverts to
                content-based auto sizing and blows out the viewport. Neutralised locally
                (layout-only Tailwind utility) rather than editing src/ds — see final report. */}
            <div className="min-w-0">
              <DataTable
                ariaLabel="Closed positions"
                columns={closedColumns}
                rows={closed}
                rowKey={(p) => p.id}
                initialSort={{ key: 'closed_on', dir: 'desc' }}
                footer={
                  <>
                    <span>{closed.length} closed</span>
                    <span className="ss-spacer" />
                    <span>
                      Realised (gross, before brokerage and taxes) <Num kind="inr" value={totalRealized} signed tone="auto" />
                    </span>
                  </>
                }
              />
            </div>
            <div className="min-w-0">
              <Panel title="By matched strategy" right={<span className="ss-muted app-small">computed client-side</span>}>
                <div className="app-strat-grid app-strat-3">
                  {strategyStats.map((g) => (
                    <Fragment key={g.key}>
                      {g.key === 'Unmatched' ? <Badge>Unmatched</Badge> : <StrategyTag strategy={g.key} />}
                      <span className="ss-n ss-muted">
                        {g.win}/{g.n} won
                      </span>
                      <Num kind="inr" value={g.pnl} signed tone="auto" />
                    </Fragment>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )
      ) : null}
    </div>
  )
}
