// Reusable TradingView-style candlestick chart built on lightweight-charts v5.
// Owned by charts/ (shared across the Symbol and Signals pages). Restyled onto
// the vendored design system's tokens and the prototype's `.app-chart-*` markup
// (design/prototype/src/chart.jsx), on the exact contract fixed by the task
// (see CandleChartProps below — the Position page is coded against it).
//
// Engine notes (kept from the prior version):
// - The chart instance is only torn down and recreated when `timeframe` changes
//   (the x-axis switches between business-day strings and UTC timestamps, which
//   shouldn't be mixed on one time scale) or on unmount.
// - Overlay/pane toggles and pane sizing rebuild the *series* (cheap) without
//   recreating the chart (`syncStructure`).
// - Plain data refreshes (new candles/indicators/signals/actions/positions/levels
//   with the same structure) only call `setData` / marker / price-line rebuilds
//   (`pushData`), never recreate series.
// - Colours are re-read from the CSS tokens on every (re)build and whenever the
//   theme changes (data-theme mutation or prefers-color-scheme flip).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
  type Time,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type WhitespaceData,
  type SeriesMarker,
  type MouseEventParams,
  type AutoscaleInfo,
} from 'lightweight-charts'
import type { Candle, CorporateAction, IndicatorRow, Position, Signal, Strategy, ActionType, Timeframe } from '../api/types'
import { toChartTime, tsKey } from './time'
import { readChartTokens, withAlpha, watchThemeChanges, type ChartTokens } from './colors'
import { fmt } from '../ds'

// Overlay series on the main price pane (EMA50/200, both Supertrend sides, BB, KC)
// carry indicator warm-up garbage for the first bars of a long history (e.g. an
// EMA/Supertrend that hasn't stabilised yet). We (a) exclude those series from the
// main price scale's autoscale entirely (the candlesticks + levels alone drive it)
// and (b) blank out their first N points so they don't render a bogus early spike.
const OVERLAY_WARMUP_BARS = 30

// Bars to show by default (most-recent-first) when a chart first mounts or the
// timeframe changes, so the user isn't dropped into a 5-year fit-to-content view.
const INITIAL_VISIBLE_BARS: Record<Timeframe, number> = { '1d': 180, '4h': 300, '1h': 300 }

const SUB_PANE_HEIGHT = 120

const SHORT_TAG: Record<Strategy, string> = {
  PIPELINE: 'PIPE',
  S1_ST_Flip: 'S1',
  S2_MACD_Zero: 'S2',
  S3_BB_Squeeze: 'S3',
  TTM_Squeeze: 'TTM',
  Confluence: 'C',
}

const ACTION_GLYPH: Record<ActionType, string> = {
  dividend: 'D',
  split: 'S',
  bonus: 'B',
  rights: 'R',
  demerger: 'DM',
}

// Stable identities for the optional array props' defaults: a fresh `[]` literal
// in a default parameter is re-created on every render, which would otherwise
// re-trigger the data-sync effect (and its `setLegend` call) on every unrelated
// re-render — including the ones a crosshair hover itself causes.
const EMPTY_SIGNALS: Signal[] = []
const EMPTY_ACTIONS: CorporateAction[] = []
const EMPTY_POSITIONS: Position[] = []

const DEFAULT_FOOT_NOTE =
  '1d · split/bonus-adjusted, dividends left in · ▲ event signals (click to draw levels) · ■ corporate actions · ● your fills'

export interface ChartLevel {
  kind: 'entry' | 'stop' | 'trail' | 't1' | 't2'
  value: number
  label: string
}

export interface CandleChartOverlays {
  ema50: boolean
  ema200: boolean
  supertrend: boolean
  bollinger: boolean
  keltner: boolean
}

export interface CandleChartPanes {
  macd: boolean
  adx: boolean
  rvol: boolean
  ttm: boolean
}

