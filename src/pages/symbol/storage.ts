// Persists chart overlay/pane toggle state in sessionStorage, try/catch wrapped
// per BUILD_BRIEF ("Wrap every storage read/write in try/catch").

import type { CandleChartOverlays, CandleChartPanes } from '../../charts/CandleChart'

const KEY = 'ss.symbolChart.v1'

export interface ChartToggleState {
  overlays: CandleChartOverlays
  panes: CandleChartPanes
  showConfluenceMarkers: boolean
}

export const DEFAULT_TOGGLES: ChartToggleState = {
  overlays: { ema50: true, ema200: true, supertrend: true, bollinger: false, keltner: false },
  panes: { volume: true, macd: true, adx: false, rvol: false, ttm: false },
  showConfluenceMarkers: false,
}

export function readToggleState(): ChartToggleState {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return DEFAULT_TOGGLES
    const parsed = JSON.parse(raw) as Partial<ChartToggleState>
    return {
      overlays: { ...DEFAULT_TOGGLES.overlays, ...parsed.overlays },
      panes: { ...DEFAULT_TOGGLES.panes, ...parsed.panes },
      showConfluenceMarkers: parsed.showConfluenceMarkers ?? DEFAULT_TOGGLES.showConfluenceMarkers,
    }
  } catch {
    return DEFAULT_TOGGLES
  }
}

export function writeToggleState(state: ChartToggleState): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // ignore (private mode, quota, etc.)
  }
}
