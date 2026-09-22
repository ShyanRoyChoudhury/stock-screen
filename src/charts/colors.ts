// Reads chart colours from the design-token CSS variables (never hard-coded),
// and notifies callers when the active theme changes so charts can recolour.
// See BUILD_BRIEF.md "Design tokens" and the task's chart colour rules.

export interface ChartTokens {
  bg: string
  surface2: string
  border: string
  text: string
  muted: string
  accent: string
  up: string
  down: string
  warn: string
  exit: string
  partial: string
  review: string
  hold: string
}

const VAR_MAP: Record<keyof ChartTokens, string> = {
  bg: '--color-surface',
  surface2: '--color-surface-2',
  border: '--color-border',
  text: '--color-text',
  muted: '--color-muted',
  accent: '--color-accent',
  up: '--color-up',
  down: '--color-down',
  warn: '--color-warn',
  exit: '--color-exit',
  partial: '--color-partial',
  review: '--color-review',
  hold: '--color-hold',
}

// Light-theme fallbacks, only used if a variable somehow resolves empty (e.g. in tests).
const FALLBACK: ChartTokens = {
  bg: '#ffffff',
  surface2: '#eef0f3',
  border: '#d9dde3',
  text: '#14171c',
  muted: '#5b6470',
  accent: '#2563eb',
  up: '#15803d',
  down: '#dc2626',
  warn: '#b45309',
  exit: '#dc2626',
  partial: '#d97706',
  review: '#7c3aed',
  hold: '#64748b',
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
