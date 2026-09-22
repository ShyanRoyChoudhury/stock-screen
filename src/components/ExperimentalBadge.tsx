const TOOLTIP = 'Yahoo intraday feed is unreliable; do not trade 1h/4h signals from it'

export function ExperimentalBadge() {
  return (
    <span
      className="inline-flex items-center rounded border border-warn text-warn px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      title={TOOLTIP}
    >
      experimental
    </span>
  )
}
