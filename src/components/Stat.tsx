import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  delta?: ReactNode
  deltaClassName?: string
}

export function Stat({ label, value, delta, deltaClassName = '' }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="num text-lg font-semibold">{value}</span>
      {delta !== undefined && <span className={`num text-xs ${deltaClassName}`}>{delta}</span>}
    </div>
  )
}
