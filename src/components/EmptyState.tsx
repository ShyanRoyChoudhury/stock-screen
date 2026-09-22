import type { ReactNode } from 'react'

interface EmptyStateProps {
  title?: string
  message?: ReactNode
  action?: ReactNode
}

export function EmptyState({ title = 'Nothing here', message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted">
      <p className="text-sm font-medium text-text">{title}</p>
      {message && <p className="max-w-sm text-xs">{message}</p>}
      {action}
    </div>
  )
}
