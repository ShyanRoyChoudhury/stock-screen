// Symbol detail (chart page). Structure per design/prototype/src/app.jsx
// lines 231-312 (SymbolPage, SnapItem, posLevels), rebuilt on the vendored
// design system and the new CandleChart contract (src/charts/CandleChart.tsx).

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useCandles, useCorporateActions, useIndicators, usePositions, useSignals, useSymbols } from '../../api/hooks'
import type { Position, Signal, Timeframe } from '../../api/types'
import { useSettings } from '../../lib/settings'
import {
  Badge,
  Banner,
  Button,
  Change,
  CorpActionMarker,
  cx,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Num,
  Panel,
  RiskPct,
  StrategyTag,
  Tabs,
  Toggle,
  VerdictChip,
  fmt,
  type Column,
  type TabItem,
} from '../../ds'
import { CandleChart, type ChartLevel } from '../../charts/CandleChart'
import { readToggleState, writeToggleState } from './storage'

/** IST-safe-enough calendar-date key for a UTC ISO ts (see BUILD_BRIEF: daily bars sit
 * at 03:45Z = 09:15 IST, well clear of the UTC day boundary). Used for the `?sig=` link. */
function dayKey(ts: string): string {
  return ts.slice(0, 10)
}

function sigKey(s: Signal): string {
  return `${s.strategy}@${dayKey(s.ts)}`
}

/** Levels for a single open, evaluated lot: app.jsx 307-312. */
function posLevels(p: Position): ChartLevel[] {
  const e = p.latest_evaluation
  if (!e) return []
  const out: ChartLevel[] = [{ kind: 'entry', value: p.avg_entry_price, label: 'Entry' }]
  if (!p.is_unmatched) {
    if (e.stop_level != null) out.push({ kind: 'stop', value: e.stop_level, label: 'SL' })
    if (e.target_1 != null) out.push({ kind: 't1', value: e.target_1, label: 'T1' })
    if (e.target_2 != null) out.push({ kind: 't2', value: e.target_2, label: 'T2' })
    if (e.trail_level != null && e.stop_level != null && e.trail_level > e.stop_level) {
      out.push({ kind: 'trail', value: e.trail_level, label: 'Trail' })
    }
  } else if (e.trail_level != null) {
    out.push({ kind: 'trail', value: e.trail_level, label: 'Trail=SL' })
  }
  return out
}

function SnapItem({ k, v, sub, tone }: { k: string; v: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="app-snap-i">
      <span className="ss-label">{k}</span>
      <span className={cx('ss-n', tone && 'ss-' + tone)}>{v}</span>
      {sub ? <span className="ss-n ss-faint app-small">{sub}</span> : null}
    </div>
  )
}

