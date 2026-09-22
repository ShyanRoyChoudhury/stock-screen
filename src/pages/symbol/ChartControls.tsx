import { TIMEFRAMES } from '../../lib/domain'
import { ExperimentalBadge } from '../../components/ExperimentalBadge'
import { Toggle } from '../../components/Toggle'
import type { Timeframe } from '../../api/types'
import type { CandleChartOverlays, CandleChartPanes } from '../../charts/CandleChart'

interface ChartControlsProps {
  timeframe: Timeframe
  onTimeframeChange: (tf: Timeframe) => void
  allowedTimeframes: Timeframe[]
  overlays: CandleChartOverlays
  onOverlaysChange: (overlays: CandleChartOverlays) => void
  panes: CandleChartPanes
  onPanesChange: (panes: CandleChartPanes) => void
  showConfluenceMarkers: boolean
  onShowConfluenceMarkersChange: (v: boolean) => void
}

export function ChartControls({
  timeframe,
  onTimeframeChange,
  allowedTimeframes,
  overlays,
  onOverlaysChange,
  panes,
  onPanesChange,
  showConfluenceMarkers,
  onShowConfluenceMarkersChange,
}: ChartControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded border border-border bg-surface px-3 py-2 text-sm">
      <div className="flex items-center gap-1.5">
        <div className="inline-flex overflow-hidden rounded border border-border">
          {TIMEFRAMES.filter((t) => allowedTimeframes.includes(t.key)).map((t, i) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTimeframeChange(t.key)}
              className={`px-2 py-1 text-xs font-medium ${i > 0 ? 'border-l border-border' : ''} ${
                timeframe === t.key ? 'bg-accent text-white' : 'bg-surface text-text hover:bg-surface-2'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {timeframe !== '1d' && <ExperimentalBadge />}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted">Overlays</span>
        <Toggle checked={overlays.ema50} onChange={(v) => onOverlaysChange({ ...overlays, ema50: v })} label="EMA50" />
        <Toggle checked={overlays.ema200} onChange={(v) => onOverlaysChange({ ...overlays, ema200: v })} label="EMA200" />
        <Toggle checked={overlays.supertrend} onChange={(v) => onOverlaysChange({ ...overlays, supertrend: v })} label="Supertrend" />
        <Toggle checked={overlays.bollinger} onChange={(v) => onOverlaysChange({ ...overlays, bollinger: v })} label="Bollinger" />
        <Toggle checked={overlays.keltner} onChange={(v) => onOverlaysChange({ ...overlays, keltner: v })} label="Keltner" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted">Panes</span>
        <Toggle checked={panes.volume} onChange={(v) => onPanesChange({ ...panes, volume: v })} label="Volume" />
        <Toggle checked={panes.macd} onChange={(v) => onPanesChange({ ...panes, macd: v })} label="MACD" />
        <Toggle checked={panes.adx} onChange={(v) => onPanesChange({ ...panes, adx: v })} label="ADX" />
        <Toggle checked={panes.rvol} onChange={(v) => onPanesChange({ ...panes, rvol: v })} label="RVOL" />
        <Toggle checked={panes.ttm} onChange={(v) => onPanesChange({ ...panes, ttm: v })} label="TTM" />
      </div>

      <div className="flex items-center gap-2">
        <Toggle checked={showConfluenceMarkers} onChange={onShowConfluenceMarkersChange} label="Include Confluence" />
      </div>
    </div>
  )
}
