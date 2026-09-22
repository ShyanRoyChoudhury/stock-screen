interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className="inline-flex items-center gap-2 text-sm select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? 'bg-accent border-accent' : 'bg-surface-2 border-border'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-surface transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      {label && <span>{label}</span>}
    </label>
  )
}