export default function SymbolPage() {
  const { symbol = '' } = useParams<{ symbol: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { settings } = useSettings()

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
        if (tf === '1d') next.delete('tf')
        else next.set('tf', tf)
        return next
      },
      { replace: true },
    )
  }

  // Selected signal key ("STRATEGY@YYYY-MM-DD"), seeded from `?sig=` on load and
  // whenever the symbol/timeframe changes (a fresh navigation), then owned locally
  // (clicking the chart / table / "Clear levels" doesn't write back to the URL).
  const [selKey, setSelKey] = useState<string | null>(params.get('sig'))
  useEffect(() => {
    setSelKey(params.get('sig'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe])

  const [toggles, setToggles] = useState(() => readToggleState())
  useEffect(() => writeToggleState(toggles), [toggles])

  const limit = timeframe === '1d' ? 1300 : 5000

  const symbolsQuery = useSymbols()
  const candlesQuery = useCandles(symbol, { timeframe, limit })
  const indicatorsQuery = useIndicators(symbol, { timeframe, limit })
  const signalsQuery = useSignals({ symbol, timeframe, limit: 5000 })
  const actionsQuery = useCorporateActions({ symbol, limit: 500 })
  // All statuses (open + closed), for the "Your lots" panel and fill markers; a
  // missing/invalid key 401s and is swallowed below into "not held".
  const positionsQuery = usePositions(undefined, { enabled: !!settings.apiKey })

  const meta = useMemo(() => symbolsQuery.data?.find((s) => s.symbol === symbol), [symbolsQuery.data, symbol])
  const candles = useMemo(() => candlesQuery.data ?? [], [candlesQuery.data])
  const indicators = useMemo(() => indicatorsQuery.data ?? [], [indicatorsQuery.data])
  const sigs = useMemo(() => signalsQuery.data ?? [], [signalsQuery.data])
  const actions = useMemo(() => actionsQuery.data ?? [], [actionsQuery.data])
  const positionsForSymbol = useMemo(
    () => (settings.apiKey ? (positionsQuery.data ?? []).filter((p) => p.symbol === symbol) : []),
    [settings.apiKey, positionsQuery.data, symbol],
  )

  const selSig = useMemo(() => sigs.find((s) => sigKey(s) === selKey) ?? null, [sigs, selKey])

  if (symbolsQuery.isLoading) return <Loading label="Loading symbol…" />
  if (symbolsQuery.isError) return <ErrorState error={symbolsQuery.error} title="Could not load symbols" />
  if (!meta) {
    return (
      <div className="ss-page">
        <EmptyState title={`${symbol} is not in the universe`}>Only Nifty 500 symbols are screened.</EmptyState>
      </div>
    )
  }

  const last = candles[candles.length - 1]
  const prev = candles[candles.length - 2]
  const x = indicators[indicators.length - 1]
  const openLots = positionsForSymbol.filter((p) => p.status === 'open')
  const demergers = actions.filter((a) => a.action_type === 'demerger')
  const singleOpenLotWithEval = openLots.length === 1 && openLots[0].latest_evaluation ? openLots[0] : null
  const levels: ChartLevel[] | undefined = selSig ? undefined : singleOpenLotWithEval ? posLevels(singleOpenLotWithEval) : undefined

  // rows = event signals (or the selected Confluence row) + at most 12 other
  // Confluence rows, dimmed. Plain computation (not useMemo): both early returns
  // above happen before any hook in this component, so nothing here may call one.
  const tableRows: Signal[] = [
    ...sigs.filter((s) => s.strategy !== 'Confluence' || s === selSig),
    ...sigs.filter((s) => s.strategy === 'Confluence' && s !== selSig).slice(0, 12),
  ]

  const signalCols: Column<Signal>[] = [
    { key: 'ts', label: 'Date', render: (s) => <span className="ss-n">{fmt.date(s.ts)}</span> },
    { key: 'strategy', label: 'Strategy', render: (s) => <StrategyTag strategy={s.strategy} extra={s.entry_mode} /> },
    { key: 'entry', label: 'Entry', align: 'right', render: (s) => <Num value={s.entry} /> },
    { key: 'stop', label: 'Stop', align: 'right', render: (s) => <Num value={s.stop_loss} /> },
    { key: 'risk', label: 'Risk', align: 'right', render: (s) => <RiskPct value={s.risk_pct} /> },
    { key: 'rr', label: 'R:R', align: 'right', render: (s) => <Num kind="rr" value={s.rr_ratio ?? fmt.rr(s.entry, s.stop_loss, s.target_1)} /> },
  ]

  const chartLoading = candlesQuery.isLoading || indicatorsQuery.isLoading
  const chartError = candlesQuery.error ?? indicatorsQuery.error

  const timeframeTabs: TabItem[] = [
    { id: '1d', label: '1d' },
    ...(settings.showIntraday ? [{ id: '4h', label: '4h', experimental: true }, { id: '1h', label: '1h', experimental: true }] : []),
  ]

  return (
    <div className="ss-page">
      <div className="app-symhead">
        <div>
          <div className="app-row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h1 className="ss-page-title app-mono">{symbol}</h1>
            <span className="ss-muted">{meta.name}</span>
          </div>
          <div className="app-row ss-muted app-small" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span>{meta.industry}</span>
            <span className="ss-n">{meta.isin}</span>
            {settings.apiKey && openLots.length ? (
              <Link className="app-link" to={`/positions?symbol=${symbol}`}>
                Held · {openLots.length} lot{openLots.length > 1 ? 's' : ''}
              </Link>
            ) : null}
          </div>
        </div>
        {last ? (
          <div className="app-symprice">
            <span className="ss-label">Close {fmt.date(last.ts)}</span>
            <span className="app-row" style={{ gap: 10, alignItems: 'baseline' }}>
              <span className="ss-n app-num-lg">
                <span className="ss-muted">₹</span>
                {fmt.price(last.close)}
              </span>
              {prev ? <Change abs={last.close - prev.close} frac={last.close / prev.close - 1} /> : null}
            </span>
          </div>
        ) : null}
        {x && last ? (
          <div className="app-snap">
            <SnapItem
              k="vs EMA50"
              v={x.ema_50 == null ? '—' : last.close > x.ema_50 ? 'Above' : 'Below'}
              tone={x.ema_50 == null ? undefined : last.close > x.ema_50 ? 'up' : 'down'}
              sub={x.ema_50 != null ? fmt.price(x.ema_50) : undefined}
            />
            <SnapItem
              k="vs EMA200"
              v={x.ema_200 == null ? '—' : last.close > x.ema_200 ? 'Above' : 'Below'}
              tone={x.ema_200 == null ? undefined : last.close > x.ema_200 ? 'up' : 'down'}
              sub={x.ema_200 != null ? fmt.price(x.ema_200) : undefined}
            />
            <SnapItem
              k="Supertrend"
              v={x.supertrend_dir === 1 ? '▲ Bull' : '▼ Bear'}
              tone={x.supertrend_dir === 1 ? 'up' : 'down'}
              sub={fmt.price(x.supertrend_10_3)}
            />
            <SnapItem k="ADX 14" v={x.adx_14 == null ? '—' : fmt.price(x.adx_14, 1)} sub={x.adx_14 != null ? (x.adx_14 > 25 ? 'trending' : 'weak') : undefined} />
            <SnapItem k="RVOL 20" v={x.rvol_20 == null ? '—' : fmt.mult(x.rvol_20)} sub={'vol ' + fmt.qty(last.volume)} />
          </div>
        ) : null}
      </div>

      {demergers.map((d) => (
        <Banner key={d.ex_date} tone="review" title={`Demerger ex ${fmt.date(d.ex_date)} — price history is not demerger-adjusted`}>
          The drop at the marker is a false cliff. Treat indicators and signals spanning it as suspect.
        </Banner>
      ))}

      <div className="app-toolbar">
        <Tabs
          variant="segmented"
          ariaLabel="Timeframe"
          value={timeframe}
          onChange={(tf) => setTimeframe(tf as Timeframe)}
          items={timeframeTabs}
        />
        <span className="app-sep" />
        <Toggle on={toggles.overlays.ema50} color="ema-50" onClick={() => setToggles((t) => ({ ...t, overlays: { ...t.overlays, ema50: !t.overlays.ema50 } }))}>
          EMA 50
        </Toggle>
        <Toggle on={toggles.overlays.ema200} color="ema-200" onClick={() => setToggles((t) => ({ ...t, overlays: { ...t.overlays, ema200: !t.overlays.ema200 } }))}>
          EMA 200
        </Toggle>
        <Toggle on={toggles.overlays.supertrend} color="up" onClick={() => setToggles((t) => ({ ...t, overlays: { ...t.overlays, supertrend: !t.overlays.supertrend } }))}>
          Supertrend
        </Toggle>
        <Toggle on={toggles.overlays.bollinger} color="bb-band" onClick={() => setToggles((t) => ({ ...t, overlays: { ...t.overlays, bollinger: !t.overlays.bollinger } }))}>
          Bollinger
        </Toggle>
        <Toggle on={toggles.overlays.keltner} color="kc-band" onClick={() => setToggles((t) => ({ ...t, overlays: { ...t.overlays, keltner: !t.overlays.keltner } }))}>
          Keltner
        </Toggle>
        <span className="app-sep" />
        <Toggle on={toggles.panes.macd} onClick={() => setToggles((t) => ({ ...t, panes: { ...t.panes, macd: !t.panes.macd } }))}>
          MACD pane
        </Toggle>
        <Toggle on={toggles.panes.adx} onClick={() => setToggles((t) => ({ ...t, panes: { ...t.panes, adx: !t.panes.adx } }))}>
          ADX
        </Toggle>
        <Toggle on={toggles.panes.rvol} onClick={() => setToggles((t) => ({ ...t, panes: { ...t.panes, rvol: !t.panes.rvol } }))}>
          RVOL
        </Toggle>
        <Toggle on={toggles.panes.ttm} onClick={() => setToggles((t) => ({ ...t, panes: { ...t.panes, ttm: !t.panes.ttm } }))}>
          TTM
        </Toggle>
        <Toggle on={toggles.showConfluence} onClick={() => setToggles((t) => ({ ...t, showConfluence: !t.showConfluence }))}>
          Include Confluence
        </Toggle>
        {selSig ? (
          <>
            <span className="ss-spacer" />
            <Badge tone="accent">
              {selSig.strategy} · {fmt.date(selSig.ts)}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => setSelKey(null)}>
              Clear levels
            </Button>
          </>
        ) : null}
      </div>

      {chartLoading ? (
        <Panel>
          <Loading label="Loading chart…" />
        </Panel>
      ) : chartError ? (
        <ErrorState error={chartError} title="Could not load chart data" />
      ) : candles.length === 0 ? (
        <Panel>
          <EmptyState title="No candles for this symbol">The loaded snapshot has no {timeframe} candles for {symbol}.</EmptyState>
        </Panel>
      ) : (
        <CandleChart
          key={symbol}
          candles={candles}
          indicators={indicators}
          timeframe={timeframe}
          overlays={toggles.overlays}
          panes={toggles.panes}
          signals={sigs}
          showConfluence={toggles.showConfluence}
          selectedSignal={selSig}
          onPickSignal={(s) => setSelKey(sigKey(s))}
          actions={actions}
          positions={positionsForSymbol}
          levels={levels}
        />
      )}

      <div className="ss-grid-2">
        <Panel title={`Signals · ${symbol}`} pad={false} right={<span className="ss-muted app-small">select one to draw its levels</span>}>
          {signalsQuery.isLoading ? (
            <Loading />
          ) : signalsQuery.isError ? (
            <ErrorState error={signalsQuery.error} />
          ) : sigs.length ? (
            <DataTable
              ariaLabel="Signals for symbol"
              density="compact"
              maxHeight={320}
              columns={signalCols}
              rows={tableRows}
              rowKey={(s) => s.strategy + s.ts}
              onRowOpen={(s) => setSelKey(sigKey(s))}
              rowClassName={(s) => (s === selSig ? 'ss-cursor' : s.strategy === 'Confluence' ? 'ss-dim' : undefined)}
            />
          ) : (
            <EmptyState title="No signals">No strategy has fired on this symbol in the loaded range.</EmptyState>
          )}
        </Panel>
        <div className="app-col">
          {positionsForSymbol.length ? (
            <Panel title="Your lots">
              <div className="app-col" style={{ gap: 6 }}>
                {positionsForSymbol.map((p) => (
                  <button type="button" key={p.id} className="app-lot" onClick={() => navigate(`/positions/${p.id}`)}>
                    <span className="ss-n">#{p.id}</span>
                    <span className="ss-n">
                      {p.status === 'open' ? p.qty_open : p.qty_total} @ {fmt.price(p.avg_entry_price)}
                    </span>
                    <span className="ss-muted app-small">
                      {fmt.date(p.opened_on)}
                      {p.closed_on ? ' → ' + fmt.date(p.closed_on) : ''}
                    </span>
                    <span className="ss-spacer" />
                    {p.status === 'open' ? <VerdictChip verdict={p.last_verdict ?? 'HOLD'} size="sm" /> : <Num kind="frac" value={p.realized_pnl_pct} signed tone="auto" />}
                  </button>
                ))}
              </div>
            </Panel>
          ) : null}
          <Panel title="Corporate actions">
            {actionsQuery.isLoading ? (
              <Loading />
            ) : actionsQuery.isError ? (
              <ErrorState error={actionsQuery.error} />
            ) : actions.length ? (
              <div className="app-col" style={{ gap: 8 }}>
                {actions.map((a, i) => (
                  <CorpActionMarker key={i} type={a.action_type} subject={a.subject} exDate={a.ex_date} />
                ))}
              </div>
            ) : (
              <span className="ss-muted">None in the loaded range.</span>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
