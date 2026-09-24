import { useEffect, type ReactNode } from 'react'
import { useSettings } from './settings'

/**
 * Applies `data-theme` to <html> based on the persisted theme setting.
 * 'system' removes the attribute entirely so the `prefers-color-scheme`
 * media query in index.css takes over.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const { settings } = useSettings()

  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', settings.theme)
    }
  }, [settings.theme])

  return children
}

/** Cycles light -> dark -> system -> light ... for the theme toggle button. */
export function nextTheme(current: 'light' | 'dark' | 'system'): 'light' | 'dark' | 'system' {
  if (current === 'light') return 'dark'
  if (current === 'dark') return 'system'
  return 'light'
}
