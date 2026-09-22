// Ported from design/design-system/src/index.jsx: Banner, EmptyState.

import type { ReactElement, ReactNode } from 'react'
import { cx } from './cx'

const BICON: Record<string, string> = { failed: '×', degraded: '!', review: '?', info: 'i' }

export interface BannerProps {
  tone?: 'failed' | 'degraded' | 'review' | 'info'
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
  role?: string
}

export function Banner({ tone = 'info', title, children, actions, role }: BannerProps): ReactElement {
  return (
    <div className={cx('ss', 'ss-banner', 'ss-banner-' + tone)} role={role || (tone === 'failed' ? 'alert' : 'status')}>
      <span className="ss-banner-icon" aria-hidden="true">
        {BICON[tone]}
      </span>
      <div className="ss-banner-body">
        <p className="ss-banner-title">{title}</p>
        {children ? <p className="ss-banner-text">{children}</p> : null}
      </div>
      {actions ? <div className="ss-banner-actions">{actions}</div> : null}
    </div>
  )
}

export interface EmptyStateProps {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  glyph?: string
}

export function EmptyState({ title, children, action, glyph = '— — —' }: EmptyStateProps): ReactElement {
  return (
    <div className="ss ss-empty">
      <span className="ss-empty-glyph" aria-hidden="true">
        {glyph}
      </span>
      <p className="ss-empty-title">{title}</p>
      {children ? <p className="ss-empty-text">{children}</p> : null}
      {action || null}
    </div>
  )
}
