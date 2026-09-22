import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white border-accent hover:opacity-90',
  secondary: 'bg-surface text-text border-border hover:bg-surface-2',
  danger: 'bg-down text-white border-down hover:opacity-90',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-xs px-2 py-1',
  md: 'text-sm px-3 py-1.5',
}

export function Button({ variant = 'secondary', size = 'md', className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-1.5 rounded border font-medium transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(' ')}
      disabled={disabled}
      {...rest}
    />
  )
}
