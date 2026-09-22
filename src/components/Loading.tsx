interface LoadingProps {
  label?: string
}

export function Loading({ label = 'Loading…' }: LoadingProps) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted" role="status" aria-live="polite">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label}
    </div>
  )
}
