// Ported from design/design-system/src/index.jsx: PipelineSteps, VerdictTimeline, BrokerCard, CorpActionMarker.

import type { ReactElement, ReactNode } from 'react'
import { cx } from './cx'
import { fmt } from './fmt'
import { labels } from './labels'
import { Badge, Button, CodeList, StatusDot, VerdictChip } from './primitives'
import { Num } from './numbers'
import type { Code, RunStatus, Verdict } from './types'

export interface Step {
  name: string
  status: RunStatus
  finishedAt?: string
  counts?: ReactNode
  message?: ReactNode
  progress?: number
}

export function PipelineSteps({ steps }: { steps: Step[] }): ReactElement {
  return (
    <ol className="ss ss-steps">
      {steps.map((s, i) => (
        <li key={i} className={cx('ss-step', 'ss-step-' + (s.status || 'pending'))}>
          <StatusDot status={s.status} bare />
          <span className="ss-step-name">
            {s.name}
            {s.message ? <span className="ss-step-msg">{s.message}</span> : null}
          </span>
          <span className="ss-step-counts">{s.counts || ''}</span>
          <span className="ss-step-time">{s.status === 'running' ? (s.progress != null ? Math.round(s.progress * 100) + '%' : '…') : s.finishedAt ? fmt.time(s.finishedAt, false) : '—'}</span>
        </li>
      ))}
    </ol>
  )
}

export interface Evaluation {
  as_of: string
  verdict: Verdict
  close: number
  stop_level: number
  trail_level?: number
  reasons?: Code[]
  warnings?: Code[]
  unrealized_pnl_pct?: number
  days_held?: number
}

export function VerdictTimeline({ entries }: { entries: Evaluation[] }): ReactElement {
  return (
    <ol className="ss ss-tl">
      {entries.map((e, i) => {
        const prev = entries[i + 1]
        const changed = prev && prev.verdict !== e.verdict
        return (
          <li key={e.as_of} className={cx('ss-tl-row', changed && 'ss-tl-change')}>
            <span className="ss-tl-date">
              <b>{fmt.date(e.as_of).replace(/ \d{4}$/, '')}</b>
              {e.days_held != null ? ' · d' + e.days_held : ''}
            </span>
            <span>
              <VerdictChip verdict={e.verdict} size="sm" />
            </span>
            <span>
              <span className="ss-tl-levels">
                <span>
                  <span className="ss-label">Close</span>
                  <Num value={e.close} />
                </span>
                <span>
                  <span className="ss-label">Stop</span>
                  <Num value={e.stop_level} />
                </span>
                {e.trail_level != null && e.trail_level !== e.stop_level ? (
                  <span>
                    <span className="ss-label">Trail</span>
                    <Num value={e.trail_level} />
                  </span>
                ) : null}
                {e.unrealized_pnl_pct != null ? (
                  <span>
                    <span className="ss-label">P&amp;L</span>
                    <Num kind="frac" value={e.unrealized_pnl_pct} signed tone="auto" />
                  </span>
                ) : null}
              </span>
              {(e.reasons && e.reasons.length) || (e.warnings && e.warnings.length) ? (
                <div className="ss-tl-codes">
                  <CodeList reasons={e.reasons} warnings={e.warnings} />
                </div>
              ) : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export interface BrokerAccount {
  id: number
  broker: 'groww' | 'zerodha' | string
  label: string
  active: boolean
  last_sync_on: string | null
  last_sync_status: 'ok' | 'auth_failed' | 'error' | null
  last_sync_message: string | null
  created_at: string
}

export interface BrokerCardProps {
  account: BrokerAccount
  lastTradingDay?: string
  onTest?: () => void
  onSync?: () => void
  onImport?: () => void
  onDeactivate?: () => void
  busy?: boolean
}

export function BrokerCard({ account, lastTradingDay, onTest, onSync, onImport, onDeactivate, busy }: BrokerCardProps): ReactElement {
  const a = account
  const failed = a.last_sync_status === 'auth_failed' || a.last_sync_status === 'error'
  const stale = !failed && a.active && !!a.last_sync_on && !!lastTradingDay && a.last_sync_on !== lastTradingDay
  const noClient = a.broker === 'zerodha'
  return (
    <div className={cx('ss', 'ss-broker', failed && 'ss-broker-failed', stale && 'ss-broker-stale', !a.active && 'ss-broker-inactive')}>
      <div className="ss-broker-head">
        <span className="ss-broker-name">{a.label}</span>
        <Badge tone="solid">{a.broker}</Badge>
        {noClient ? <Badge>CSV import only</Badge> : null}
        {!a.active ? <Badge>Inactive</Badge> : null}
        <span className="ss-spacer" />
        <StatusDot status={a.last_sync_status || 'never'} />
      </div>
      <div className="ss-broker-meta">
        <span className="ss-label">Last sync</span>
        <span className={cx('ss-n', stale && 'ss-down')}>
          {a.last_sync_on ? fmt.date(a.last_sync_on, true) : 'Never'}
          {stale ? ' · behind' : ''}
        </span>
        <span className="ss-label">Linked</span>
        <span className="ss-n ss-muted">{fmt.date(a.created_at)}</span>
      </div>
      {a.last_sync_message ? <div className="ss-broker-msg">{a.last_sync_message}</div> : null}
      {failed || stale ? (
        <div className="ss-broker-urgent">
          <b>Import today’s tradebook.</b> Groww’s API only returns the current day’s trades — fills from {fmt.date(lastTradingDay || a.last_sync_on || '')} are lost to sync unless you upload the CSV.
        </div>
      ) : null}
      <div className="ss-broker-actions">
        {failed || stale ? (
          <Button variant="danger" size="sm" icon="upload" onClick={onImport}>
            Import tradebook CSV
          </Button>
        ) : null}
        <Button size="sm" icon="sync" onClick={onSync} loading={busy} disabled={noClient || !a.active}>
          Sync now
        </Button>
        <Button size="sm" onClick={onTest} disabled={noClient || !a.active}>
          Test connection
        </Button>
        {!(failed || stale) ? (
          <Button size="sm" variant="ghost" icon="upload" onClick={onImport}>
            Import CSV
          </Button>
        ) : null}
        <span className="ss-spacer" />
        {a.active ? (
          <Button size="sm" variant="ghost" onClick={onDeactivate}>
            Deactivate
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export interface CorpActionMarkerProps {
  type: 'dividend' | 'split' | 'bonus' | 'rights' | 'demerger'
  exDate?: string
  subject?: string
  showLabel?: boolean
}

export function CorpActionMarker({ type, exDate, subject, showLabel = true }: CorpActionMarkerProps): ReactElement {
  const [g, name] = labels.actions[type] || ['?', type]
  return (
    <span className={cx('ss', 'ss-ca', 'ss-ca-' + type)} title={subject || name}>
      <span className="ss-ca-glyph" aria-hidden="true">
        {g}
      </span>
      {showLabel ? <span>{subject || name}</span> : null}
      {exDate ? <span className="ss-ca-date">ex {fmt.date(exDate)}</span> : null}
      {type === 'demerger' ? <span className="ss-ca-warn">{'⚠ Not price-adjusted'}</span> : null}
    </span>
  )
}
