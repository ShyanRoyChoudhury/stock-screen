import type { SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[]
  onChange: (value: string) => void
}

export function Select({ options, onChange, className = '', ...rest }: SelectProps) {
  return (
    <select
      className={`rounded border border-border bg-surface px-2 py-1 text-sm text-text focus-visible:outline-none ${className}`}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
