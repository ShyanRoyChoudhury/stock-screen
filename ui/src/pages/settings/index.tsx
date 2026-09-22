import { Fragment } from 'react'
import { useMe } from '../../api/hooks'
import { ApiError } from '../../api/types'
import { Button, fmt, Field, Kbd, KV, Panel, PageHead, Tabs } from '../../ds'
import { useSettings, type Density, type PositionsDefault, type ThemePref } from '../../lib/settings'

const KEYBOARD_ROWS: [string, string][] = [
  ['g t', 'Today'],
  ['g s', 'Signals'],
  ['g p', 'Positions'],
  ['g r', 'Trades'],
  ['g b', 'Brokers'],
  ['g o', 'Data & Ops'],
  ['/', 'Find symbol'],
  ['j k / ↑↓', 'Move row cursor (click a table first)'],
  ['↵', 'Expand / open row'],
  ['esc', 'Close search'],
]

export default function SettingsPage() {
  const { settings, update } = useSettings()
  const hasKey = !!settings.apiKey
  const me = useMe({ enabled: hasKey })

  return (
    <div className="ss-page">
      <PageHead title="Settings" />
      <div className="ss-grid-2">
        <div className="app-col">
          <Panel title="API key">
            <div className="app-col" style={{ gap: 12 }}>
              <Field
                label="API key"
                secret
                mono
                value={settings.apiKey}
                onChange={(e) => update('apiKey', e.target.value)}
                placeholder="sk_…"
                hint="Sent as X-API-Key. No login flow yet."
              />
              <div className="app-row" style={{ flexWrap: 'wrap' }}>
                <Button onClick={() => me.refetch()} loading={me.isFetching} disabled={!hasKey}>
                  Test
                </Button>
                {me.isSuccess && me.data ? (
                  <span className="ss-up">
                    Connected as {me.data.name}
                    {me.data.email ? ` (${me.data.email})` : ''}.
                  </span>
                ) : null}
                {me.isError ? (
                  <span className="ss-down">{me.error instanceof ApiError ? `${me.error.status} · ${me.error.message}` : 'Could not reach the API.'}</span>
                ) : null}
              </div>
            </div>
          </Panel>
          <Panel title="Account">
            {!hasKey ? (
              <p className="ss-muted">Set an API key above to see your account.</p>
            ) : me.data ? (
              <KV
                items={[
                  ['Name', me.data.name],
                  ['Email', me.data.email ?? '—'],
                  ['Created', fmt.date(me.data.created_at)],
                ]}
              />
            ) : me.isError ? (
              <p className="ss-down">Could not load your account. Check the key above.</p>
            ) : (
              <p className="ss-muted">Loading…</p>
            )}
          </Panel>
        </div>
        <div className="app-col">
          <Panel title="Display">
            <div className="app-col" style={{ gap: 14 }}>
              <div className="app-setting">
                <span>Theme</span>
                <Tabs
                  variant="segmented"
                  ariaLabel="Theme"
                  value={settings.theme}
                  onChange={(v) => update('theme', v as ThemePref)}
                  items={[
                    { id: 'system', label: 'System' },
                    { id: 'dark', label: 'Dark' },
                    { id: 'light', label: 'Light' },
                  ]}
                />
              </div>
              <div className="app-setting">
                <span>Table density</span>
                <Tabs
                  variant="segmented"
                  ariaLabel="Density"
                  value={settings.density}
                  onChange={(v) => update('density', v as Density)}
                  items={[
                    { id: 'compact', label: 'Compact' },
                    { id: 'default', label: 'Default' },
                  ]}
                />
              </div>
              <div className="app-setting">
                <span>Show 1h / 4h (experimental)</span>
                <Tabs
                  variant="segmented"
                  ariaLabel="Show intraday"
                  value={settings.showIntraday ? 'on' : 'off'}
                  onChange={(v) => update('showIntraday', v === 'on')}
                  items={[
                    { id: 'off', label: 'Hidden' },
                    { id: 'on', label: 'Shown' },
                  ]}
                />
              </div>
              <div className="app-setting">
                <span>Positions open on</span>
                <Tabs
                  variant="segmented"
                  ariaLabel="Positions default"
                  value={settings.positionsDefault}
                  onChange={(v) => update('positionsDefault', v as PositionsDefault)}
                  items={[
                    { id: 'lot', label: 'Per lot' },
                    { id: 'sym', label: 'By symbol' },
                  ]}
                />
              </div>
            </div>
          </Panel>
          <Panel title="Keyboard">
            <div className="app-kbd-grid">
              {KEYBOARD_ROWS.map(([k, v]) => (
                <Fragment key={k}>
                  <Kbd keys={k.split(' / ')[0]} />
                  <span className="ss-muted">{v}</span>
                </Fragment>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
