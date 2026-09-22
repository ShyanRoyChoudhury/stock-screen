import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useBrokerAccounts, useMe, usePositions, useRuns, useSignals, useSymbols } from '../api/hooks'
import type { Symbol as SymbolRow } from '../api/types'
import { Button, fmt, Icon, NAV, NavRail, SessionBar } from '../ds'
import { istDateKey } from '../lib/format'
import { useSettings } from '../lib/settings'
import { useToastList } from '../lib/toast'

interface ShellProps {
  children: ReactNode
}

/** `/` -> today, `/positions/:id` -> positions, `/symbols/:x` -> none (null), etc. */
function navCurrent(pathname: string): string | null {
  if (pathname === '/') return 'today'
  if (pathname.startsWith('/signals')) return 'signals'
  if (pathname.startsWith('/positions')) return 'positions'
  if (pathname.startsWith('/symbols')) return null
  if (pathname.startsWith('/trades')) return 'trades'
  if (pathname.startsWith('/brokers')) return 'brokers'
  if (pathname.startsWith('/ops')) return 'ops'
  if (pathname.startsWith('/options')) return 'options'
  if (pathname.startsWith('/settings')) return 'settings'
  return null
}

function SymbolSearch({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { data: symbols } = useSymbols()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const res = useMemo(() => {
    const list = symbols ?? []
    const needle = q.toUpperCase()
    return list.filter((s: SymbolRow) => !q || s.symbol.includes(needle) || (s.name ?? '').toUpperCase().includes(needle)).slice(0, 8)
  }, [symbols, q])

  const pick = (s: SymbolRow) => {
    onClose()
    navigate(`/symbols/${s.symbol}`)
  }

  return (
    <div className="app-modal" role="dialog" aria-label="Find symbol" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="app-modal-box">
        <input
          ref={ref}
          id="sym-search"
          className="ss-input ss-input-mono app-search"
          placeholder="Symbol or company"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setI(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setI((x) => Math.min(res.length - 1, x + 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setI((x) => Math.max(0, x - 1))
            }
            if (e.key === 'Enter' && res[i]) pick(res[i])
          }}
        />
        <div className="app-search-list">
          {res.map((s: SymbolRow, k: number) => (
            <button
              type="button"
              key={s.symbol}
              className={'app-search-item' + (k === i ? ' on' : '')}
              onMouseEnter={() => setI(k)}
              onClick={() => pick(s)}
            >
              <span className="ss-sym ss-mono">{s.symbol}</span>
              <span className="ss-muted app-trunc">{s.name}</span>
              <span className="ss-spacer" />
              <span className="ss-faint app-small">{s.industry}</span>
            </button>
          ))}
          {!res.length ? <div className="ss-muted" style={{ padding: 12 }}>No Nifty 500 symbol matches "{q}".</div> : null}
        </div>
      </div>
    </div>
  )
}

export function Shell({ children }: ShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { settings } = useSettings()
  const hasKey = !!settings.apiKey
  const toasts = useToastList()
  const [search, setSearch] = useState(false)

  const { data: runsData } = useRuns(30)
  const { data: freshSignals } = useSignals({ timeframe: '1d', limit: 1 })
  const { data: me } = useMe({ enabled: hasKey })
  const { data: openPositions } = usePositions('open', { enabled: hasKey })
  const { data: brokerAccounts } = useBrokerAccounts({ enabled: hasKey })

  // scroll to top on route change
  useEffect(() => {
    const m = document.querySelector('.ss-main')
    if (m) m.scrollTop = 0
    window.scrollTo(0, 0)
  }, [location.pathname])

  // keyboard: g + letter navigates, "/" opens search, Escape closes it
  useEffect(() => {
    let g = 0
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if ((t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        setSearch(true)
        return
      }
      if (e.key === 'Escape') {
        setSearch(false)
        return
      }
      if (e.key === 'g') {
        g = Date.now()
        return
      }
      if (Date.now() - g < 900) {
        const map: Record<string, string> = { t: '/', s: '/signals', p: '/positions', r: '/trades', b: '/brokers', o: '/ops' }
        const path = map[e.key]
        if (path) {
          e.preventDefault()
          navigate(path)
        }
        g = 0
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const runs = runsData ?? []
  const todayKey = istDateKey(new Date().toISOString()) ?? ''
  const latestSignal = freshSignals?.[0]
  const session = (latestSignal ? istDateKey(latestSignal.ts) : null) ?? todayKey
  const sessRuns = runs.filter((r) => istDateKey(r.started_at) === session)
  const running = runs.find((r) => r.status === 'running')
  const pipeline: 'ok' | 'running' | 'warning' | 'failed' = running
    ? 'running'
    : sessRuns.some((r) => r.status === 'failed' && (r.mode === 'incremental' || r.mode === 'backfill'))
      ? 'failed'
      : sessRuns.some((r) => r.status === 'failed' || r.symbols_failed)
        ? 'warning'
        : 'ok'
  const pipelineAt = sessRuns
    .map((r) => r.finished_at)
    .filter((x): x is string => !!x)
    .sort()
    .pop()
  const dataNote = running ? `${running.mode} ${running.symbols_ok}/${running.symbols_total}` : `1d candles to ${fmt.date(session).replace(/ \d{4}$/, '')}`

  const positionsCount = hasKey ? (openPositions ?? []).filter((p) => p.last_verdict && p.last_verdict !== 'HOLD').length : 0
  const brokersCount = hasKey ? (brokerAccounts ?? []).filter((a) => a.active && (a.last_sync_status === 'auth_failed' || a.last_sync_status === 'error')).length : 0
  const userName = me?.name || '—'
  const navCur = navCurrent(location.pathname)
  const page = navCur

  return (
    <div className="ss ss-app app-shell">
      <div className="app-nav">
        <NavRail
          current={navCur}
          counts={{ positions: positionsCount, brokers: brokersCount }}
          user={{ name: userName }}
          onNavigate={(id) => navigate(id === 'today' ? '/' : `/${id}`)}
          onSettings={() => navigate('/settings')}
          onAccount={() => navigate('/settings')}
        />
      </div>
      <div className="ss-main">
        <SessionBar session={session} pipeline={pipeline} pipelineAt={pipelineAt} dataNote={dataNote}>
          <Button size="sm" variant="ghost" icon="search" kbd="/" onClick={() => setSearch(true)}>
            Symbol
          </Button>
        </SessionBar>
        <nav className="app-mnav" aria-label="Main (mobile)">
          {NAV.filter((n) => n.id && !n.disabled).map((n) => (
            <button type="button" key={n.id} aria-current={navCur === n.id ? 'page' : undefined} onClick={() => navigate(n.id === 'today' ? '/' : `/${n.id}`)}>
              {n.icon ? <Icon name={n.icon} /> : null}
              {n.label}
              {n.id === 'positions' && positionsCount ? <span className="ss-nav-count">{positionsCount}</span> : null}
            </button>
          ))}
          <button type="button" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => navigate('/settings')}>
            <Icon name="settings" />
            Settings
          </button>
        </nav>
        <main className="app-body">{children}</main>
      </div>
      {search ? <SymbolSearch onClose={() => setSearch(false)} /> : null}
      <div className="app-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="app-toast">
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