export interface CandleChartProps {
  candles: Candle[]
  indicators: IndicatorRow[]
  timeframe: Timeframe
  overlays: CandleChartOverlays
  panes: CandleChartPanes
  /** Event-strategy markers; Confluence only when it is the selected signal or showConfluence. */
  signals?: Signal[]
  showConfluence?: boolean
  /** Drawn with ' ◆' in ink; when `levels` is not given, its Entry/SL/T1/T2 become the level lines. */
  selectedSignal?: Signal | null
  /** Chart click on a bar that has an event signal. */
  onPickSignal?: (s: Signal) => void
  /** aboveBar square markers, 1d only: D/S/B/R/DM, demerger in --marker-demerger with ' ⚠'. */
  actions?: CorporateAction[]
  /** Fills: BUY #id circle belowBar (ink) at opened_on, SELL #id arrowDown aboveBar (ink) at closed_on. */
  positions?: Position[]
  /** Price lines: entry/stop solid, trail/t1/t2 dashed; included in the candlestick autoscale. */
  levels?: ChartLevel[]
  /** YYYY-MM-DD kept inside the initial visible range. */
  focusFrom?: string
  /** Main pane px, default 420. */
  height?: number
  footNote?: string
}

type LineSeriesApi = ISeriesApi<'Line'>
type HistSeriesApi = ISeriesApi<'Histogram'>
type CandleSeriesApi = ISeriesApi<'Candlestick'>
type LinePoint = LineData | WhitespaceData
type HistPoint = HistogramData | WhitespaceData

interface SeriesRefs {
  candlestick?: CandleSeriesApi
  ema50?: LineSeriesApi
  ema200?: LineSeriesApi
  supertrendUp?: LineSeriesApi
  supertrendDown?: LineSeriesApi
  bbUpper?: LineSeriesApi
  bbMiddle?: LineSeriesApi
  bbLower?: LineSeriesApi
  kcUpper?: LineSeriesApi
  kcMiddle?: LineSeriesApi
  kcLower?: LineSeriesApi
  volume?: HistSeriesApi
  macdLine?: LineSeriesApi
  macdSignal?: LineSeriesApi
  macdHist?: HistSeriesApi
  adx?: LineSeriesApi
  rvol?: HistSeriesApi
  ttmHist?: HistSeriesApi
}

interface RefLines {
  adx25?: IPriceLine
  rvol1?: IPriceLine
}

const PANE_ORDER: (keyof CandleChartPanes)[] = ['macd', 'adx', 'rvol', 'ttm']

function indicatorByTs(indicators: IndicatorRow[]): Map<number, IndicatorRow> {
  const m = new Map<number, IndicatorRow>()
  for (const row of indicators) m.set(tsKey(row.ts), row)
  return m
}

