import type { CSSProperties, ReactNode } from 'react'
import { STRATEGY_BY_KEY, VERDICT_BY_KEY } from '../lib/domain'
import type { Strategy, Verdict } from '../api/types'

export type ChipVariant = 'verdict' | 'strategy' | 'status' | 'neutral'

interface ChipProps {
  variant: ChipVariant
  /** verdict key, strategy key, or a status string (ok/auth_failed/error/running/completed/failed/...) */
  value?: string
  /** Overrides the auto-derived label text. Verdict chips always carry a text label, never colour alone. */
  children?: ReactNode
  title?: string
}

const STATUS_TOKEN: Record<string, string> = {
  ok: 'up',
  completed: 'up',
  running: 'accent',
  auth_failed: 'down',
  error: 'down',
  failed: 'down',
  active: 'up',
  inactive: 'muted',
}

// Full literal class strings, so Tailwind's build-time scanner can find them
// (template-literal class names like `text-${token}` are invisible to it).
const TOKEN_CLASSES: Record<string, string> = {
  exit: 'text-exit border-exit',
  partial: 'text-partial border-partial',
  review: 'text-review border-review',
  hold: 'text-hold border-hold',
  up: 'text-up border-up',
  down: 'text-down border-down',
  accent: 'text-accent border-accent',
  muted: 'text-muted border-muted',
}

const TOKEN_BG_VAR: Record<string, string> = {
  exit: '--color-exit',
  partial: '--color-partial',
  review: '--color-review',
  hold: '--color-hold',
  up: '--color-up',
  down: '--color-down',
  accent: '--color-accent',
  muted: '--color-muted',
}

const baseClass = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium border whitespace-nowrap'

function tokenStyle(token: string): CSSProperties {
  const cssVar = TOKEN_BG_VAR[token] ?? '--color-muted'
  return { backgroundColor: `color-mix(in srgb, var(${cssVar}) 12%, transparent)` }
}

export function Chip({ variant, value, children, title }: ChipProps) {
  const label = children ?? value ?? ''

  if (variant === 'verdict' && value) {
    const meta = VERDICT_BY_KEY[value as Verdict]
    const token = meta?.colour ?? 'muted'
    return (
      <span className={`${baseClass} ${TOKEN_CLASSES[token] ?? TOKEN_CLASSES.muted}`} style={tokenStyle(token)} title={title ?? meta?.meaning}>
        {label}
      </span>
    )
  }

  if (variant === 'strategy' && value) {
    const meta = STRATEGY_BY_KEY[value as Strategy]
    const colour = meta?.colour ?? '#5b6470'
    return (
      <span
        className={baseClass}
        style={{ color: colour, borderColor: colour, backgroundColor: `${colour}1f` }}
        title={title ?? meta?.description}
      >
        {label}
      </span>
    )
  }

  if (variant === 'status' && value) {
    const token = STATUS_TOKEN[value] ?? 'muted'
    return (
      <span className={`${baseClass} ${TOKEN_CLASSES[token] ?? TOKEN_CLASSES.muted}`} style={tokenStyle(token)} title={title}>
        {label}
      </span>
    )
  }

  return (
    <span className={`${baseClass} text-muted border-border bg-surface-2`} title={title}>
      {label}
    </span>
  )
}
