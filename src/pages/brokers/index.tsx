// Brokers — BUILD_BRIEF "Deliverable 3", mirroring
// design/prototype/src/app.jsx:511-570 (Brokers).

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  useBrokerAccounts,
  useCreateBrokerAccount,
  useDeactivateBrokerAccount,
  useImportTradebook,
  useSyncAllBrokerAccounts,
  useSyncBrokerAccount,
  useTestBrokerAccount,
} from '../../api/hooks'
import { ApiError } from '../../api/types'
import type { Broker, BrokerAccount, ImportResult as ApiImportResult } from '../../api/types'
import {
  ApiKeyPrompt,
  BrokerCard,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FileDrop,
  type ImportResult as DsImportResult,
  Loading,
  PageHead,
  Panel,
  Tabs,
} from '../../ds'
import { useSettings } from '../../lib/settings'
import { useToast } from '../../lib/toast'
import { errorMessage, expectedSyncDate } from './utils'

function toDropResult(res: ApiImportResult): DsImportResult {
  return {
    rows: res.rows,
    upserted: res.upserted,
    unmapped: res.unmapped,
    ledger: {
      buys_opened: res.ledger?.buys_opened ?? 0,
      sells_allocated: res.ledger?.sells_allocated ?? 0,
      orphan_sells: res.ledger?.orphan_sells.length ?? 0,
      skipped_unmapped: res.ledger?.skipped_unmapped ?? 0,
      errors: res.ledger?.errors ?? [],
    },
  }
}

