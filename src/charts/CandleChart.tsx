// Reusable TradingView-style candlestick chart built on lightweight-charts v5.
// Owned by charts/ (shared across the Symbol and Signals pages).
//
// Design notes (see final report for the full rationale):
// - The chart instance itself is only torn down and recreated when `timeframe`
//   changes (the x-axis switches between business-day strings and UTC
//   timestamps, which shouldn't be mixed on one time scale) or on unmount.
// - Overlay/pane toggles rebuild the *series* (cheap) without recreating the
//   chart.
// - Plain data refreshes (new candles/indicators/markers/priceLines with the
//   same structure) only call `setData` / `setMarkers` / price-line diffing.
// - Colours are re-read from the CSS tokens on every (re)build and whenever
//   the theme changes (data-theme mutation or prefers-color-scheme flip).

import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
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
} from 'lightweight-charts'
import type { Candle, IndicatorRow, Timeframe } from '../api/types'
import { toChartTime, tsKey } from './time'
import { readChartTokens, withAlpha, watchThemeChanges, type ChartTokens } from './colors'

export interface CandleChartMarker {
  ts: string
  kind: 'signal' | 'action' | 'position'
  label: string
  color: string
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
}

export interface CandleChartPriceLine {
  price: number
  label: string
  color: string
  style?: 'solid' | 'dashed' | 'dotted'
}

export interface CandleChartOverlays {
  ema50: boolean
  ema200: boolean
  supertrend: boolean
  bollinger: boolean
  keltner: boolean
}

