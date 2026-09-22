import type { ReactNode } from 'react'
import { STRATEGY_BY_KEY, TIMEFRAMES } from '../../lib/domain'
import { ExperimentalBadge } from '../../components/ExperimentalBadge'
import { Select } from '../../components/Select'
import type { Strategy, Timeframe } from '../../api/types'
import type { SignalMode } from './url'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  )
}

const inputClass = 'rounded border border-border bg-surface px-2 py-1 text-sm text-text focus-visible:outline-none'

function StrategyToggle({ strategy, active, onToggle }: { strategy: Strategy; active: boolean; onToggle: () => void }) {
  const meta = STRATEGY_BY_KEY[strategy]
  return (
    <button
      type="button"
      onClick={onToggle}
      title={meta.description}
      className="rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-opacity"
      style={{
        color: meta.colour,
        borderColor: meta.colour,
        backgroundColor: active ? `${meta.colour}1f` : 'transparent',
        opacity: active ? 1 : 0.45,
      }}
    >
      {meta.label}
    </button>
  )
}

const MODE_OPTIONS: { value: SignalMode; label: string }[] = [
  { value: 'event', label: 'Event signals' },
  { value: 'confluence', label: 'Confluence' },
  { value: 'all', label: 'All' },
]

interface FilterBarProps {
  mode: SignalMode
  onModeChange: (mode: SignalMode) => void
  timeframe: Timeframe
  onTimeframeChange: (tf: Timeframe) => void
  allowedTimeframes: Timeframe[]
  days: number
  onDaysChange: (days: number) => void
  modeStrategies: Strategy[]
  selectedStrategies: Strategy[]
  onToggleStrategy: (strategy: Strategy) => void
  industry: string
  onIndustryChange: (industry: string) => void
  industries: string[]
  maxRisk: string
  onMaxRiskChange: (value: string) => void
  minRR: string
  onMinRRChange: (value: string) => void
  conviction: string
  onConvictionChange: (value: string) => void
  entryMode: string
  onEntryModeChange: (value: string) => void
  q: string
  onQChange: (value: string) => void
}

export function FilterBar({
  mode,
  onModeChange,
  timeframe,
  onTimeframeChange,
  allowedTimeframes,
  days,
  onDaysChange,
  modeStrategies,
  selectedStrategies,
  onToggleStrategy,
  industry,
  onIndustryChange,
  industries,
  maxRisk,
  onMaxRiskChange,
  minRR,
  onMinRRChange,
  conviction,
  onConvictionChange,
  entryMode,
  onEntryModeChange,
  q,
  onQChange,
}: FilterBarProps) {
  const showConviction = modeStrategies.includes('Confluence')
  const showEntryMode = modeStrategies.includes('PIPELINE')
  const selectedSet = new Set(selectedStrategies)

  return (
    <div className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface px-3 py-2">
      <Field label="Mode">
        <div className="inline-flex overflow-hidden rounded border border-border">
          {MODE_OPTIONS.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onModeChange(opt.value)}
              className={`px-2 py-1 text-xs font-medium ${i > 0 ? 'border-l border-border' : ''} ${
                mode === opt.value ? 'bg-accent text-white' : 'bg-surface text-text hover:bg-surface-2'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Timeframe">
        <div className="flex items-center gap-1.5">
          <Select
            value={timeframe}
            onChange={(v) => onTimeframeChange(v as Timeframe)}
            options={TIMEFRAMES.filter((t) => allowedTimeframes.includes(t.key)).map((t) => ({ value: t.key, label: t.label }))}
          />
          {timeframe !== '1d' && <ExperimentalBadge />}
        </div>
      </Field>

      <Field label="Freshness (days)">
        <input
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(e) => onDaysChange(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
          className={`${inputClass} w-16`}
        />
      </Field>

      <Field label="Strategies">
        <div className="flex flex-wrap gap-1">
          {modeStrategies.map((s) => (
            <StrategyToggle key={s} strategy={s} active={selectedSet.has(s)} onToggle={() => onToggleStrategy(s)} />
          ))}
        </div>
      </Field>

      <Field label="Industry">
        <Select
          value={industry}
          onChange={onIndustryChange}
          options={[{ value: '', label: 'All industries' }, ...industries.map((i) => ({ value: i, label: i }))]}
        />
      </Field>

      <Field label="Max risk %">
        <input
          type="number"
          min={0}
          step={0.5}
          placeholder="—"
          value={maxRisk}
          onChange={(e) => onMaxRiskChange(e.target.value)}
          className={`${inputClass} w-20`}
        />
      </Field>

      <Field label="Min R:R">
        <input
          type="number"
          min={0}
          step={0.1}
          placeholder="—"
          value={minRR}
          onChange={(e) => onMinRRChange(e.target.value)}
          className={`${inputClass} w-20`}
        />
      </Field>

      {showConviction && (
        <Field label="Conviction (Confluence)">
          <Select
            value={conviction}
            onChange={onConvictionChange}
            options={[
              { value: '', label: 'Any' },
              { value: 'HIGH', label: 'HIGH' },
              { value: 'STRONG', label: 'STRONG' },
              { value: 'MODERATE', label: 'MODERATE' },
            ]}
          />
        </Field>
      )}

      {showEntryMode && (
        <Field label="Entry mode (Pipeline)">
          <Select
            value={entryMode}
            onChange={onEntryModeChange}
            options={[
              { value: '', label: 'Any' },
              { value: 'IMMEDIATE', label: 'IMMEDIATE' },
              { value: 'RETEST', label: 'RETEST' },
            ]}
          />
        </Field>
      )}

      <Field label="Symbol / name">
        <input
          type="text"
          placeholder="Search…"
          value={q}
          onChange={(e) => onQChange(e.target.value)}
          className={`${inputClass} w-36`}
        />
      </Field>
    </div>
  )
}
