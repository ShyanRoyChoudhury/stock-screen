// Signals (the scanner). Structure per design/prototype/src/app.jsx lines
// 146-210 (Signals), rebuilt on the vendored design system.

import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useFreshSignals, useSymbols } from '../../api/hooks'
import type { Signal, Timeframe } from '../../api/types'
import { useSettings } from '../../lib/settings'
import { istDateKey } from '../../lib/format'
import {
  Badge,
  Banner,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Menu,
  Num,
  PageHead,
  RiskPct,
  StrategyTag,
  Tabs,
  TimeframeBadge,
  fmt,
  type Column,
  type TabItem,
} from '../../ds'
import { readStr } from './details'
import { SignalDetail } from './SignalDetail'
import {
  CONVICTION_OPTIONS,
  EVENT_STRATEGIES,
  FRESH_DAY_OPTIONS,
  MAX_RISK_OPTIONS,
  MIN_RR_OPTIONS,
  parseDays,
  parseNumberOption,
  parseStrategies,
  parseTab,
  parseTimeframe,
} from './url'

function dayKey(ts: string): string {
  return ts.slice(0, 10)
}

/** Always client-side (BUILD_BRIEF: "rr_ratio exists only for some strategies.
 * Compute R:R with fmt.rr for every row"), matching the footer's own claim. */
function rrOf(s: Signal): number | null {
  return fmt.rr(s.entry, s.stop_loss, s.target_1)
}

function convictionExtra(s: Signal): string | null {
  const c = readStr(s.details, 'conviction')
  return c ? c.replace(' ⚡', '⚡') : null
}

