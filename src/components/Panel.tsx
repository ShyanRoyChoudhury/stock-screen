import type { ReactNode } from 'react'

interface PanelProps {
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export function Panel({ title, actions, children, className = '' }: PanelProps) {
  return (
    <section className={`rounded border border-border bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  )
}
