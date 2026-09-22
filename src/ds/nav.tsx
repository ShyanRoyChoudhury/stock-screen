// Ported from design/design-system/src/index.jsx: NavRail, SessionBar, Tabs, FilterChip.
// NavRail differs from the prototype: Settings/account are real buttons with
// onSettings/onAccount callbacks instead of a container click-listener hack.

import { useState, type ReactElement, type ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './icons'
import { NAV } from './labels'
import { Badge, Kbd, StatusDot } from './primitives'
import { fmt } from './fmt'
import type { NavItem } from './types'

export interface NavRailProps {
  items?: NavItem[]
  current?: string | null
  counts?: Record<string, number>
  user?: { name: string }
  collapsed?: boolean
  onNavigate?: (id: string) => void
  onSettings?: () => void
  onAccount?: () => void
}

export function NavRail({ items = NAV, current = 'today', counts = {}, user = { name: 'Shyan' }, collapsed, onNavigate, onSettings, onAccount }: NavRailProps): ReactElement {
  return (
    <nav className={cx('ss', 'ss-nav', collapsed && 'ss-nav-collapsed')} aria-label="Main">
      <div className="ss-nav-brand">
        <span className="ss-nav-brand-mark">{'▮▯'}</span>
        {collapsed ? null : 'STOCK SCREEN'}
      </div>
      <ul className="ss-nav-list">
        {items.map((it, i) =>
          it.section ? (
            collapsed ? null : (
              <li key={'s' + i} className="ss-nav-sect ss-label">
                {it.section}
              </li>
            )
          ) : (
            <li key={it.id}>
              <button
                type="button"
                className="ss-nav-item"
                aria-current={it.id === current ? 'page' : undefined}
                aria-disabled={it.disabled || undefined}
                onClick={() => it.id && !it.disabled && onNavigate && onNavigate(it.id)}
                title={collapsed ? it.label : undefined}
              >
                {it.icon ? <Icon name={it.icon} /> : null}
                {collapsed ? null : it.label}
                {!collapsed && it.id && counts[it.id] ? <span className="ss-nav-count">{counts[it.id]}</span> : null}
                {!collapsed && it.badge ? (
                  <span style={{ marginLeft: 'auto' }}>
                    <Badge>{it.badge}</Badge>
                  </span>
                ) : null}
                {!collapsed && it.kbd ? <Kbd keys={it.kbd} /> : null}
              </button>
            </li>
          ),
        )}
      </ul>
      <div className="ss-nav-foot">
        <button type="button" className="ss-nav-item" aria-haspopup="menu" onClick={onSettings}>
          <Icon name="settings" />
          {collapsed ? null : 'Settings'}
        </button>
        <button type="button" className="ss-nav-item" aria-haspopup="menu" onClick={onAccount}>
          <span className="ss-avatar">{(user.name || '?').slice(0, 1)}</span>
          {collapsed ? null : user.name}
        </button>
      </div>
    </nav>
  )
}

export interface SessionBarProps {
  session: string
  pipeline?: 'ok' | 'running' | 'warning' | 'failed'
  pipelineAt?: string
  dataNote?: ReactNode
  children?: ReactNode
}

export function SessionBar({ session, pipeline = 'ok', pipelineAt, dataNote, children }: SessionBarProps): ReactElement {
  return (
    <div className="ss ss-session" role="banner">
      <span className="ss-session-item">
        <span className="ss-label">Session</span>
        <span className="ss-session-date">{fmt.date(session, true)}</span>
      </span>
      <span className="ss-session-sep" />
      <span className="ss-session-item ss-muted">EOD · close 15:30 IST</span>
      <span className="ss-session-sep" />
      <span className="ss-session-item">
        <span className="ss-label">Daily job</span>
        <StatusDot status={pipeline}>
          {pipeline === 'running' ? 'Running' : pipeline === 'failed' ? 'Failed' : pipeline === 'warning' ? 'Degraded' : 'OK'}
          {pipelineAt ? ' · ' + fmt.time(pipelineAt) : ''}
        </StatusDot>
      </span>
      {dataNote ? (
        <>
          <span className="ss-session-sep" />
          <span className="ss-session-item ss-muted">{dataNote}</span>
        </>
      ) : null}
      <span className="ss-spacer" />
      {children}
    </div>
  )
}

export interface TabItem {
  id: string
  label: ReactNode
  count?: number
  experimental?: boolean
  title?: string
}

export interface TabsProps {
  items: TabItem[]
  value?: string
  onChange?: (id: string) => void
  variant?: 'tabs' | 'segmented'
  ariaLabel?: string
}

export function Tabs({ items, value, onChange, variant = 'tabs', ariaLabel }: TabsProps): ReactElement {
  const [v, setV] = useState(value ?? (items[0] && items[0].id))
  const cur = value ?? v
  return (
    <div className={cx('ss', variant === 'segmented' ? 'ss-seg' : 'ss-tabs')} role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          className="ss-tab"
          aria-selected={cur === it.id}
          onClick={() => {
            setV(it.id)
            onChange && onChange(it.id)
          }}
          title={it.title}
        >
          {it.label}
          {it.count != null ? <span className="ss-tab-count">{it.count}</span> : null}
          {it.experimental ? <span className="ss-tab-exp">EXP</span> : null}
        </button>
      ))}
    </div>
  )
}

export interface FilterChipProps {
  label: string
  value?: ReactNode
  active?: boolean
  onClear?: () => void
  onClick?: () => void
}

export function FilterChip({ label, value, active, onClear, onClick }: FilterChipProps): ReactElement {
  const on = active ?? value != null
  return (
    <button type="button" className={cx('ss', 'ss-fchip', on && 'ss-fchip-on', !on && 'ss-fchip-plus')} onClick={onClick}>
      <span className="ss-fchip-k">{on ? label : '+ ' + label}</span>
      {on && value != null ? <span className="ss-fchip-v">{value}</span> : null}
      {on && onClear ? (
        <span
          className="ss-fchip-x"
          role="button"
          aria-label={'Clear ' + label}
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
        >
          {'×'}
        </span>
      ) : null}
    </button>
  )
}
