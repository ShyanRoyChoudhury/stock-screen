// Reads chart colours from the vendored design system's CSS token variables
// (design/design-system/tokens.css, loaded via src/ds/tokens.css) — never
// hard-coded. See BUILD_BRIEF.md "Design tokens" and the Deliverable 1 task
// spec for the exact variable names the chart must read.

export interface ChartTokens {
  bg: string
  grid: string
  muted: string
  line: string
  ink: string
  accent: string
  up: string
  down: string
  volumeUp: string
  volumeDown: string
  ema50: string
  ema200: string
  bbBand: string
  kcBand: string
  macdLine: string
  macdSignal: string
  levelEntry: string
  levelStop: string
  levelTrail: string
  levelTarget: string
  markerAction: string
  markerDemerger: string
}

const VAR_MAP: Record<keyof ChartTokens, string> = {
  bg: '--surface-sunken',
  grid: '--chart-grid',
  muted: '--ink-muted',
  line: '--line',
  ink: '--ink',
  accent: '--accent',
  up: '--candle-up',
  down: '--candle-down',
  volumeUp: '--volume-up',
  volumeDown: '--volume-down',
  ema50: '--ema-50',
  ema200: '--ema-200',
  bbBand: '--bb-band',
  kcBand: '--kc-band',
  macdLine: '--macd-line',
  macdSignal: '--macd-signal',
  levelEntry: '--level-entry',
  levelStop: '--level-stop',
  levelTrail: '--level-trail',
  levelTarget: '--level-target',
  markerAction: '--marker-action',
  markerDemerger: '--marker-demerger',
}

// Dark-theme fallbacks (tokens.css dark values), only used if a variable somehow
// resolves empty (e.g. in tests without the stylesheet loaded).
const FALLBACK: ChartTokens = {
  bg: '#07090d',
  grid: '#1a2029',
  muted: '#9ba5b4',
  line: '#232a35',
  ink: '#e7eaf0',
  accent: '#5aa9ff',
  up: '#3ecf8e',
  down: '#ff6b6b',
  volumeUp: '#1f5a41',
  volumeDown: '#6a2a2f',
  ema50: '#f2b33d',
  ema200: '#e879c9',
  bbBand: '#7f95ff',
  kcBand: '#43c6c6',
  macdLine: '#5aa9ff',
  macdSignal: '#ff9a4d',
  levelEntry: '#e7eaf0',
  levelStop: '#ff6b6b',
  levelTrail: '#ff9a4d',
  levelTarget: '#3ecf8e',
  markerAction: '#9ba5b4',
  markerDemerger: '#b9a2ff',
}

/** Reads the current values of the design-token CSS variables from <html>. */
export function readChartTokens(): ChartTokens {
  if (typeof document === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const out = {} as ChartTokens
  for (const key of Object.keys(VAR_MAP) as (keyof ChartTokens)[]) {
    const value = style.getPropertyValue(VAR_MAP[key]).trim()
    out[key] = value || FALLBACK[key]
  }
  return out
}

/** Adds alpha to a `#rgb`/`#rrggbb` colour string. Returns the input unchanged if unparseable. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const hex = m[1]
  let r: number
  let g: number
  let b: number
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16)
    g = parseInt(hex[1] + hex[1], 16)
    b = parseInt(hex[2] + hex[2], 16)
  } else {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Notifies `onChange` whenever the active theme could have changed: an explicit
 * `data-theme` attribute change on <html>, or a `prefers-color-scheme` flip.
 * Returns an unsubscribe function.
 */
export function watchThemeChanges(onChange: () => void): () => void {
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === 'data-theme')) onChange()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = () => onChange()
  media.addEventListener('change', listener)

  return () => {
    observer.disconnect()
    media.removeEventListener('change', listener)
  }
}
