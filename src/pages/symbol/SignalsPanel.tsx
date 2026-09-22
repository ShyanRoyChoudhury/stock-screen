import type { Signal } from '../../api/types'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { Chip } from '../../components/Chip'
import { Button } from '../../components/Button'
import { fmtIstDate, fmtIstDateTime, fmtNum, fmtPct, rr } from '../../lib/format'

interface SignalsPanelProps {
  signals: Signal[]
  selectedKey: string | null
  onSelect: (signal: Signal) => void
}

function keyOf(s: Signal): string {
  return `${s.symbol}|${s.strategy}|${s.timeframe}|${s.ts}`
}

export function SignalsPanel({ signals, selectedKey, onSelect }: SignalsPanelProps) {
  const columns: DataTableColumn<Signal>[] = [
    {
      key: 'date',
      header: 'Date',
      align: 'right',
      sortValue: (s) => s.ts,
      render: (s) => <span className="num">{s.timeframe === '1d' ? fmtIstDate(s.ts) : fmtIstDateTime(s.ts)}</span>,
    },
    { key: 'strategy', header: 'Strategy', sortValue: (s) => s.strategy, render: (s) => <Chip variant="strategy" value={s.strategy} /> },
    { key: 'entry', header: 'Entry', align: 'right', sortValue: (s) => s.entry, render: (s) => <span className="num">{fmtNum(s.entry)}</span> },
    { key: 'stop', header: 'Stop', align: 'right', sortValue: (s) => s.stop_loss, render: (s) => <span className="num">{fmtNum(s.stop_loss)}</span> },
    { key: 't1', header: 'T1', align: 'right', sortValue: (s) => s.target_1, render: (s) => <span className="num">{fmtNum(s.target_1)}</span> },
    { key: 't2', header: 'T2', align: 'right', sortValue: (s) => s.target_2, render: (s) => <span className="num">{fmtNum(s.target_2)}</span> },
    {
      key: 'risk',
      header: 'Risk %',
      align: 'right',
      sortValue: (s) => s.risk_pct ?? -Infinity,
      render: (s) => <span className="num">{fmtPct(s.risk_pct)}</span>,
    },
    {
      key: 'rr',
      header: 'R:R',
      align: 'right',
      sortValue: (s) => s.rr_ratio ?? rr(s.entry, s.stop_loss, s.target_1) ?? -Infinity,
      render: (s) => {
        const v = s.rr_ratio ?? rr(s.entry, s.stop_loss, s.target_1)
        return <span className="num">{v === null ? '—' : v.toFixed(2)}</span>
      },
    },
    {
      key: 'select',
      header: '',
      align: 'center',
      render: (s) => (
        <Button
          size="sm"
          variant={selectedKey === keyOf(s) ? 'primary' : 'secondary'}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(s)
          }}
        >
          {selectedKey === keyOf(s) ? 'Selected' : 'Select'}
        </Button>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={signals}
      rowKey={keyOf}
      onRowClick={onSelect}
      pageSize={100}
      emptyMessage="No signals for this symbol/timeframe."
    />
  )
}
