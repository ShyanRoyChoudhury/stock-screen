// Forces a re-render (and therefore re-derivation of any `readChartTokens()`-based
// colour, e.g. marker/price-line colours computed in this page) whenever the
// active theme changes. The CandleChart component recolours its own series
// independently; this hook keeps this page's own token-derived values in sync too.

import { useEffect, useState } from 'react'
import { watchThemeChanges } from '../../charts/colors'

export function useThemeTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => watchThemeChanges(() => setTick((t) => t + 1)), [])
  return tick
}
