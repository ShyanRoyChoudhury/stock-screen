// Async-state helpers that the design export doesn't define: loading, error
// and "needs an API key". Built from the DS primitives so pages never reach
// for the legacy `src/components` set.
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'

import { ApiError } from '../api/types'
import { Banner, EmptyState } from './feedback'
import { Button } from './primitives'

export function Loading({ label = 'Loading…' }: { label?: string }): ReactElement {
  return (
    <div className="ss-muted app-small" role="status" aria-live="polite" style={{ padding: 'var(--space-16) 0' }}>
      {label}
    </div>
  )
}

export interface ErrorStateProps {
  error: unknown
  title?: string
}

/** An API/runtime error as a `failed` Banner. 401 carries a "Set API key" action. */
export function ErrorState({ error, title }: ErrorStateProps): ReactElement {
  const navigate = useNavigate()
  const status = error instanceof ApiError ? error.status : undefined
  const message = error instanceof Error ? error.message : String(error)
  return (
    <Banner
      tone="failed"
      title={title ?? (status ? `${status} · ${message}` : message)}
      actions={status === 401 ? <Button size="sm" onClick={() => navigate('/settings')}>Set API key</Button> : undefined}
    >
      {title ? (status ? `${status} · ${message}` : message) : undefined}
    </Banner>
  )
}

export function ApiKeyPrompt({ message }: { message?: string }): ReactElement {
  const navigate = useNavigate()
  return (
    <EmptyState
      title="API key needed"
      action={
        <Button variant="primary" size="sm" onClick={() => navigate('/settings')}>
          Set API key in Settings
        </Button>
      }
    >
      {message ?? 'Positions, trades and broker accounts are per user; the key is sent as X-API-Key.'}
    </EmptyState>
  )
}
