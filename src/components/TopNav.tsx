import { useState } from 'react'
import { Link, NavLink } from 'react-router'
import { Menu, Monitor, Moon, Sun, X } from 'lucide-react'
import { useMe, useRuns } from '../api/hooks'
import { useSettings } from '../lib/settings'
import { nextTheme } from '../lib/theme'
import { istDateKey } from '../lib/format'
import type { IngestRun } from '../api/types'

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Today', end: true },
  { to: '/signals', label: 'Signals' },
  { to: '/positions', label: 'Positions' },
  { to: '/trades', label: 'Trades' },
  { to: '/brokers', label: 'Brokers' },
  { to: '/ops', label: 'Data & Ops' },
  { to: '/options', label: 'Options' },
  { to: '/settings', label: 'Settings' },
]

type PipelineStatus = 'red' | 'amber' | 'green'

function computePipelineStatus(runs: IngestRun[] | undefined): PipelineStatus {
  if (!runs || runs.length === 0) return 'green'

  const latestByMode = new Map<string, IngestRun>()
  for (const run of runs) {
    if (!latestByMode.has(run.mode)) latestByMode.set(run.mode, run)
  }

  const todayKey = istDateKey(new Date().toISOString())
  const anyFailedToday = Array.from(latestByMode.values()).some(
    (r) => r.status === 'failed' && istDateKey(r.started_at) === todayKey,
  )
  if (anyFailedToday) return 'red'

  if (runs.some((r) => r.status === 'running')) return 'amber'

  return 'green'
}

const DOT_CLASS: Record<PipelineStatus, string> = {
  red: 'bg-down',
  amber: 'bg-partial',
  green: 'bg-up',
}

const DOT_LABEL: Record<PipelineStatus, string> = {
  red: 'Pipeline: a run failed today',
  amber: 'Pipeline: a run is in progress',
  green: 'Pipeline: OK',
}

function PipelineDot() {
  const { data: runs } = useRuns(30)
  const status = computePipelineStatus(runs)
  return <span className={`inline-block h-2 w-2 rounded-full ${DOT_CLASS[status]}`} title={DOT_LABEL[status]} />
}

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor }

function ThemeToggle() {
  const { settings, update } = useSettings()
  const Icon = THEME_ICON[settings.theme]
  return (
    <button
      type="button"
      onClick={() => update('theme', nextTheme(settings.theme))}
      className="flex items-center justify-center rounded border border-border p-1.5 text-muted hover:text-text"
      title={`Theme: ${settings.theme} (click to cycle)`}
      aria-label="Toggle theme"
    >
      <Icon size={14} />
    </button>
  )
}

function AccountChip() {
  const { settings } = useSettings()
  const { data, isError } = useMe()
  const label = !settings.apiKey || isError ? 'No API key' : data?.name ?? '…'
  return (
    <Link to="/settings" className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-text">
      {label}
    </Link>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-2 py-1 rounded text-sm ${isActive ? 'text-text font-semibold bg-surface-2' : 'text-muted hover:text-text'}`

export function TopNav() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-2 border-b border-border bg-surface px-4">
      <div className="flex items-center gap-4">
        <Link to="/" className="text-sm font-bold tracking-tight">
          Stock Screen
        </Link>
        <nav className="hidden items-center gap-0.5 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <PipelineDot />
        <ThemeToggle />
        <AccountChip />
        <button
          type="button"
          className="flex items-center justify-center rounded border border-border p-1.5 md:hidden"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>

      {mobileOpen && (
        <nav className="absolute left-0 right-0 top-12 flex flex-col border-b border-border bg-surface p-2 shadow-md md:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} onClick={() => setMobileOpen(false)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}