export default function SignalsPage() {
  const { settings } = useSettings()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const allowedTimeframes: Timeframe[] = settings.showIntraday ? ['1d', '4h', '1h'] : ['1d']
  const tab = parseTab(params.get('tab'))
  const timeframe = parseTimeframe(params.get('tf'), allowedTimeframes, settings.defaultTimeframe)
  const days = parseDays(params.get('days'))
  const strategies = parseStrategies(params.get('strategies'))
  const industry = params.get('industry')
  const maxRisk = parseNumberOption(params.get('maxRisk'), MAX_RISK_OPTIONS)
  const minRR = parseNumberOption(params.get('minRR'), MIN_RR_OPTIONS)
  const conviction = params.get('conviction')
  const entryMode = params.get('entryMode')

  const [limit, setLimit] = useState(100)

  function patch(next: Record<string, string | null>) {
    setParams(
      (prev) => {
        const merged = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(next)) {
          if (value === null || value === '') merged.delete(key)
          else merged.set(key, value)
        }
        return merged
      },
      { replace: true },
    )
  }

  function resetFilters() {
    patch({ strategies: null, industry: null, maxRisk: null, minRR: null, conviction: null, entryMode: null })
  }

  // /signals/fresh's `days` is a wall-clock window (now - N days), not calendar-date
  // based, so a tight window is often empty until the evening job has produced
  // today's bar. Widen the request by 2 days, then trim client-side to the last
  // `days` distinct IST session dates actually present in the response.
  const freshQuery = useFreshSignals({ days: days + 2, timeframe })
  const symbolsQuery = useSymbols()

  const symbolMap = useMemo(() => {
    const m = new Map(symbolsQuery.data?.map((s) => [s.symbol, s]) ?? [])
    return m
  }, [symbolsQuery.data])

  const industries = useMemo(() => {
    const set = new Set<string>()
    for (const s of symbolsQuery.data ?? []) if (s.industry) set.add(s.industry)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [symbolsQuery.data])

  const allSignals = useMemo(() => freshQuery.data ?? [], [freshQuery.data])

  const sessionDateSet = useMemo(() => {
    const set = new Set<string>()
    for (const s of allSignals) {
      const k = istDateKey(s.ts)
      if (k) set.add(k)
    }
    return new Set(Array.from(set).sort().slice(-days))
  }, [allSignals, days])

  const inWindow = useMemo(
    () => allSignals.filter((s) => {
      const k = istDateKey(s.ts)
      return k !== null && sessionDateSet.has(k)
    }),
    [allSignals, sessionDateSet],
  )

  const nEvent = inWindow.filter((s) => s.strategy !== 'Confluence').length
  const nState = inWindow.length - nEvent

  // Confluence rows badge the same symbol+bar's event rows with "+CONF"; any Confluence
  // signal for that bar was fetched by this same query, so deriving from inWindow (rather
  // than an unbounded all-time signals fetch) is both correct and cheap.
  const confluenceKeys = useMemo(() => {
    const set = new Set<string>()
    for (const s of inWindow) if (s.strategy === 'Confluence') set.add(s.symbol + dayKey(s.ts))
    return set
  }, [inWindow])

  const rows = useMemo(
    () =>
      inWindow
        .filter((s) => (tab === 'state' ? s.strategy === 'Confluence' : s.strategy !== 'Confluence'))
        .filter((s) => !strategies.length || strategies.includes(s.strategy))
        .filter((s) => !industry || symbolMap.get(s.symbol)?.industry === industry)
        .filter((s) => maxRisk == null || (s.risk_pct != null && s.risk_pct <= maxRisk))
        .filter((s) => minRR == null || (rrOf(s) ?? -1) >= minRR)
        .filter((s) => !conviction || (readStr(s.details, 'conviction') ?? '').startsWith(conviction))
        .filter((s) => !entryMode || s.entry_mode === entryMode),
    [inWindow, tab, strategies, industry, maxRisk, minRR, conviction, entryMode, symbolMap],
  )

  const timeframeTabs: TabItem[] = [
    { id: '1d', label: '1d' },
    ...(settings.showIntraday ? [{ id: '4h', label: '4h', experimental: true }, { id: '1h', label: '1h', experimental: true }] : []),
  ]

  const cols: Column<Signal>[] = [
    {
      key: 'symbol',
      label: 'Symbol',
      sortable: true,
      sortValue: (s) => s.symbol,
      render: (s) => (
        <span className="app-row" style={{ gap: 6 }}>
          <button
            type="button"
            className="app-link ss-sym"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/symbols/${s.symbol}?sig=${s.strategy}@${dayKey(s.ts)}`)
            }}
          >
            {s.symbol}
          </button>
          {s.strategy !== 'Confluence' && confluenceKeys.has(s.symbol + dayKey(s.ts)) ? (
            <Badge title="A Confluence state holds on the same bar">+CONF</Badge>
          ) : null}
        </span>
      ),
    },
    { key: 'name', label: 'Name', render: (s) => <span className="ss-muted app-trunc">{symbolMap.get(s.symbol)?.name}</span> },
    {
      key: 'industry',
      label: 'Industry',
      sortable: true,
      sortValue: (s) => symbolMap.get(s.symbol)?.industry ?? '',
      render: (s) => <span className="ss-muted app-trunc app-trunc-s">{symbolMap.get(s.symbol)?.industry}</span>,
    },
    {
      key: 'strategy',
      label: 'Strategy',
      sortable: true,
      sortValue: (s) => s.strategy,
      render: (s) => <StrategyTag strategy={s.strategy} extra={s.entry_mode || convictionExtra(s)} />,
    },
    { key: 'tf', label: 'TF', render: (s) => <TimeframeBadge timeframe={s.timeframe} /> },
    { key: 'ts', label: 'Signal date', sortable: true, sortValue: (s) => s.ts, render: (s) => <span className="ss-n">{fmt.date(s.ts)}</span> },
    { key: 'entry', label: 'Entry ₹', align: 'right', sortable: true, sortValue: (s) => s.entry, render: (s) => <Num value={s.entry} /> },
    { key: 'stop_loss', label: 'Stop', align: 'right', render: (s) => <Num value={s.stop_loss} /> },
    { key: 'risk_pct', label: 'Risk %', align: 'right', sortable: true, sortValue: (s) => s.risk_pct ?? -Infinity, render: (s) => <RiskPct value={s.risk_pct} /> },
    { key: 'target_1', label: 'T1', align: 'right', render: (s) => <Num value={s.target_1} /> },
    { key: 'target_2', label: 'T2', align: 'right', render: (s) => <Num value={s.target_2} /> },
    {
      key: 'rr',
      label: 'R:R',
      align: 'right',
      sortable: true,
      sortValue: (s) => rrOf(s) ?? -Infinity,
      title: '(T1 − entry) / (entry − stop), computed client-side',
      render: (s) => {
        const v = rrOf(s)
        return <Num kind="rr" value={v} className={v != null && v < 1 ? 'ss-muted' : ''} />
      },
    },
  ]

  return (
    <div className="ss-page">
      <PageHead title="Signals" sub={`${rows.length} setups · last ${days} session${days > 1 ? 's' : ''} · ${timeframe}`}>
        <Tabs variant="segmented" ariaLabel="Timeframe" value={timeframe} onChange={(tf) => patch({ tf: tf === '1d' ? null : tf })} items={timeframeTabs} />
      </PageHead>

      <Tabs
        value={tab}
        onChange={(t) => patch({ tab: t === 'event' ? null : t })}
        ariaLabel="Signal type"
        items={[
          { id: 'event', label: 'Event signals', count: nEvent },
          { id: 'state', label: 'Confluence', count: nState, title: 'A state, not an event: fires on ~23% of daily bars' },
        ]}
      />

      <div className="app-filters">
        <Menu label="Fresh" value={days} onChange={(d) => patch({ days: d === 3 ? null : String(d) })} options={FRESH_DAY_OPTIONS.map((d) => ({ value: d, label: `≤ ${d} session${d > 1 ? 's' : ''}` }))} />
        {tab === 'event' ? (
          <Menu
            label="Strategy"
            multi
            value={strategies}
            onChange={(next) => patch({ strategies: next.length ? next.join(',') : null })}
            onClear={() => patch({ strategies: null })}
            options={EVENT_STRATEGIES.map((k) => ({ value: k, label: k, count: inWindow.filter((s) => s.strategy === k).length }))}
          />
        ) : null}
        <Menu label="Industry" value={industry} onChange={(v) => patch({ industry: v })} onClear={() => patch({ industry: null })} options={industries.map((i) => ({ value: i, label: i }))} />
        <Menu label="Max risk" value={maxRisk} onChange={(v) => patch({ maxRisk: String(v) })} onClear={() => patch({ maxRisk: null })} options={MAX_RISK_OPTIONS.map((v) => ({ value: v, label: `≤ ${v}%` }))} />
        <Menu label="Min R:R" value={minRR} onChange={(v) => patch({ minRR: String(v) })} onClear={() => patch({ minRR: null })} options={MIN_RR_OPTIONS.map((v) => ({ value: v, label: `≥ ${v.toFixed(1)}` }))} />
        {tab === 'state' ? (
          <Menu label="Conviction" value={conviction} onChange={(v) => patch({ conviction: v })} onClear={() => patch({ conviction: null })} options={CONVICTION_OPTIONS.map((v) => ({ value: v, label: v }))} />
        ) : null}
        {tab === 'event' && (!strategies.length || strategies.includes('PIPELINE')) ? (
          <Menu
            label="Entry mode"
            value={entryMode}
            onChange={(v) => patch({ entryMode: v })}
            onClear={() => patch({ entryMode: null })}
            options={[
              { value: 'IMMEDIATE', label: 'IMMEDIATE' },
              { value: 'RETEST', label: 'RETEST' },
            ]}
          />
        ) : null}
        <span className="ss-spacer" />
        <Button size="sm" variant="ghost" onClick={resetFilters}>
          Reset filters
        </Button>
      </div>

      {timeframe !== '1d' ? (
        <Banner tone="review" title={`${timeframe} is experimental`}>
          The Yahoo hourly feed doesn’t reconcile with daily bars and ~13% of hourly bars have zero volume. Don’t trade these off this feed.
        </Banner>
      ) : null}

      {freshQuery.isLoading || symbolsQuery.isLoading ? (
        <Loading label="Loading signals…" />
      ) : freshQuery.isError ? (
        <ErrorState error={freshQuery.error} title="Could not load signals" />
      ) : rows.length === 0 ? (
        <EmptyState title="No signals match">Try widening the freshness window or clearing filters.</EmptyState>
      ) : (
        <DataTable
          key={tab + timeframe}
          ariaLabel="Signals"
          density={settings.density}
          columns={cols}
          rows={rows.slice(0, limit)}
          rowKey={(s) => `${s.symbol}|${s.strategy}|${s.ts}`}
          initialSort={{ key: 'ts', dir: 'desc' }}
          rowClassName={(s) => (s.strategy === 'Confluence' && tab !== 'state' ? 'ss-dim' : undefined)}
          renderExpanded={(s) => <SignalDetail signal={s} symbolName={symbolMap.get(s.symbol)?.name ?? undefined} />}
          footer={
            <>
              <span>
                {Math.min(limit, rows.length)} of {rows.length} shown
              </span>
              {rows.length > limit ? (
                <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 200)}>
                  Show 200 more
                </Button>
              ) : null}
              <span className="ss-spacer" />
              <span className="app-hide-sm">R:R computed client-side · ↑↓ / j k move · ↵ expand</span>
            </>
          }
        />
      )}
    </div>
  )
}
