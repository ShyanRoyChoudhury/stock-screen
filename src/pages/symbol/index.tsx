// Symbol detail (chart page). Handoff §5.3.

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useCandles, useCorporateActions, useIndicators, usePositions, useSignals, useSymbols } from '../../api/hooks'
import type { Signal, Timeframe } from '../../api/types'
import { useSettings } from '../../lib/settings'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { CandleChart } from '../../charts/CandleChart'
import { readChartTokens } from '../../charts/colors'
import { SymbolHeader } from './SymbolHeader'
import { ChartControls } from './ChartControls'
import { SignalsPanel } from './SignalsPanel'
import { ActionsPanel } from './ActionsPanel'
import { readToggleState, writeToggleState } from './storage'
import { buildActionMarkers, buildPositionPriceLines, buildSignalMarkers, buildSignalPriceLines } from './markers'
import { useThemeTick } from './useThemeTick'

function keyOf(s: Signal): string {
  return `${s.symbol}|${s.strategy}|${s.timeframe}|${s.ts}`
}

export default function SymbolPage() {
  const { symbol = '' } = useParams<{ symbol: string }>()
  const [params, setParams] = useSearchParams()
  const { settings } = useSettings()
  useThemeTick() // re-render on theme change so the token-derived colours below stay current

  const allowedTimeframes: Timeframe[] = settings.showIntraday ? ['1d', '4h', '1h'] : ['1d']
  const tfParam = params.get('tf')
  const timeframe: Timeframe =
    (tfParam === '1d' || tfParam === '4h' || tfParam === '1h') && allowedTimeframes.includes(tfParam)
      ? tfParam
      : allowedTimeframes.includes(settings.defaultTimeframe)
        ? settings.defaultTimeframe
        : '1d'

  function setTimeframe(tf: Timeframe) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (tf === settings.defaultTimeframe) next.delete('tf')
        else next.set('tf', tf)
        return next
      },
      { replace: true },
    )
  }

  const [toggles, setToggles] = useState(() => readToggleState())
  useEffect(() => writeToggleState(toggles), [toggles])

  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null)
  useEffect(() => {
    setSelectedSignal(null) // clear a stale selection when navigating to a different symbol/timeframe
  }, [symbol, timeframe])

  const limit = timeframe === '1d' ? 1300 : 5000

  const symbolsQuery = useSymbols()
  const candlesQuery = useCandles(symbol, { timeframe, limit })
  const indicatorsQuery = useIndicators(symbol, { timeframe, limit })
  const signalsQuery = useSignals({ symbol, timeframe, limit: 5000 })
  const actionsQuery = useCorporateActions({ symbol, limit: 500 })
  // Always called (Rules of Hooks); a missing/invalid key 401s and is swallowed below into "not held".
  const positionsQuery = usePositions('open')

  const symbolInfo = useMemo(() => symbolsQuery.data?.find((s) => s.symbol === symbol), [symbolsQuery.data, symbol])

  const heldPosition = useMemo(() => {
    if (!settings.apiKey || !positionsQuery.data) return null
    return positionsQuery.data.find((p) => p.symbol === symbol && p.status === 'open') ?? null
  }, [settings.apiKey, positionsQuery.data, symbol])

  const candles = useMemo(() => candlesQuery.data ?? [], [candlesQuery.data])
  const indicators = useMemo(() => indicatorsQuery.data ?? [], [indicatorsQuery.data])
  const signals = useMemo(() => signalsQuery.data ?? [], [signalsQuery.data])
  const actions = useMemo(() => actionsQuery.data ?? [], [actionsQuery.data])

  // The signals table is otherwise dominated by Confluence rows (it fires on ~23%
  // of bars). Tied to the same "Include Confluence" toggle that controls the chart
  // markers; API order is already newest-first, so filtering preserves it.
  const tableSignals = useMemo(
    () => (toggles.showConfluenceMarkers ? signals : signals.filter((s) => s.strategy !== 'Confluence')),
    [signals, toggles.showConfluenceMarkers],
  )

  const demergers = useMemo(() => actions.filter((a) => a.action_type === 'demerger'), [actions])

  const tokens = readChartTokens()

  const markers = useMemo(() => {
    const signalMarkers = buildSignalMarkers(signals, toggles.showConfluenceMarkers)
    const actionMarkers = timeframe === '1d' ? buildActionMarkers(actions, tokens) : []
    return [...signalMarkers, ...actionMarkers]
    // tokens is re-derived fresh every render (cheap); themeTick above forces that re-render on theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, toggles.showConfluenceMarkers, actions, timeframe])

  const priceLines = useMemo(() => {
    return [...buildSignalPriceLines(selectedSignal, tokens), ...buildPositionPriceLines(heldPosition, heldPosition?.latest_evaluation, tokens)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSignal, heldPosition])

  if (symbolsQuery.isLoading) return <Loading label="Loading symbol…" />
  if (symbolsQuery.isError) return <ErrorState error={symbolsQuery.error} title="Could not load symbols" />
  if (!symbolInfo) {
    return (
      <EmptyState
        title="Unknown symbol"
        message={`"${symbol}" isn't in the active Nifty 500 universe.`}
        action={
          <Link to="/signals" className="text-accent underline">
            Back to Signals
          </Link>
        }
      />
    )
  }

  const lastCandle = candles[candles.length - 1]
  const prevCandle = candles[candles.length - 2]
  const lastIndicator = indicators[indicators.length - 1]

  const chartLoading = candlesQuery.isLoading || indicatorsQuery.isLoading
  const chartError = candlesQuery.error ?? indicatorsQuery.error

  return (
    <div className="flex flex-col gap-3">
      <SymbolHeader symbolInfo={symbolInfo} lastCandle={lastCandle} prevCandle={prevCandle} lastIndicator={lastIndicator} heldPosition={heldPosition} />

      {demergers.map((d) => (
        <div key={d.ex_date} className="rounded border border-warn bg-surface px-3 py-2 text-sm text-warn">
          Demerger ex {d.ex_date}: stored prices are not demerger-adjusted; the chart may show a false cliff.
        </div>
      ))}

      <ChartControls
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        allowedTimeframes={allowedTimeframes}
        overlays={toggles.overlays}
        onOverlaysChange={(overlays) => setToggles((t) => ({ ...t, overlays }))}
        panes={toggles.panes}
        onPanesChange={(panes) => setToggles((t) => ({ ...t, panes }))}
        showConfluenceMarkers={toggles.showConfluenceMarkers}
        onShowConfluenceMarkersChange={(v) => setToggles((t) => ({ ...t, showConfluenceMarkers: v }))}
      />

      {chartLoading ? (
        <div className="flex items-center justify-center rounded border border-border bg-surface" style={{ height: 640 }}>
          <Loading label="Loading chart…" />
        </div>
      ) : chartError ? (
        <ErrorState error={chartError} title="Could not load chart data" />
      ) : candles.length === 0 ? (
        <EmptyState title="No candles" message={`No ${timeframe} candles for ${symbol}.`} />
      ) : (
        <div className="overflow-hidden rounded border border-border bg-surface">
          <CandleChart
            candles={candles}
            indicators={indicators}
            timeframe={timeframe}
            overlays={toggles.overlays}
            panes={toggles.panes}
            markers={markers}
            priceLines={priceLines}
            height={640}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="Signals">
          {signalsQuery.isLoading ? (
            <Loading />
          ) : signalsQuery.isError ? (
            <ErrorState error={signalsQuery.error} />
          ) : (
            <SignalsPanel signals={tableSignals} selectedKey={selectedSignal ? keyOf(selectedSignal) : null} onSelect={setSelectedSignal} />
          )}
        </Panel>
        <Panel title="Corporate actions">
          {actionsQuery.isLoading ? (
            <Loading />
          ) : actionsQuery.isError ? (
            <ErrorState error={actionsQuery.error} />
          ) : (
            <ActionsPanel actions={actions} />
          )}
        </Panel>
      </div>
    </div>
  )
}
