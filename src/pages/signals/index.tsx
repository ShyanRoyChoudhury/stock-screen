// Signals (the scanner). Handoff §5.2.

import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useFreshSignals, useSymbols } from '../../api/hooks'
import type { Signal, Symbol as SymbolRow, Timeframe } from '../../api/types'
import { STRATEGY_BY_KEY, industriesFrom } from '../../lib/domain'
import { useSettings } from '../../lib/settings'
import { fmtIstDate, fmtIstDateTime, fmtNum, fmtPct, rr } from '../../lib/format'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { Chip } from '../../components/Chip'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from './FilterBar'
import { SummaryStrip } from './SummaryStrip'
import { SignalDetails } from './SignalDetails'
import { detailsSummary, readStr } from './details'
import { parseDays, parseMode, parseStrategies, parseTimeframe, serializeStrategies, strategiesForMode, type SignalMode } from './url'

function num(n: string): number | null {
  if (n === '') return null
  const v = Number(n)
  return Number.isFinite(v) ? v : null
}

export default function SignalsPage() {
  const { settings } = useSettings()
  const [params, setParams] = useSearchParams()

  const allowedTimeframes: Timeframe[] = settings.showIntraday ? ['1d', '4h', '1h'] : ['1d']

  const mode = parseMode(params.get('mode'))
  const timeframe = parseTimeframe(params.get('tf'), allowedTimeframes, settings.defaultTimeframe)
  const days = parseDays(params.get('days'))
  const modeStrategies = strategiesForMode(mode)
  const selectedStrategies = parseStrategies(params.get('strategies'), modeStrategies)
  const industry = params.get('industry') ?? ''
  const maxRisk = params.get('maxRisk') ?? ''
  const minRR = params.get('minRR') ?? ''
  const conviction = params.get('conviction') ?? ''
  const entryMode = params.get('entryMode') ?? ''
  const q = params.get('q') ?? ''

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

  const freshQuery = useFreshSignals({ days, timeframe })
  const symbolsQuery = useSymbols()

  const symbolMap = useMemo(() => {
    const m = new Map<string, SymbolRow>()
    for (const s of symbolsQuery.data ?? []) m.set(s.symbol, s)
    return m
  }, [symbolsQuery.data])

  const industries = useMemo(() => industriesFrom(symbolsQuery.data ?? []), [symbolsQuery.data])

  const allSignals = useMemo(() => freshQuery.data ?? [], [freshQuery.data])

  // Confluence fires on ~23% of bars; used to badge "confirms" on Event-mode rows
  // for the same symbol+bar, without letting Confluence itself dominate the table.
  const confluenceKeys = useMemo(() => {
    const set = new Set<string>()
    for (const s of allSignals) if (s.strategy === 'Confluence') set.add(`${s.symbol}|${s.ts}`)
    return set
  }, [allSignals])

  const filtered = useMemo(() => {
    const maxRiskNum = num(maxRisk)
    const minRRNum = num(minRR)
    const qLower = q.trim().toLowerCase()
    const selectedSet = new Set(selectedStrategies)
    return allSignals.filter((s) => {
      if (!selectedSet.has(s.strategy)) return false
      if (industry) {
        const sym = symbolMap.get(s.symbol)
        if ((sym?.industry ?? '') !== industry) return false
      }
      if (maxRiskNum !== null && s.risk_pct !== null && s.risk_pct > maxRiskNum) return false
      if (minRRNum !== null) {
        const rrVal = s.rr_ratio ?? rr(s.entry, s.stop_loss, s.target_1)
        if (rrVal === null || rrVal < minRRNum) return false
      }
      if (conviction && s.strategy === 'Confluence') {
        const c = readStr(s.details, 'conviction') ?? ''
        if (!c.startsWith(conviction)) return false
      }
      if (entryMode && s.strategy === 'PIPELINE') {
        if (s.entry_mode !== entryMode) return false
      }
      if (qLower) {
        const sym = symbolMap.get(s.symbol)
        const haystack = `${s.symbol} ${sym?.name ?? ''}`.toLowerCase()
        if (!haystack.includes(qLower)) return false
      }
      return true
    })
  }, [allSignals, selectedStrategies, industry, maxRisk, minRR, conviction, entryMode, q, symbolMap])

  const columns: DataTableColumn<Signal>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      sortValue: (s) => s.symbol,
      render: (s) => (
        <Link to={`/symbols/${s.symbol}?tf=${s.timeframe}`} className="font-medium text-accent hover:underline">
          {s.symbol}
        </Link>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      sortValue: (s) => symbolMap.get(s.symbol)?.name ?? '',
      render: (s) => symbolMap.get(s.symbol)?.name ?? '—',
    },
    {
      key: 'industry',
      header: 'Industry',
      sortValue: (s) => symbolMap.get(s.symbol)?.industry ?? '',
      render: (s) => symbolMap.get(s.symbol)?.industry ?? '—',
    },
    {
      key: 'strategy',
      header: 'Strategy',
      sortValue: (s) => STRATEGY_BY_KEY[s.strategy].label,
      render: (s) => (
        <span className="inline-flex items-center gap-1">
          <Chip variant="strategy" value={s.strategy} />
          {mode === 'event' && confluenceKeys.has(`${s.symbol}|${s.ts}`) && (
            <Chip variant="neutral" title="A Confluence signal also fired for this symbol on this bar">
              confirms
            </Chip>
          )}
        </span>
      ),
    },
    { key: 'tf', header: 'TF', align: 'center', sortValue: (s) => s.timeframe, render: (s) => s.timeframe.toUpperCase() },
    {
      key: 'date',
      header: 'Date',
      align: 'right',
      sortValue: (s) => s.ts,
      render: (s) => <span className="num">{s.timeframe === '1d' ? fmtIstDate(s.ts) : fmtIstDateTime(s.ts)}</span>,
    },
    { key: 'entry', header: 'Entry', align: 'right', sortValue: (s) => s.entry, render: (s) => <span className="num">{fmtNum(s.entry)}</span> },
    { key: 'stop', header: 'Stop', align: 'right', sortValue: (s) => s.stop_loss, render: (s) => <span className="num">{fmtNum(s.stop_loss)}</span> },
    {
      key: 'risk',
      header: 'Risk %',
      align: 'right',
      sortValue: (s) => s.risk_pct ?? -Infinity,
      render: (s) => {
        const cls = s.risk_pct !== null && s.risk_pct > 12 ? 'text-exit' : s.risk_pct !== null && s.risk_pct > 8 ? 'text-warn' : ''
        return <span className={`num ${cls}`}>{fmtPct(s.risk_pct)}</span>
      },
    },
    { key: 't1', header: 'T1', align: 'right', sortValue: (s) => s.target_1, render: (s) => <span className="num">{fmtNum(s.target_1)}</span> },
    { key: 't2', header: 'T2', align: 'right', sortValue: (s) => s.target_2, render: (s) => <span className="num">{fmtNum(s.target_2)}</span> },
    {
      key: 'rr',
      header: 'R:R',
      align: 'right',
      sortValue: (s) => s.rr_ratio ?? rr(s.entry, s.stop_loss, s.target_1) ?? -Infinity,
      render: (s) => {
        const v = s.rr_ratio ?? rr(s.entry, s.stop_loss, s.target_1)
        return <span className="num">{v === null ? '—' : v.toFixed(2)}</span>
      },
    },
    { key: 'details', header: 'Details', sortValue: (s) => detailsSummary(s), render: (s) => detailsSummary(s) },
  ]

  const emptyReason = 'No signals match. Try widening the freshness window or clearing filters.'

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold">Signals</h1>
        <p className="text-sm text-muted">Browse and shortlist setups from the scanner.</p>
      </div>

      <FilterBar
        mode={mode}
        onModeChange={(m: SignalMode) => patch({ mode: m === 'event' ? null : m, strategies: null })}
        timeframe={timeframe}
        onTimeframeChange={(tf) => patch({ tf: tf === settings.defaultTimeframe ? null : tf })}
        allowedTimeframes={allowedTimeframes}
        days={days}
        onDaysChange={(d) => patch({ days: d === 3 ? null : String(d) })}
        modeStrategies={modeStrategies}
        selectedStrategies={selectedStrategies}
        onToggleStrategy={(strategy) => {
          const set = new Set(selectedStrategies)
          if (set.has(strategy)) set.delete(strategy)
          else set.add(strategy)
          const next = modeStrategies.filter((s) => set.has(s))
          patch({ strategies: serializeStrategies(next.length ? next : modeStrategies, modeStrategies) })
        }}
        industry={industry}
        onIndustryChange={(v) => patch({ industry: v || null })}
        industries={industries}
        maxRisk={maxRisk}
        onMaxRiskChange={(v) => patch({ maxRisk: v || null })}
        minRR={minRR}
        onMinRRChange={(v) => patch({ minRR: v || null })}
        conviction={conviction}
        onConvictionChange={(v) => patch({ conviction: v || null })}
        entryMode={entryMode}
        onEntryModeChange={(v) => patch({ entryMode: v || null })}
        q={q}
        onQChange={(v) => patch({ q: v || null })}
      />

      {freshQuery.isLoading || symbolsQuery.isLoading ? (
        <Loading label="Loading signals…" />
      ) : freshQuery.isError ? (
        <ErrorState error={freshQuery.error} title="Could not load signals" />
      ) : (
        <>
          <SummaryStrip signals={filtered} strategies={modeStrategies} />
          {filtered.length === 0 ? (
            <EmptyState title="No signals match" message={emptyReason} />
          ) : (
            <DataTable
              columns={columns}
              rows={filtered}
              rowKey={(s) => `${s.symbol}|${s.strategy}|${s.timeframe}|${s.ts}`}
              expandable={(s) => <SignalDetails signal={s} />}
              pageSize={100}
            />
          )}
        </>
      )}
    </div>
  )
}