/** Stable string key for a lightweight-charts Time value, for set membership / map lookups. */
function timeKeyStr(t: Time): string {
  if (typeof t === 'string') return t
  if (typeof t === 'number') return String(t)
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

function buildCandleData(candles: Candle[], timeframe: Timeframe): CandlestickData[] {
  return candles.map((c) => ({
    time: toChartTime(c.ts, timeframe),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }))
}

function buildLine(
  candles: Candle[],
  indMap: Map<number, IndicatorRow>,
  timeframe: Timeframe,
  pick: (row: IndicatorRow) => number | null | undefined,
  warmupBars = 0,
): LinePoint[] {
  return candles.map((c, i) => {
    const time = toChartTime(c.ts, timeframe)
    if (i < warmupBars) return { time }
    const row = indMap.get(tsKey(c.ts))
    const v = row ? pick(row) : null
    if (v === null || v === undefined) return { time }
    return { time, value: v }
  })
}

function buildSupertrendSide(
  candles: Candle[],
  indMap: Map<number, IndicatorRow>,
  timeframe: Timeframe,
  dir: 1 | -1,
  warmupBars = 0,
): LinePoint[] {
  return candles.map((c, i) => {
    const time = toChartTime(c.ts, timeframe)
    if (i < warmupBars) return { time }
    const row = indMap.get(tsKey(c.ts))
    if (!row || row.supertrend_dir !== dir || row.supertrend_10_3 == null) return { time }
    return { time, value: row.supertrend_10_3 }
  })
}

function buildVolume(candles: Candle[], timeframe: Timeframe, tokens: ChartTokens): HistPoint[] {
  return candles.map((c) => ({
    time: toChartTime(c.ts, timeframe),
    value: c.volume,
    color: c.close >= c.open ? withAlpha(tokens.volumeUp, 0.9) : withAlpha(tokens.volumeDown, 0.9),
  }))
}

function buildHistBySign(
  candles: Candle[],
  indMap: Map<number, IndicatorRow>,
  timeframe: Timeframe,
  pick: (row: IndicatorRow) => number | null | undefined,
  tokens: ChartTokens,
): HistPoint[] {
  return candles.map((c) => {
    const time = toChartTime(c.ts, timeframe)
    const row = indMap.get(tsKey(c.ts))
    const v = row ? pick(row) : null
    if (v === null || v === undefined) return { time }
    return { time, value: v, color: v >= 0 ? withAlpha(tokens.up, 0.7) : withAlpha(tokens.down, 0.7) }
  })
}

function buildRvolHist(candles: Candle[], indMap: Map<number, IndicatorRow>, timeframe: Timeframe, tokens: ChartTokens): HistPoint[] {
  return candles.map((c) => {
    const time = toChartTime(c.ts, timeframe)
    const row = indMap.get(tsKey(c.ts))
    const v = row?.rvol_20
    if (v === null || v === undefined) return { time }
    return { time, value: v, color: v >= 1 ? withAlpha(tokens.up, 0.7) : withAlpha(tokens.muted, 0.5) }
  })
}

/** Combined marker set for the main candlestick series: event signals, corporate actions, position fills. */
function buildMarkers(
  candles: Candle[],
  timeframe: Timeframe,
  signals: Signal[],
  selectedSignal: Signal | null | undefined,
  showConfluence: boolean,
  actions: CorporateAction[],
  positions: Position[],
  tokens: ChartTokens,
): SeriesMarker<Time>[] {
  const have = new Set(candles.map((c) => timeKeyStr(toChartTime(c.ts, timeframe))))
  const out: SeriesMarker<Time>[] = []

  const evs = signals.filter((s) => s.strategy !== 'Confluence' || s === selectedSignal || showConfluence)
  for (const s of evs) {
    const t = toChartTime(s.ts, timeframe)
    if (!have.has(timeKeyStr(t))) continue
    const isSelected = s === selectedSignal
    out.push({
      time: t,
      position: 'belowBar',
      color: isSelected ? tokens.ink : tokens.accent,
      shape: 'arrowUp',
      text: SHORT_TAG[s.strategy] + (isSelected ? ' ◆' : ''),
    })
  }

  if (timeframe === '1d') {
    for (const a of actions) {
      const t = toChartTime(`${a.ex_date}T00:00:00Z`, timeframe)
      if (!have.has(timeKeyStr(t))) continue
      const isDemerger = a.action_type === 'demerger'
      out.push({
        time: t,
        position: 'aboveBar',
        color: isDemerger ? tokens.markerDemerger : tokens.markerAction,
        shape: 'square',
        text: ACTION_GLYPH[a.action_type] + (isDemerger ? ' ⚠' : ''),
      })
    }
  }

  for (const p of positions) {
    const tOpen = toChartTime(`${p.opened_on}T00:00:00Z`, timeframe)
    if (have.has(timeKeyStr(tOpen))) {
      out.push({ time: tOpen, position: 'belowBar', color: tokens.ink, shape: 'circle', text: `BUY #${p.id}` })
    }
    if (p.closed_on) {
      const tClose = toChartTime(`${p.closed_on}T00:00:00Z`, timeframe)
      if (have.has(timeKeyStr(tClose))) {
        out.push({ time: tClose, position: 'aboveBar', color: tokens.ink, shape: 'arrowDown', text: `SELL #${p.id}` })
      }
    }
  }

  out.sort((a, b) => {
    const ka = timeKeyStr(a.time)
    const kb = timeKeyStr(b.time)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  return out
}

const LEVEL_COLOR_KEY: Record<ChartLevel['kind'], keyof ChartTokens> = {
  entry: 'levelEntry',
  stop: 'levelStop',
  trail: 'levelTrail',
  t1: 'levelTarget',
  t2: 'levelTarget',
}

function levelLineStyle(kind: ChartLevel['kind']): LineStyle {
  return kind === 'entry' || kind === 'stop' ? LineStyle.Solid : LineStyle.Dashed
}

/** Levels implied by a selected signal, when the caller doesn't supply `levels` explicitly. */
function levelsFromSignal(s: Signal): ChartLevel[] {
  return [
    { kind: 'entry', value: s.entry, label: 'Entry' },
    { kind: 'stop', value: s.stop_loss, label: 'SL' },
    { kind: 't1', value: s.target_1, label: 'T1' },
    { kind: 't2', value: s.target_2, label: 'T2' },
  ]
}

interface LatestProps {
  candles: Candle[]
  indicators: IndicatorRow[]
  timeframe: Timeframe
  overlays: CandleChartOverlays
  panes: CandleChartPanes
  signals: Signal[]
  showConfluence: boolean
  selectedSignal: Signal | null
  actions: CorporateAction[]
  positions: Position[]
  levels: ChartLevel[]
  focusFrom?: string
  height: number
}

/** Legend/hover-readout data: either the hovered bar (crosshair) or, by default, the last bar. */
interface LegendData {
  ts: string
  open: number
  high: number
  low: number
  close: number
  prevClose: number | null
  volume: number
  ema50: number | null
  ema200: number | null
  stValue: number | null
  stDir: 1 | -1 | null
  rvol: number | null
  macd: number | null
  macdSignal: number | null
  macdHist: number | null
  adx: number | null
  ttmMomentum: number | null
  ttmSqueezeOn: boolean | null
}

export function CandleChart({
  candles,
  indicators,
  timeframe,
  overlays,
  panes,
  signals = EMPTY_SIGNALS,
  showConfluence = false,
  selectedSignal = null,
  onPickSignal,
  actions = EMPTY_ACTIONS,
  positions = EMPTY_POSITIONS,
  levels,
  focusFrom,
  height = 420,
  footNote,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<SeriesRefs>({})
  const refLinesRef = useRef<RefLines>({})
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const priceLineObjsRef = useRef<IPriceLine[]>([])

  // Memoized: recomputing this array on every render (e.g. from a crosshair-hover
  // legend update) would change its identity each time, re-triggering the data-sync
  // effect below on every hover move and stomping the hover legend with pushData's
  // own "last bar" default right after it was set.
  const effectiveLevels = useMemo(() => levels ?? (selectedSignal ? levelsFromSignal(selectedSignal) : []), [levels, selectedSignal])

  const latestRef = useRef<LatestProps>({
    candles,
    indicators,
    timeframe,
    overlays,
    panes,
    signals,
    showConfluence,
    selectedSignal,
    actions,
    positions,
    levels: effectiveLevels,
    focusFrom,
    height,
  })
  latestRef.current = {
    candles,
    indicators,
    timeframe,
    overlays,
    panes,
    signals,
    showConfluence,
    selectedSignal,
    actions,
    positions,
    levels: effectiveLevels,
    focusFrom,
    height,
  }

  const indMapRef = useRef<Map<number, IndicatorRow>>(new Map())
  const pendingLegendParamRef = useRef<MouseEventParams<Time> | null | undefined>(undefined)
  const legendRafRef = useRef<number | null>(null)
  const [legend, setLegend] = useState<LegendData | null>(null)

  const activePanes = PANE_ORDER.filter((k) => panes[k])
  const totalHeight = height + activePanes.length * SUB_PANE_HEIGHT

  // Read from a ref inside the click handler so the mount-only effect below
  // doesn't need to depend on (and re-subscribe for) a fresh onPickSignal identity.
  const onPickSignalRef = useRef(onPickSignal)
  onPickSignalRef.current = onPickSignal

  // ---------------------------------------------------------------------
  // Imperative helpers (close over refs, always read latestRef for data)
  // ---------------------------------------------------------------------

  function applyStaticColors() {
    const chart = chartRef.current
    const refs = seriesRef.current
    if (!chart) return
    const tokens = readChartTokens()

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: tokens.bg },
        textColor: tokens.muted,
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: tokens.grid },
        horzLines: { color: tokens.grid },
      },
      rightPriceScale: { borderColor: tokens.line },
      timeScale: { borderColor: tokens.line, timeVisible: latestRef.current.timeframe !== '1d' },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: tokens.muted, labelBackgroundColor: tokens.ink },
        horzLine: { color: tokens.muted, labelBackgroundColor: tokens.ink },
      },
      localization: { priceFormatter: (p: number) => fmt.price(p), locale: 'en-IN' },
    })

    refs.candlestick?.applyOptions({
      upColor: tokens.up,
      downColor: tokens.down,
      borderUpColor: tokens.up,
      borderDownColor: tokens.down,
      wickUpColor: tokens.up,
      wickDownColor: tokens.down,
      priceLineColor: tokens.muted,
    })
    refs.ema50?.applyOptions({ color: tokens.ema50 })
    refs.ema200?.applyOptions({ color: tokens.ema200 })
    refs.supertrendUp?.applyOptions({ color: tokens.up })
    refs.supertrendDown?.applyOptions({ color: tokens.down })
    refs.bbUpper?.applyOptions({ color: withAlpha(tokens.bbBand, 0.55) })
    refs.bbMiddle?.applyOptions({ color: tokens.bbBand })
    refs.bbLower?.applyOptions({ color: withAlpha(tokens.bbBand, 0.55) })
    refs.kcUpper?.applyOptions({ color: withAlpha(tokens.kcBand, 0.55) })
    refs.kcMiddle?.applyOptions({ color: tokens.kcBand })
    refs.kcLower?.applyOptions({ color: withAlpha(tokens.kcBand, 0.55) })
    refs.macdLine?.applyOptions({ color: tokens.macdLine })
    refs.macdSignal?.applyOptions({ color: tokens.macdSignal })
    refs.adx?.applyOptions({ color: tokens.accent })
    refLinesRef.current.adx25?.applyOptions({ color: withAlpha(tokens.muted, 0.8) })
    refLinesRef.current.rvol1?.applyOptions({ color: withAlpha(tokens.muted, 0.8) })
  }

  /** Applies the default "last N bars, narrowed toward focusFrom/selectedSignal" visible
   * range. Called on mount and timeframe change only — never on a plain data refresh, so
   * we don't yank the user's scroll. Mirrors chart.jsx's from/to logic. */
  function applyInitialVisibleRange() {
    const chart = chartRef.current
    if (!chart) return
    const { candles: cs, timeframe: tf, focusFrom: ff, selectedSignal: sel } = latestRef.current
    const n = cs.length
    if (n === 0) {
      chart.timeScale().fitContent()
      return
    }
    let from = n - INITIAL_VISIBLE_BARS[tf]
    if (ff) {
      const i = cs.findIndex((b) => b.ts.slice(0, 10) >= ff)
      if (i > 0) from = Math.max(0, Math.min(from, i - 40))
    }
    if (sel) {
      const i = cs.findIndex((b) => b.ts === sel.ts)
      if (i > 0) from = Math.max(0, Math.min(from, i - 60))
    }
    chart.timeScale().setVisibleLogicalRange({ from, to: n + 5 })
  }

  /** Resolves the legend/hover-readout data for a crosshair event, or (param null/
   * off-chart) the last bar as the default "not hovering" readout. Looks the bar up
   * by logical index rather than by chart Time, since a 1d chart's Time is a
   * business-day string that lightweight-charts may echo back as a different
   * representation than what we fed in. */
  function computeLegendData(param: MouseEventParams<Time> | null): LegendData | null {
    const { candles: cs } = latestRef.current
    if (cs.length === 0) return null
    let idx = cs.length - 1
    if (param && param.logical != null) {
      idx = Math.min(cs.length - 1, Math.max(0, Math.round(param.logical)))
    }
    const c = cs[idx]
    const prev = cs[idx - 1]
    const row = indMapRef.current.get(tsKey(c.ts))
    return {
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      prevClose: prev ? prev.close : null,
      volume: c.volume,
      ema50: row?.ema_50 ?? null,
      ema200: row?.ema_200 ?? null,
      stValue: row?.supertrend_10_3 ?? null,
      stDir: row?.supertrend_dir ?? null,
      rvol: row?.rvol_20 ?? null,
      macd: row?.macd_12_26 ?? null,
      macdSignal: row?.macd_signal_9 ?? null,
      macdHist: row?.macd_hist ?? null,
      adx: row?.adx_14 ?? null,
      ttmMomentum: row?.ttm_momentum ?? null,
      ttmSqueezeOn: row?.ttm_squeeze_on ?? null,
    }
  }

  function pushData() {
    const refs = seriesRef.current
    if (!refs.candlestick) return
    const { candles: cs, indicators: inds, timeframe: tf, signals: sigs, showConfluence: showConf, selectedSignal: sel, actions: acts, positions: poss, levels: lvls } =
      latestRef.current
    const tokens = readChartTokens()
    const indMap = indicatorByTs(inds)
    indMapRef.current = indMap

    refs.candlestick.setData(buildCandleData(cs, tf))
    refs.ema50?.setData(buildLine(cs, indMap, tf, (r) => r.ema_50, OVERLAY_WARMUP_BARS))
    refs.ema200?.setData(buildLine(cs, indMap, tf, (r) => r.ema_200, OVERLAY_WARMUP_BARS))
    refs.supertrendUp?.setData(buildSupertrendSide(cs, indMap, tf, 1, OVERLAY_WARMUP_BARS))
    refs.supertrendDown?.setData(buildSupertrendSide(cs, indMap, tf, -1, OVERLAY_WARMUP_BARS))
    refs.bbUpper?.setData(buildLine(cs, indMap, tf, (r) => r.bb_upper_20_2, OVERLAY_WARMUP_BARS))
    refs.bbMiddle?.setData(buildLine(cs, indMap, tf, (r) => r.bb_middle_20_2, OVERLAY_WARMUP_BARS))
    refs.bbLower?.setData(buildLine(cs, indMap, tf, (r) => r.bb_lower_20_2, OVERLAY_WARMUP_BARS))
    refs.kcUpper?.setData(buildLine(cs, indMap, tf, (r) => r.kc_upper_20_15, OVERLAY_WARMUP_BARS))
    refs.kcMiddle?.setData(buildLine(cs, indMap, tf, (r) => r.kc_middle_20, OVERLAY_WARMUP_BARS))
    refs.kcLower?.setData(buildLine(cs, indMap, tf, (r) => r.kc_lower_20_15, OVERLAY_WARMUP_BARS))
    refs.volume?.setData(buildVolume(cs, tf, tokens))
    refs.macdLine?.setData(buildLine(cs, indMap, tf, (r) => r.macd_12_26))
    refs.macdSignal?.setData(buildLine(cs, indMap, tf, (r) => r.macd_signal_9))
    refs.macdHist?.setData(buildHistBySign(cs, indMap, tf, (r) => r.macd_hist, tokens))
    refs.adx?.setData(buildLine(cs, indMap, tf, (r) => r.adx_14))
    refs.rvol?.setData(buildRvolHist(cs, indMap, tf, tokens))
    refs.ttmHist?.setData(buildHistBySign(cs, indMap, tf, (r) => r.ttm_momentum, tokens))

    markersApiRef.current?.setMarkers(buildMarkers(cs, tf, sigs, sel, showConf, acts, poss, tokens))

    for (const pl of priceLineObjsRef.current) refs.candlestick.removePriceLine(pl)
    priceLineObjsRef.current = lvls.map((lv) =>
      refs.candlestick!.createPriceLine({
        price: lv.value,
        color: tokens[LEVEL_COLOR_KEY[lv.kind]],
        title: lv.label,
        axisLabelVisible: true,
        lineWidth: 1,
        lineStyle: levelLineStyle(lv.kind),
        lineVisible: true,
      }),
    )

    // Refresh the legend's "no hover" default (last bar) whenever data changes.
    setLegend(computeLegendData(null))
  }

  function syncStructure() {
    const chart = chartRef.current
    const refs = seriesRef.current
    if (!chart || !refs.candlestick) return
    const { overlays: ov, panes: pn, height: mainHeight } = latestRef.current

    for (const key of Object.keys(refs) as (keyof SeriesRefs)[]) {
      if (key === 'candlestick') continue
      const s = refs[key]
      if (s) {
        try {
          chart.removeSeries(s)
        } catch {
          // series already gone with its pane; ignore
        }
        refs[key] = undefined
      }
    }
    refLinesRef.current = {}

    while (chart.panes().length > 1) {
      try {
        chart.removePane(chart.panes().length - 1)
      } catch {
        break
      }
    }

    // Volume is always drawn in the main pane, as an overlay price scale pinned
    // to the bottom ~16%, like the prototype — never a toggleable pane.
    refs.volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 0)
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false })

    // Overlays, all on the main pane (0). `autoscaleInfoProvider: () => null` excludes
    // each of these from the pane's autoscale computation entirely, so only the
    // candlestick series (+ levels, see the candlestick's own autoscaleInfoProvider)
    // drives the main price scale — these can carry warm-up garbage at the start of
    // a long history that would otherwise blow out the axis.
    const noAutoscale = { autoscaleInfoProvider: () => null }
    if (ov.ema50) refs.ema50 = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
    if (ov.ema200) refs.ema200 = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
    if (ov.supertrend) {
      refs.supertrendUp = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
      refs.supertrendDown = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
    }
    if (ov.bollinger) {
      refs.bbUpper = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
      refs.bbMiddle = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
      refs.bbLower = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
    }
    if (ov.keltner) {
      refs.kcUpper = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
      refs.kcMiddle = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
      refs.kcLower = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, ...noAutoscale }, 0)
    }

    // Sub-panes, in a fixed order, only the active ones.
    const active = PANE_ORDER.filter((k) => pn[k])
    active.forEach((key, i) => {
      const paneIndex = i + 1
      if (key === 'macd') {
        refs.macdHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex)
        refs.macdLine = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex)
        refs.macdSignal = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex)
      } else if (key === 'adx') {
        refs.adx = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex)
      } else if (key === 'rvol') {
        refs.rvol = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex)
      } else if (key === 'ttm') {
        refs.ttmHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex)
      }
      chart.panes()[paneIndex]?.setHeight(SUB_PANE_HEIGHT)
    })
    chart.panes()[0]?.setHeight(mainHeight)

    const tokens = readChartTokens()
    if (refs.adx) {
      refLinesRef.current.adx25 = refs.adx.createPriceLine({
        price: 25,
        color: withAlpha(tokens.muted, 0.8),
        lineStyle: LineStyle.Dotted,
        lineWidth: 1,
        axisLabelVisible: true,
        lineVisible: true,
        title: '25',
      })
    }
    if (refs.rvol) {
      refLinesRef.current.rvol1 = refs.rvol.createPriceLine({
        price: 1,
        color: withAlpha(tokens.muted, 0.8),
        lineStyle: LineStyle.Dotted,
        lineWidth: 1,
        axisLabelVisible: true,
        lineVisible: true,
        title: '1x',
      })
    }

    chart.resize(containerRef.current?.clientWidth ?? 0, mainHeight + active.length * SUB_PANE_HEIGHT)

    applyStaticColors()
    pushData()
  }

  // ---------------------------------------------------------------------
  // Effect: mount-only chart creation for the current timeframe, and full
  // rebuild whenever timeframe changes (axis time-type switches between
  // business-day strings and UTC timestamps).
  // ---------------------------------------------------------------------
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const activeAtMount = PANE_ORDER.filter((k) => latestRef.current.panes[k])
    const chart = createChart(container, {
      width: container.clientWidth,
      height: latestRef.current.height + activeAtMount.length * SUB_PANE_HEIGHT,
      autoSize: false,
      timeScale: { rightOffset: 5, barSpacing: 7 },
    })
    chartRef.current = chart

    const candlestick = chart.addSeries(
      CandlestickSeries,
      {
        priceLineStyle: LineStyle.Dashed,
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const res = original()
          const vals = latestRef.current.levels.map((l) => l.value).filter((v): v is number => v != null)
          if (!res || !res.priceRange || !vals.length) return res
          return {
            ...res,
            priceRange: {
              minValue: Math.min(res.priceRange.minValue, ...vals),
              maxValue: Math.max(res.priceRange.maxValue, ...vals),
            },
          }
        },
      },
      0,
    )
    seriesRef.current = { candlestick }
    markersApiRef.current = createSeriesMarkers(candlestick, [])

    syncStructure()
    applyInitialVisibleRange()

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      pendingLegendParamRef.current = param
      if (legendRafRef.current == null) {
        legendRafRef.current = requestAnimationFrame(() => {
          legendRafRef.current = null
          const pending = pendingLegendParamRef.current
          pendingLegendParamRef.current = undefined
          if (pending === undefined) return
          setLegend(computeLegendData(pending))
        })
      }
    }
    chart.subscribeCrosshairMove(handleCrosshairMove)

    const handleClick = (param: MouseEventParams<Time>) => {
      const cb = onPickSignalRef.current
      if (!param.time || !cb) return
      const key = timeKeyStr(param.time)
      const candidate = latestRef.current.signals.find((s) => s.strategy !== 'Confluence' && timeKeyStr(toChartTime(s.ts, latestRef.current.timeframe)) === key)
      if (candidate) cb(candidate)
    }
    chart.subscribeClick(handleClick)

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      chart.unsubscribeClick(handleClick)
      if (legendRafRef.current != null) {
        cancelAnimationFrame(legendRafRef.current)
        legendRafRef.current = null
      }
      chart.remove()
      chartRef.current = null
      seriesRef.current = {}
      refLinesRef.current = {}
      markersApiRef.current = null
      priceLineObjsRef.current = []
    }
  }, [timeframe])

  // Structure sync: overlay/pane toggles and height, without recreating the chart.
  useEffect(() => {
    if (!chartRef.current) return
    syncStructure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays.ema50, overlays.ema200, overlays.supertrend, overlays.bollinger, overlays.keltner, panes.macd, panes.adx, panes.rvol, panes.ttm, height])

  // Data sync: candles/indicators/signals/actions/positions/levels refresh in place.
  useEffect(() => {
    if (!chartRef.current) return
    pushData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, indicators, signals, showConfluence, selectedSignal, actions, positions, effectiveLevels])

  // Resize + theme watchers: persist for the component's lifetime, independent
  // of chart rebuilds (they read chartRef.current / latestRef.current at call time).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = entry.contentRect.width
      const active = PANE_ORDER.filter((k) => latestRef.current.panes[k])
      chartRef.current?.resize(width, latestRef.current.height + active.length * SUB_PANE_HEIGHT)
    })
    ro.observe(container)

    const unwatchTheme = watchThemeChanges(() => {
      applyStaticColors()
      pushData()
    })

    return () => {
      ro.disconnect()
      unwatchTheme()
    }
  }, [])

  const b = legend
  const upish = b && b.prevClose != null ? b.close >= b.prevClose : true

  return (
    <div className="app-chart">
      <div className="app-chart-legend">
        {b ? (
          <>
            <span className="ss-n ss-muted">{fmt.date(b.ts, true)}</span>
            <span className="ss-n">
              O <b>{fmt.price(b.open)}</b>
            </span>
            <span className="ss-n">
              H <b>{fmt.price(b.high)}</b>
            </span>
            <span className="ss-n">
              L <b>{fmt.price(b.low)}</b>
            </span>
            <span className="ss-n">
              C{' '}
              <b className={upish ? 'ss-up' : 'ss-down'}>{fmt.price(b.close)}</b>
            </span>
            <span className="ss-n ss-muted">V {fmt.qty(b.volume)}</span>
            {overlays.ema50 && b.ema50 != null ? (
              <span className="ss-n" style={{ color: 'var(--ema-50)' }}>
                EMA50 {fmt.price(b.ema50)}
              </span>
            ) : null}
            {overlays.ema200 && b.ema200 != null ? (
              <span className="ss-n" style={{ color: 'var(--ema-200)' }}>
                EMA200 {fmt.price(b.ema200)}
              </span>
            ) : null}
            {overlays.supertrend && b.stValue != null ? (
              <span className={'ss-n ' + (b.stDir === 1 ? 'ss-up' : 'ss-down')}>
                ST {fmt.price(b.stValue)} {b.stDir === 1 ? '▲' : '▼'}
              </span>
            ) : null}
            {b.rvol != null ? <span className="ss-n ss-muted">RVOL {fmt.mult(b.rvol)}</span> : null}
          </>
        ) : null}
      </div>
      <div ref={containerRef} className="app-chart-main" style={{ height: totalHeight }} />
      {activePanes.includes('macd') ? (
        <div className="app-chart-sublabel ss-n">
          <span style={{ color: 'var(--macd-line)' }}>MACD {b?.macd != null ? fmt.price(b.macd) : '—'}</span>
          <span style={{ color: 'var(--macd-signal)' }}>signal {b?.macdSignal != null ? fmt.price(b.macdSignal) : '—'}</span>
          <span className={b?.macdHist != null && b.macdHist >= 0 ? 'ss-up' : 'ss-down'}>hist {b?.macdHist != null ? fmt.price(b.macdHist) : '—'}</span>
        </div>
      ) : null}
      {activePanes.includes('adx') ? (
        <div className="app-chart-sublabel ss-n">
          <span>ADX 14 {b?.adx != null ? fmt.price(b.adx, 1) : '—'}</span>
          <span className="ss-muted">{b?.adx != null ? (b.adx > 25 ? 'trending' : 'weak') : ''}</span>
        </div>
      ) : null}
      {activePanes.includes('rvol') ? (
        <div className="app-chart-sublabel ss-n">
          <span>RVOL 20 {b?.rvol != null ? fmt.mult(b.rvol) : '—'}</span>
        </div>
      ) : null}
      {activePanes.includes('ttm') ? (
        <div className="app-chart-sublabel ss-n">
          <span>TTM momentum {b?.ttmMomentum != null ? fmt.price(b.ttmMomentum, 4) : '—'}</span>
          <span className="ss-muted">squeeze {b?.ttmSqueezeOn == null ? '—' : b.ttmSqueezeOn ? 'ON' : 'OFF'}</span>
        </div>
      ) : null}
      <div className="app-chart-foot ss-muted">
        <span>{footNote ?? DEFAULT_FOOT_NOTE}</span>
      </div>
    </div>
  )
}
