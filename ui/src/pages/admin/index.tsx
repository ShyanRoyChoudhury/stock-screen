import { useEffect, useState } from 'react'
import type { AdminSettings } from '../../api/types'
import { useAdminSettings, useFyersLoginUrl, useFyersLogout, useFyersStatus, useUpdateAdminSettings } from '../../api/hooks'
import { Badge, Button, fmt, Field, KV, Panel, PageHead, Tabs } from '../../ds'
import { errorMessage } from '../brokers/utils'
import { useSettings } from '../../lib/settings'
import { useToast } from '../../lib/toast'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function FyersCard({ enabled }: { enabled: boolean }) {
  const status = useFyersStatus({ enabled })
  const loginUrl = useFyersLoginUrl()
  const logout = useFyersLogout()
  const s = status.data

  const login = () =>
    loginUrl.mutate(undefined, {
      onSuccess: ({ url }) => {
        window.location.href = url
      },
    })

  return (
    <Panel title="Fyers connection" right={s ? <Badge tone={s.connected ? 'up' : 'down'}>{s.connected ? 'Connected' : 'Not connected'}</Badge> : null}>
      <div className="app-col" style={{ gap: 12 }}>
        {!enabled ? <p className="ss-muted">Set an API key in Settings first.</p> : null}
        {status.isError ? <p className="ss-down">{errorMessage(status.error)}</p> : null}
        {s ? (
          <KV
            items={[
              ['Status', s.connected ? 'Connected' : s.expires_at ? 'Expired' : 'Not logged in'],
              s.expires_at ? [s.connected ? 'Expires' : 'Expired', fmt.dateTime(s.expires_at)] : null,
              s.logged_in_by ? ['Logged in by', s.logged_in_by] : null,
              s.logged_in_at ? ['Logged in at', fmt.dateTime(s.logged_in_at)] : null,
            ]}
          />
        ) : null}
        <p className="ss-muted">Fyers tokens die at 06:00 IST, so this login is needed once per trading day.</p>
        <div className="app-row" style={{ flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={login} loading={loginUrl.isPending} disabled={!enabled}>
            Log in to Fyers
          </Button>
          <Button onClick={() => logout.mutate()} loading={logout.isPending} disabled={!enabled || !s || (!s.connected && !s.expires_at)}>
            Log out
          </Button>
        </div>
        {loginUrl.isError ? <p className="ss-down">{errorMessage(loginUrl.error)}</p> : null}
        {logout.isError ? <p className="ss-down">{errorMessage(logout.error)}</p> : null}
      </div>
    </Panel>
  )
}

type Draft = Pick<AdminSettings, 'daily_job_time' | 'recheck_time' | 'daily_job_enabled'>

function JobSettingsCard({ enabled }: { enabled: boolean }) {
  const q = useAdminSettings({ enabled })
  const update = useUpdateAdminSettings()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    if (q.data) setDraft({ daily_job_time: q.data.daily_job_time, recheck_time: q.data.recheck_time, daily_job_enabled: q.data.daily_job_enabled })
  }, [q.data])

  const d = draft
  const timeErr = (v: string) => (HHMM.test(v) ? undefined : 'Use HH:MM (24h, IST)')
  const invalid = !d || !!timeErr(d.daily_job_time) || !!timeErr(d.recheck_time)
  const dirty = !!d && !!q.data && (d.daily_job_time !== q.data.daily_job_time || d.recheck_time !== q.data.recheck_time || d.daily_job_enabled !== q.data.daily_job_enabled)

  const save = () => {
    if (!d || invalid) return
    update.mutate(d, { onSuccess: () => toast('Job settings saved') })
  }

  return (
    <Panel title="Job settings">
      <div className="app-col" style={{ gap: 12 }}>
        {!enabled ? <p className="ss-muted">Set an API key in Settings first.</p> : null}
        {q.isError ? <p className="ss-down">{errorMessage(q.error)}</p> : null}
        {d ? (
          <>
            <div className="app-setting">
              <span>Scheduled jobs</span>
              <Tabs
                variant="segmented"
                ariaLabel="Scheduled jobs"
                value={d.daily_job_enabled ? 'on' : 'off'}
                onChange={(v) => setDraft({ ...d, daily_job_enabled: v === 'on' })}
                items={[
                  { id: 'on', label: 'Enabled' },
                  { id: 'off', label: 'Disabled' },
                ]}
              />
            </div>
            <Field
              label="Daily job time (IST)"
              mono
              value={d.daily_job_time}
              onChange={(e) => setDraft({ ...d, daily_job_time: e.target.value })}
              error={timeErr(d.daily_job_time)}
              hint="Runs once on each trading day, from this time."
            />
            <Field
              label="Re-check time (IST)"
              mono
              value={d.recheck_time}
              onChange={(e) => setDraft({ ...d, recheck_time: e.target.value })}
              error={timeErr(d.recheck_time)}
              hint="Re-checks a late bhavcopy; regenerates signals only for stocks whose check changed."
            />
            <KV
              items={[
                ['Daily job last run', q.data?.daily_job_last_run ? fmt.date(q.data.daily_job_last_run, true) : 'Never'],
                ['Re-check last run', q.data?.recheck_last_run ? fmt.date(q.data.recheck_last_run, true) : 'Never'],
              ]}
            />
            <div className="app-row">
              <Button variant="primary" onClick={save} loading={update.isPending} disabled={invalid || !dirty}>
                Save
              </Button>
            </div>
          </>
        ) : q.isLoading ? (
          <p className="ss-muted">Loading…</p>
        ) : null}
        {update.isError ? <p className="ss-down">{errorMessage(update.error)}</p> : null}
      </div>
    </Panel>
  )
}

export default function AdminPage() {
  const { settings } = useSettings()
  const enabled = !!settings.apiKey
  return (
    <div className="ss-page">
      <PageHead title="Admin" />
      <div className="ss-grid-2">
        <div className="app-col">
          <FyersCard enabled={enabled} />
        </div>
        <div className="app-col">
          <JobSettingsCard enabled={enabled} />
        </div>
      </div>
    </div>
  )
}
