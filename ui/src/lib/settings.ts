import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Timeframe } from '../api/types'

export type ThemePref = 'light' | 'dark' | 'system'
export type Density = 'compact' | 'default'
export type PositionsDefault = 'lot' | 'sym'

export interface Settings {
  apiKey: string
  theme: ThemePref
  defaultTimeframe: Timeframe
  showIntraday: boolean
  density: Density
  positionsDefault: PositionsDefault
}

const STORAGE_KEYS = {
  apiKey: 'ss.apiKey',
  theme: 'ss.theme',
  defaultTimeframe: 'ss.defaultTimeframe',
  showIntraday: 'ss.showIntraday',
  density: 'ss.density',
  positionsDefault: 'ss.positionsDefault',
} as const

const DEFAULTS: Settings = {
  apiKey: '',
  theme: 'system',
  defaultTimeframe: '1d',
  showIntraday: false,
  density: 'default',
  positionsDefault: 'lot',
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore (private mode, quota, SSR, etc.)
  }
}

/** The API key to send as X-API-Key: whatever is in storage, else the dev fallback. */
export function getApiKey(): string {
  const stored = safeGet(STORAGE_KEYS.apiKey)
  if (stored) return stored
  try {
    return import.meta.env.VITE_DEV_API_KEY ?? ''
  } catch {
    return ''
  }
}

export function readSettings(): Settings {
  const theme = safeGet(STORAGE_KEYS.theme)
  const defaultTimeframe = safeGet(STORAGE_KEYS.defaultTimeframe)
  const showIntraday = safeGet(STORAGE_KEYS.showIntraday)
  const density = safeGet(STORAGE_KEYS.density)
  const positionsDefault = safeGet(STORAGE_KEYS.positionsDefault)
  return {
    apiKey: getApiKey(),
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULTS.theme,
    defaultTimeframe: (defaultTimeframe as Timeframe) || DEFAULTS.defaultTimeframe,
    showIntraday: showIntraday === null ? DEFAULTS.showIntraday : showIntraday === 'true',
    density: density === 'compact' || density === 'default' ? density : DEFAULTS.density,
    positionsDefault: positionsDefault === 'lot' || positionsDefault === 'sym' ? positionsDefault : DEFAULTS.positionsDefault,
  }
}

function writeSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (key === 'apiKey') {
    safeSet(STORAGE_KEYS.apiKey, String(value))
    return
  }
  if (key === 'showIntraday') {
    safeSet(STORAGE_KEYS.showIntraday, value ? 'true' : 'false')
    return
  }
  safeSet(STORAGE_KEYS[key], String(value))
}

interface SettingsContextValue {
  settings: Settings
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => readSettings())

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    writeSetting(key, value)
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  const value = useMemo(() => ({ settings, update }), [settings, update])

  return createElement(SettingsContext.Provider, { value }, children)
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