export interface CandleChartPanes {
  volume: boolean
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
  markers?: CandleChartMarker[]
  priceLines?: CandleChartPriceLine[]
  height?: number
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
  volumeMa?: LineSeriesApi
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

const PANE_ORDER: (keyof CandleChartPanes)[] = ['volume', 'macd', 'adx', 'rvol', 'ttm']

function indicatorByTs(indicators: IndicatorRow[]): Map<number, IndicatorRow> {
  const m = new Map<number, IndicatorRow>()
  for (const row of indicators) m.set(tsKey(row.ts), row)
  return m
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
): LinePoint[] {
  return candles.map((c) => {
    const time = toChartTime(c.ts, timeframe)
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
): LinePoint[] {
  return candles.map((c) => {
    const time = toChartTime(c.ts, timeframe)
    const row = indMap.get(tsKey(c.ts))
    if (!row || row.supertrend_dir !== dir || row.supertrend_10_3 == null) return { time }
    return { time, value: row.supertrend_10_3 }
  })
}

function buildVolume(candles: Candle[], timeframe: Timeframe, tokens: ChartTokens): HistPoint[] {
  return candles.map((c) => ({
    time: toChartTime(c.ts, timeframe),
    value: c.volume,
    color: c.close >= c.open ? withAlpha(tokens.up, 0.55) : withAlpha(tokens.down, 0.55),
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

function buildRvolHist(
  candles: Candle[],
  indMap: Map<number, IndicatorRow>,
  timeframe: Timeframe,
  tokens: ChartTokens,
): HistPoint[] {
  return candles.map((c) => {
    const time = toChartTime(c.ts, timeframe)
    const row = indMap.get(tsKey(c.ts))
    const v = row?.rvol_20
    if (v === null || v === undefined) return { time }
    return { time, value: v, color: v >= 1 ? withAlpha(tokens.up, 0.7) : withAlpha(tokens.muted, 0.5) }
  })
}

function buildSqueezeMarkers(
  candles: Candle[],
  indMap: Map<number, IndicatorRow>,
  timeframe: Timeframe,
  tokens: ChartTokens,
): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = []
  for (const c of candles) {
    const row = indMap.get(tsKey(c.ts))
    if (row?.ttm_squeeze_on) {
      out.push({
        time: toChartTime(c.ts, timeframe),
        position: 'inBar',
        shape: 'circle',
        color: tokens.accent,
        size: 0.6,
      })
    }
  }
  return out
}

function lineStyleFor(style: CandleChartPriceLine['style']): LineStyle {
  if (style === 'dashed') return LineStyle.Dashed
  if (style === 'dotted') return LineStyle.Dotted
  return LineStyle.Solid
}

interface LatestProps {
  candles: Candle[]
  indicators: IndicatorRow[]
  timeframe: Timeframe
  overlays: CandleChartOverlays
  panes: CandleChartPanes
  markers: CandleChartMarker[]
  priceLines: CandleChartPriceLine[]
  height: number
}

export function CandleChart({
  candles,
  indicators,
  timeframe,
  overlays,
  panes,
  markers = [],
  priceLines = [],
  height = 480,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<SeriesRefs>({})
  const refLinesRef = useRef<RefLines>({})
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const ttmMarkersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const priceLineObjsRef = useRef<IPriceLine[]>([])
  const latestRef = useRef<LatestProps>({ candles, indicators, timeframe, overlays, panes, markers, priceLines, height })
  latestRef.current = { candles, indicators, timeframe, overlays, panes, markers, priceLines, height }

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
      },
      grid: {
        vertLines: { color: withAlpha(tokens.border, 0.5) },
        horzLines: { color: withAlpha(tokens.border, 0.5) },
      },
      rightPriceScale: { borderColor: tokens.border },
      timeScale: { borderColor: tokens.border, timeVisible: latestRef.current.timeframe !== '1d' },
    })

    refs.candlestick?.applyOptions({
      upColor: tokens.up,
      downColor: tokens.down,
      borderUpColor: tokens.up,
      borderDownColor: tokens.down,
      wickUpColor: tokens.up,
      wickDownColor: tokens.down,
    })
    refs.ema50?.applyOptions({ color: tokens.accent })
    refs.ema200?.applyOptions({ color: tokens.warn })
    refs.supertrendUp?.applyOptions({ color: tokens.up })
    refs.supertrendDown?.applyOptions({ color: tokens.down })
    refs.bbUpper?.applyOptions({ color: withAlpha(tokens.accent, 0.55) })
    refs.bbMiddle?.applyOptions({ color: tokens.accent })
    refs.bbLower?.applyOptions({ color: withAlpha(tokens.accent, 0.55) })
    refs.kcUpper?.applyOptions({ color: withAlpha(tokens.warn, 0.55) })
    refs.kcMiddle?.applyOptions({ color: tokens.warn })
    refs.kcLower?.applyOptions({ color: withAlpha(tokens.warn, 0.55) })
    refs.volumeMa?.applyOptions({ color: tokens.text })
    refs.macdLine?.applyOptions({ color: tokens.accent })
    refs.macdSignal?.applyOptions({ color: tokens.warn })
    refs.adx?.applyOptions({ color: tokens.accent })
    refLinesRef.current.adx25?.applyOptions({ color: withAlpha(tokens.muted, 0.8) })
    refLinesRef.current.rvol1?.applyOptions({ color: withAlpha(tokens.muted, 0.8) })
  }

  function pushData() {
    const refs = seriesRef.current
    if (!refs.candlestick) return
    const { candles: cs, indicators: inds, timeframe: tf, markers: mk, priceLines: pls } = latestRef.current
    const tokens = readChartTokens()
    const indMap = indicatorByTs(inds)

    refs.candlestick.setData(buildCandleData(cs, tf))
    refs.ema50?.setData(buildLine(cs, indMap, tf, (r) => r.ema_50))
    refs.ema200?.setData(buildLine(cs, indMap, tf, (r) => r.ema_200))
    refs.supertrendUp?.setData(buildSupertrendSide(cs, indMap, tf, 1))
    refs.supertrendDown?.setData(buildSupertrendSide(cs, indMap, tf, -1))
    refs.bbUpper?.setData(buildLine(cs, indMap, tf, (r) => r.bb_upper_20_2))
    refs.bbMiddle?.setData(buildLine(cs, indMap, tf, (r) => r.bb_middle_20_2))
    refs.bbLower?.setData(buildLine(cs, indMap, tf, (r) => r.bb_lower_20_2))
    refs.kcUpper?.setData(buildLine(cs, indMap, tf, (r) => r.kc_upper_20_15))
    refs.kcMiddle?.setData(buildLine(cs, indMap, tf, (r) => r.kc_middle_20))
    refs.kcLower?.setData(buildLine(cs, indMap, tf, (r) => r.kc_lower_20_15))
    refs.volume?.setData(buildVolume(cs, tf, tokens))
    refs.volumeMa?.setData(buildLine(cs, indMap, tf, (r) => r.volume_ma_20))
    refs.macdLine?.setData(buildLine(cs, indMap, tf, (r) => r.macd_12_26))
    refs.macdSignal?.setData(buildLine(cs, indMap, tf, (r) => r.macd_signal_9))
    refs.macdHist?.setData(buildHistBySign(cs, indMap, tf, (r) => r.macd_hist, tokens))
    refs.adx?.setData(buildLine(cs, indMap, tf, (r) => r.adx_14))
    refs.rvol?.setData(buildRvolHist(cs, indMap, tf, tokens))
    refs.ttmHist?.setData(buildHistBySign(cs, indMap, tf, (r) => r.ttm_momentum, tokens))
    ttmMarkersApiRef.current?.setMarkers(buildSqueezeMarkers(cs, indMap, tf, tokens))

    markersApiRef.current?.setMarkers(
      mk.map((m) => ({
        time: toChartTime(m.ts, tf),
        position: m.position,
        shape: m.shape,
        color: m.color,
        text: m.label,
        size: m.kind === 'action' ? 0.8 : 1,
      })),
    )

    for (const pl of priceLineObjsRef.current) refs.candlestick.removePriceLine(pl)
    priceLineObjsRef.current = pls.map((pl) =>
      refs.candlestick!.createPriceLine({
        price: pl.price,
        color: pl.color,
        title: pl.label,
        axisLabelVisible: true,
        lineWidth: 1,
        lineStyle: lineStyleFor(pl.style),
        lineVisible: true,
      }),
    )
  }

  function syncStructure() {
    const chart = chartRef.current
    const refs = seriesRef.current
    if (!chart || !refs.candlestick) return
    const { overlays: ov, panes: pn, height: h } = latestRef.current

    // Remove all tracked overlay/pane series (candlestick + its markers API stay).
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
    ttmMarkersApiRef.current = null

    // Drop extra panes so pane indices are deterministic on rebuild.
    while (chart.panes().length > 1) {
      try {
        chart.removePane(chart.panes().length - 1)
      } catch {
        break
      }
    }

    // Overlays, all on the main pane (0).
    if (ov.ema50) refs.ema50 = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
    if (ov.ema200) refs.ema200 = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
    if (ov.supertrend) {
      refs.supertrendUp = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0)
      refs.supertrendDown = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0)
    }
    if (ov.bollinger) {
      refs.bbUpper = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0)
      refs.bbMiddle = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
      refs.bbLower = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0)
    }
    if (ov.keltner) {
      refs.kcUpper = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0)
      refs.kcMiddle = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
      refs.kcLower = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }, 0)
    }

    // Sub-panes, in a fixed order, only the active ones.
    const active = PANE_ORDER.filter((k) => pn[k])
    const mainHeight = active.length ? Math.round(h * 0.6) : h
    const subHeight = active.length ? Math.max(60, Math.floor((h - mainHeight) / active.length)) : 0

    active.forEach((key, i) => {
      const paneIndex = i + 1
      if (key === 'volume') {
        refs.volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, paneIndex)
        refs.volumeMa = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex)
      } else if (key === 'macd') {
        refs.macdHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex)
        refs.macdLine = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex)
        refs.macdSignal = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex)
      } else if (key === 'adx') {
        refs.adx = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIndex)
      } else if (key === 'rvol') {
        refs.rvol = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex)
      } else if (key === 'ttm') {
        refs.ttmHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex)
        ttmMarkersApiRef.current = createSeriesMarkers(refs.ttmHist, [])
      }
      chart.panes()[paneIndex]?.setHeight(subHeight)
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

    const chart = createChart(container, {
      width: container.clientWidth,
      height: latestRef.current.height,
      autoSize: false,
    })
    chartRef.current = chart

    const candlestick = chart.addSeries(CandlestickSeries, {}, 0)
    seriesRef.current = { candlestick }
    markersApiRef.current = createSeriesMarkers(candlestick, [])

    syncStructure()
    chart.timeScale().fitContent()

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = {}
      refLinesRef.current = {}
      markersApiRef.current = null
      ttmMarkersApiRef.current = null
      priceLineObjsRef.current = []
    }
  }, [timeframe])

  // Structure sync: overlay/pane toggles and height, without recreating the chart.
  useEffect(() => {
    if (!chartRef.current) return
    syncStructure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays.ema50, overlays.ema200, overlays.supertrend, overlays.bollinger, overlays.keltner, panes.volume, panes.macd, panes.adx, panes.rvol, panes.ttm, height])

  // Data sync: candles/indicators/markers/priceLines refresh in place.
  useEffect(() => {
    if (!chartRef.current) return
    pushData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, indicators, markers, priceLines])

  // Resize + theme watchers: persist for the component's lifetime, independent
  // of chart rebuilds (they read chartRef.current at call time).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = entry.contentRect.width
      chartRef.current?.resize(width, latestRef.current.height)
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

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}
