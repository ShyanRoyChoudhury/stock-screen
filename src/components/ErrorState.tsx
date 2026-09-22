import { Link } from 'react-router'
import { ApiError } from '../api/types'

interface ErrorStateProps {
  error: unknown
  title?: string
}

export function ErrorState({ error, title = 'Something went wrong' }: ErrorStateProps) {
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
  const status = error instanceof ApiError ? error.status : undefined

  return (
    <div className="flex flex-col gap-1 rounded border border-exit/30 bg-surface px-3 py-2 text-sm">
      <p className="font-medium text-exit">{title}</p>
      <p className="text-muted">{message}</p>
      {status === 401 && (
        <Link to="/settings" className="text-accent underline w-fit">
          Set API key
        </Link>
      )}
    </div>
  )
}
