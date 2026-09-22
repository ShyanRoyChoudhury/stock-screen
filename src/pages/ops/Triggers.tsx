// app.jsx 578-586: one row of trigger buttons plus a shared options toolbar. KEEPS the current
// implementation's depth — mode/timeframes/strategies/symbols/dates — but consolidates what used
// to be six separate per-trigger forms into one shared row of controls under the buttons, matching
// the prototype's single "Triggers" panel. Only one run can be active at a time (the backend 409s);
// every button disables while `live` (the live-polled running run, if any) is set.

import { useState } from 'react'
import {
  ApiKeyPrompt,
  Button,
  labels,
  Panel,
  StatusDot,
  Toggle,
} from '../../ds'
import { useEvaluatePositions, useLoadCorporateActions, useRefreshSymbols, useRun, useRuns, useStartIndicators, useStartIngest, useStartSignals } from '../../api/hooks'
import { useSettings } from '../../lib/settings'
import { useToast } from '../../lib/toast'
import type { Strategy, Timeframe } from '../../api/types'
import { describeError, summarizeResult } from './utils'

const ALL_TIMEFRAMES: Timeframe[] = ['1d', '4h', '1h']
const ALL_STRATEGIES = Object.keys(labels.strategies) as Strategy[]

function toggleIn<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function Triggers() {
  const toast = useToast()
  const { settings } = useSettings()

  const { data: runsData } = useRuns(20)
  const runs = runsData ?? []
  const runningId = runs.find((r) => r.status === 'running')?.id
  const { data: liveRunning } = useRun(runningId, { poll: true })
  const live = liveRunning ?? runs.find((r) => r.status === 'running')

  const [timeframes, setTimeframes] = useState<Set<Timeframe>>(new Set(ALL_TIMEFRAMES))
  const [strategies, setStrategies] = useState<Set<Strategy>>(new Set())
  const [symbolsText, setSymbolsText] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [asOf, setAsOf] = useState('')

  const startIngest = useStartIngest()
  const startIndicators = useStartIndicators()
  const startSignals = useStartSignals()
  const loadActions = useLoadCorporateActions()
  const refreshUniverse = useRefreshSymbols()
  const evaluate = useEvaluatePositions()

  const symbols = (): string[] | undefined => {
    const list = symbolsText
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    return list.length ? list : undefined
  }
  const tfArray = () => Array.from(timeframes)
  const stratArray = () => (strategies.size ? Array.from(strategies) : undefined)

  function onError(err: unknown) {
    toast(describeError(err))
  }

  function runIngest(mode: 'incremental' | 'backfill') {
    startIngest.mutate(
      { mode, timeframes: tfArray(), symbols: symbols() },
      { onSuccess: (run) => toast(`202 · Run #${run.id} ${run.mode} started`), onError },
    )
  }
  function runIndicators() {
    startIndicators.mutate(
      { timeframes: tfArray(), symbols: symbols() },
      { onSuccess: (run) => toast(`202 · Run #${run.id} ${run.mode} started`), onError },
    )
  }
  function runSignals() {
    startSignals.mutate(
      { timeframes: tfArray(), symbols: symbols(), strategies: stratArray() },
      { onSuccess: (run) => toast(`202 · Run #${run.id} ${run.mode} started`), onError },
    )
  }
  function runCorporateActions() {
    loadActions.mutate(
      { from_date: fromDate || undefined, to_date: toDate || undefined, symbols: symbols() },
      { onSuccess: (data) => toast(`Corporate actions loaded — ${summarizeResult(data)}`), onError },
    )
  }
  function runRefreshUniverse() {
    if (!window.confirm('Refresh the Nifty 500 universe from NSE?')) return
    refreshUniverse.mutate(undefined, {
      onSuccess: (data) => toast(`Universe refreshed — ${summarizeResult(data)}`),
      onError,
    })
  }
  function runEvaluate() {
    evaluate.mutate(
      { as_of: asOf || undefined },
      {
        onSuccess: (data) => toast(`Evaluated ${data.evaluated} position${data.evaluated === 1 ? '' : 's'} as of ${data.as_of}`),
        onError,
      },
    )
  }

  const locked = !!live
  const busyTitle = live ? `A run is active: ${live.mode} #${live.id}` : undefined
  const tfEmpty = timeframes.size === 0
  const evaluateNeedsKey = !settings.apiKey
  const progressPct = live && live.symbols_total > 0 ? Math.min(100, (live.symbols_ok / live.symbols_total) * 100) : 0

  return (
    <Panel
      title="Triggers"
      right={
        live ? (
          <StatusDot status="running">{`Run #${live.id} ${live.mode} · ${live.symbols_ok}/${live.symbols_total}`}</StatusDot>
        ) : (
          <span className="ss-muted app-small">One run at a time — others return 409</span>
        )
      }
    >
      <div className="app-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <Button size="sm" disabled={locked || tfEmpty || startIngest.isPending} title={busyTitle} onClick={() => runIngest('incremental')}>
          Ingest · incremental
        </Button>
        <Button size="sm" disabled={locked || tfEmpty || startIngest.isPending} title={busyTitle} onClick={() => runIngest('backfill')}>
          Ingest · backfill
        </Button>
        <Button size="sm" disabled={locked || tfEmpty || startIndicators.isPending} title={busyTitle} onClick={runIndicators}>
          Compute indicators
        </Button>
        <Button size="sm" disabled={locked || tfEmpty || startSignals.isPending} title={busyTitle} onClick={runSignals}>
          Generate signals
        </Button>
        <Button size="sm" disabled={locked || loadActions.isPending} title={busyTitle} onClick={runCorporateActions}>
          Load corporate actions
        </Button>
        <Button size="sm" disabled={locked || refreshUniverse.isPending} title={busyTitle} onClick={runRefreshUniverse}>
          Refresh universe
        </Button>
        <Button size="sm" disabled={locked || evaluateNeedsKey || evaluate.isPending} title={busyTitle} onClick={runEvaluate}>
          Evaluate positions
        </Button>
      </div>

      <div className="app-toolbar" style={{ marginTop: 8 }}>
        {ALL_TIMEFRAMES.map((tf) => (
          <Toggle key={tf} on={timeframes.has(tf)} onClick={() => setTimeframes((prev) => toggleIn(prev, tf))}>
            {tf}
          </Toggle>
        ))}
        {ALL_STRATEGIES.map((s) => (
          <Toggle key={s} on={strategies.has(s)} onClick={() => setStrategies((prev) => toggleIn(prev, s))}>
            {s}
          </Toggle>
        ))}
        <input
          className="ss-input ss-input-mono"
          style={{ width: 200 }}
          aria-label="Symbols"
          placeholder="RELIANCE,TCS (optional)"
          value={symbolsText}
          onChange={(e) => setSymbolsText(e.target.value)}
        />
        <span className="ss-muted app-small" title="Corporate actions load range">actions</span>
        <input
          type="date"
          className="ss-input"
          style={{ width: 148 }}
          aria-label="Corporate actions from date"
          title="Corporate actions: from date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <span className="ss-muted app-small">to</span>
        <input
          type="date"
          className="ss-input"
          style={{ width: 148 }}
          aria-label="Corporate actions to date"
          title="Corporate actions: to date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
        <span className="ss-muted app-small" title="Evaluate positions as of this date">
          as of
        </span>
        <input
          type="date"
          className="ss-input"
          style={{ width: 148 }}
          aria-label="Evaluate as-of date"
          title="Evaluate positions: as-of date (optional, defaults to the last trading day)"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </div>

      {evaluateNeedsKey ? (
        <div style={{ marginTop: 8 }}>
          <ApiKeyPrompt message="Evaluating positions needs an API key." />
        </div>
      ) : null}

      {live ? (
        <div className="app-progress" aria-label="Run progress">
          <span style={{ width: `${progressPct}%` }} />
        </div>
      ) : null}

      <p className="ss-muted app-small" style={{ margin: '8px 0 0' }}>
        Full-universe timings: backfill ≈ 20 min, indicators ≈ 16 min, signals ≈ 7 min.
      </p>
    </Panel>
  )
}
