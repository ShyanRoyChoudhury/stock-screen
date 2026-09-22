// Persists chart overlay/pane toggle state (and the "include Confluence"
// switch) in sessionStorage, try/catch wrapped per BUILD_BRIEF's storage rule.
// KEEP from the prior implementation; shape bumped to v2 for the new
// CandleChart contract (volume is no longer a toggle — always on).

import type { CandleChartOverlays, CandleChartPanes } from '../../charts/CandleChart'

const KEY = 'ss.symbolChart.v2'

export interface ChartToggleState {
  overlays: CandleChartOverlays
  panes: CandleChartPanes
  showConfluence: boolean
}

export const DEFAULT_TOGGLES: ChartToggleState = {
  overlays: { ema50: true, ema200: true, supertrend: true, bollinger: false, keltner: false },
  panes: { macd: true, adx: false, rvol: false, ttm: false },
  showConfluence: false,
}

export function readToggleState(): ChartToggleState {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return DEFAULT_TOGGLES
    const parsed = JSON.parse(raw) as Partial<ChartToggleState>
    return {
      overlays: { ...DEFAULT_TOGGLES.overlays, ...parsed.overlays },
      panes: { ...DEFAULT_TOGGLES.panes, ...parsed.panes },
      showConfluence: parsed.showConfluence ?? DEFAULT_TOGGLES.showConfluence,
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