export default function BrokersPage() {
  const { settings } = useSettings()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: accounts, isLoading, isError, error } = useBrokerAccounts()
  const syncAllMutation = useSyncAllBrokerAccounts()
  const testMutation = useTestBrokerAccount()
  const syncMutation = useSyncBrokerAccount()
  const deactivateMutation = useDeactivateBrokerAccount()
  const importMutation = useImportTradebook()

  const [activeId, setActiveId] = useState<number | null>(null)
  const [importForId, setImportForId] = useState<number | null>(searchParams.get('import') ? Number(searchParams.get('import')) : null)
  const [importResult, setImportResult] = useState<ApiImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const importRef = useRef<HTMLDivElement>(null)

  const addOpen = searchParams.get('add') === '1'

  useEffect(() => {
    if (importForId != null) importRef.current?.scrollIntoView({ block: 'start' })
  }, [importForId])

  function openAdd() {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('add', '1')
      return p
    })
  }
  function closeAdd() {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.delete('add')
      return p
    })
  }

  function openImport(id: number) {
    setImportForId(id)
    setImportResult(null)
    setImportError(null)
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('import', String(id))
      return p
    })
  }
  function closeImport() {
    setImportForId(null)
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.delete('import')
      return p
    })
  }

  function handleSyncAll() {
    syncAllMutation.mutate(undefined, {
      onSuccess: (res) => {
        for (const r of res.results) {
          const label = accounts?.find((a) => a.id === r.account_id)?.label ?? `#${r.account_id}`
          if (r.ok) toast(`${label}: OK — ${r.result?.trades.upserted ?? 0} trades upserted`)
          else toast(`${label}: Failed — ${r.error}`)
        }
      },
      onError: (err) => toast(errorMessage(err)),
    })
  }

  function handleTest(a: BrokerAccount) {
    setActiveId(a.id)
    testMutation.mutate(a.id, {
      onSuccess: (res) => toast(`${a.label}: OK — ${res.holdings} holdings`),
      onError: (err) => {
        if (err instanceof ApiError && err.status === 501) toast(`${a.label}: No live client for this broker; use CSV import`)
        else toast(`${a.label}: ${errorMessage(err)}`)
      },
      onSettled: () => setActiveId(null),
    })
  }

  function handleSync(a: BrokerAccount) {
    setActiveId(a.id)
    syncMutation.mutate(
      { id: a.id },
      {
        onSuccess: (res) => toast(`${a.label}: ${res.trades.received} received, ${res.trades.upserted} upserted, ${res.trades.unmapped} unmapped · ${res.holdings} holdings`),
        onError: (err) => toast(`${a.label}: ${errorMessage(err)}`),
        onSettled: () => setActiveId(null),
      },
    )
  }

  function handleDeactivate(a: BrokerAccount) {
    if (!window.confirm(`Deactivate ${a.label}? Its trades and positions stay.`)) return
    deactivateMutation.mutate(a.id, {
      onSuccess: () => toast(`${a.label} deactivated. Its trades and positions stay.`),
      onError: (err) => toast(errorMessage(err)),
    })
  }

  function handleFile(file: File) {
    if (importForId == null) return
    importMutation.mutate(
      { id: importForId, file },
      {
        onSuccess: (res) => {
          setImportResult(res)
          setImportError(null)
        },
        onError: (err) => {
          setImportError(errorMessage(err))
          setImportResult(null)
        },
      },
    )
  }

  if (!settings.apiKey) return <ApiKeyPrompt message="Brokers needs your API key to load linked accounts." />

  const importAccount = accounts?.find((a) => a.id === importForId)

  return (
    <div className="ss-page">
      <PageHead title="Brokers" sub="Read-only broker links. The platform never places orders.">
        <Button size="sm" icon="sync" loading={syncAllMutation.isPending} onClick={handleSyncAll}>
          Sync all
        </Button>
        <Button size="sm" variant="primary" onClick={openAdd}>
          Add Groww account
        </Button>
      </PageHead>

      {addOpen ? <AddAccountPanel onClose={closeAdd} /> : null}

      {isLoading ? <Loading label="Loading broker accounts…" /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {!isLoading && !isError && (accounts ?? []).length === 0 ? (
        <EmptyState title="No broker account linked" action={<Button variant="primary" onClick={openAdd}>Add Groww account</Button>} />
      ) : null}
      {!isLoading && !isError && accounts && accounts.length > 0 ? (
        <div className="app-cards">
          {accounts.map((a) => (
            <BrokerCard
              key={a.id}
              account={a}
              lastTradingDay={expectedSyncDate()}
              busy={activeId === a.id && (testMutation.isPending || syncMutation.isPending)}
              onTest={() => handleTest(a)}
              onSync={() => handleSync(a)}
              onImport={() => openImport(a.id)}
              onDeactivate={() => handleDeactivate(a)}
            />
          ))}
        </div>
      ) : null}

      {importForId != null ? (
        <div ref={importRef}>
          <Panel title={`Import tradebook CSV · ${importAccount?.label ?? ''}`} right={<Button size="sm" variant="ghost" onClick={closeImport}>Close</Button>}>
            <FileDrop onFile={handleFile} busy={importMutation.isPending} result={importResult ? toDropResult(importResult) : undefined} />
            {importError ? <p className="ss-down" style={{ marginBottom: 0 }}>{importError}</p> : null}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

function AddAccountPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const createMutation = useCreateBrokerAccount()
  const [broker, setBroker] = useState<Broker>('groww')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [totp, setTotp] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function save() {
    if (!label.trim() || !apiKey.trim() || !totp.trim()) {
      setFormError('Label, API key and TOTP secret are all required.')
      return
    }
    setFormError(null)
    createMutation.mutate(
      { broker, label: label.trim(), api_key: apiKey.trim(), totp_secret: totp.trim() },
      {
        onSuccess: () => {
          toast(`${label.trim()} added.`)
          onClose()
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setFormError(`409 · An account with broker ${broker} and label “${label.trim()}” already exists.`)
          } else if (err instanceof ApiError && err.status === 503) {
            setFormError("503 · Server has no BROKER_MASTER_KEY; credentials can't be encrypted")
          } else {
            setFormError(errorMessage(err))
          }
        },
      },
    )
  }

  return (
    <Panel title="Add Groww account" right={<Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>}>
      <Tabs
        variant="segmented"
        ariaLabel="Broker"
        value={broker}
        onChange={(v) => setBroker(v as Broker)}
        items={[
          { id: 'groww', label: 'Groww' },
          { id: 'zerodha', label: 'Zerodha', title: 'CSV import only — no live client yet' },
        ]}
      />
      <div className="app-form" style={{ marginTop: 12 }}>
        <Field
          id="acc-label"
          label="Label"
          placeholder="Main"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={formError && formError.startsWith('409') ? formError : undefined}
          hint="Unique per broker."
        />
        <Field id="acc-key" label="API key" secret placeholder="Paste Groww API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} hint="Write-only. Stored encrypted; never returned." />
        <Field id="acc-totp" label="TOTP secret" secret placeholder="Base32 secret" value={totp} onChange={(e) => setTotp(e.target.value)} hint="Used to mint session tokens nightly." />
      </div>
      <div className="app-row" style={{ marginTop: 12 }}>
        {formError && !formError.startsWith('409') ? <span className="ss-down app-small">{formError}</span> : null}
        <span className="ss-spacer" />
        <Button variant="primary" loading={createMutation.isPending} onClick={save}>
          Save account
        </Button>
      </div>
    </Panel>
  )
}
