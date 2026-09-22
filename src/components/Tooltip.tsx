import type { ReactNode } from 'react'

interface TooltipProps {
  text: string
  children: ReactNode
  className?: string
}

/** CSS/title-based tooltip: wraps children in a span with a native `title`. */
export function Tooltip({ text, children, className = '' }: TooltipProps) {
  return (
    <span title={text} className={`cursor-help border-b border-dotted border-muted ${className}`}>
      {children}
    </span>
  )
}
