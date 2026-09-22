// Ported from design/design-system/src/index.jsx: Field, FileDrop.

import { useRef, useState, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { cx } from './cx'
import { Button } from './primitives'

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: ReactNode
  mono?: boolean
  secret?: boolean
  saved?: boolean
}

let fid = 0

export function Field({ label, hint, error, mono, secret, saved, id, ...input }: FieldProps): ReactElement {
  const ref = useRef(id || 'ss-f' + ++fid)
  const fieldId = ref.current
  return (
    <div className={cx('ss', 'ss-field', !!error && 'ss-field-err')}>
      <label className="ss-label" htmlFor={fieldId}>
        {label}
      </label>
      {secret && saved ? (
        <div className="ss-secret-saved" id={fieldId}>
          <span className="ss-secret-dots">{'••••••••'}</span>
          Stored encrypted · write-only, never shown again
        </div>
      ) : (
        <input
          id={fieldId}
          className={cx('ss-input', (mono || secret) && 'ss-input-mono')}
          type={secret ? 'password' : 'text'}
          autoComplete={secret ? 'off' : undefined}
          spellCheck={false}
          aria-invalid={!!error || undefined}
          {...input}
        />
      )}
      {error || hint ? <span className="ss-field-hint">{error || hint}</span> : null}
    </div>
  )
}

const REQ = ['trade_date | date', 'symbol | isin', 'side | trade_type', 'quantity', 'price']
const OPT = ['exchange', 'segment', 'product', 'time', 'trade_id']

export interface ImportResult {
  rows: number
  upserted: number
  unmapped: number
  ledger: { buys_opened: number; sells_allocated: number; orphan_sells: number; skipped_unmapped: number; errors: unknown[] | number }
}

export interface FileDropProps {
  onFile?: (file: File) => void
  busy?: boolean
  result?: ImportResult
}

export function FileDrop({ result, onFile, busy }: FileDropProps): ReactElement {
  const [over, setOver] = useState(false)
  const inp = useRef<HTMLInputElement>(null)
  const L = result && result.ledger
  return (
    <div
      className={cx('ss', 'ss-drop', over && 'ss-drop-over')}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f && onFile) onFile(f)
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button icon="upload" variant="primary" loading={busy} onClick={() => inp.current && inp.current.click()}>
          Choose tradebook CSV
        </Button>
        <span className="ss-muted">or drop the broker’s tradebook export here</span>
        <input ref={inp} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onFile && onFile(e.target.files[0])} />
      </div>
      <div>
        <div className="ss-label" style={{ marginBottom: 4 }}>
          Required columns
        </div>
        <div className="ss-drop-cols">
          {REQ.map((c) => (
            <span key={c} className="ss-drop-col">
              {c}
            </span>
          ))}
        </div>
        <div className="ss-label" style={{ margin: '8px 0 4px' }}>
          Optional
        </div>
        <div className="ss-drop-cols">
          {OPT.map((c) => (
            <span key={c} className="ss-drop-col ss-drop-col-opt">
              {c}
            </span>
          ))}
        </div>
      </div>
      {result ? (
        <div className="ss-drop-result">
          {(
            [
              ['Rows read', result.rows],
              ['Upserted', result.upserted],
              ['Unmapped', result.unmapped],
              ['Buys opened', L && L.buys_opened],
              ['Sells allocated', L && L.sells_allocated],
              ['Orphan sells', L && L.orphan_sells],
              ['Errors', L && (Array.isArray(L.errors) ? L.errors.length : L.errors)],
            ] as [string, number | undefined][]
          ).map(([k, v]) => (
            <div key={k} className="ss-drop-kv">
              <span className="ss-label">{k}</span>
              <span className={cx('ss-n', (k === 'Unmapped' || k === 'Orphan sells' || k === 'Errors') && !!v && v > 0 && 'ss-down')}>{v ?? '—'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
