import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useMe } from '../../api/hooks'
import { useSettings, type ThemePref } from '../../lib/settings'
import { Panel } from '../../components/Panel'
import { Button } from '../../components/Button'
import { Select } from '../../components/Select'
import { Toggle } from '../../components/Toggle'
import { ApiError, type Timeframe } from '../../api/types'
import { TIMEFRAMES } from '../../lib/domain'

export default function SettingsPage() {
  const { settings, update } = useSettings()
  const [showKey, setShowKey] = useState(false)
  const me = useMe()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted">API key, theme and display preferences. Stored in this browser only.</p>
      </div>

      <Panel title="API key" className="max-w-xl">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted" htmlFor="api-key">
            X-API-Key sent with every authenticated request (positions, trades, brokers). There is no login flow yet.
          </label>
          <div className="flex items-center gap-2">
            <input
              id="api-key"
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(e) => update('apiKey', e.target.value)}
              placeholder="sk_…"
              autoComplete="off"
              spellCheck={false}
              className="num flex-1 rounded border border-border bg-surface px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="flex items-center justify-center rounded border border-border p-1.5 text-muted hover:text-text"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <Button type="button" onClick={() => me.refetch()} disabled={me.isFetching}>
              {me.isFetching ? 'Testing…' : 'Test'}
            </Button>
          </div>

          {me.isSuccess && me.data && (
            <p className="text-xs text-up">Connected as {me.data.name}{me.data.email ? ` (${me.data.email})` : ''}.</p>
          )}
          {me.isError && (
            <p className="text-xs text-exit">{me.error instanceof ApiError ? me.error.message : 'Could not reach the API.'}</p>
          )}
        </div>
      </Panel>

      <Panel title="Display" className="max-w-xl">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Theme</span>
            <Select
              value={settings.theme}
              onChange={(v) => update('theme', v as ThemePref)}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">Default timeframe</span>
            <Select
              value={settings.defaultTimeframe}
              onChange={(v) => update('defaultTimeframe', v as Timeframe)}
              options={TIMEFRAMES.map((tf) => ({ value: tf.key, label: tf.trusted ? tf.label : `${tf.label} (experimental)` }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm">Show 1h / 4h everywhere</span>
            <Toggle checked={settings.showIntraday} onChange={(v) => update('showIntraday', v)} />
          </div>
        </div>
      </Panel>
    </div>
  )
}
