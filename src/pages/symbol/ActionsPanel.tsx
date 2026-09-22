import type { CorporateAction } from '../../api/types'
import { DataTable, type DataTableColumn } from '../../components/DataTable'
import { ACTION_TYPE_LABELS } from '../../lib/domain'
import { fmtIstDate, fmtInr, fmtNum } from '../../lib/format'

function valueOrRatio(a: CorporateAction): string {
  if (a.value !== null) return fmtInr(a.value)
  if (a.ratio_from !== null && a.ratio_to !== null) return `${a.ratio_from}:${a.ratio_to}`
  return '—'
}

interface ActionsPanelProps {
  actions: CorporateAction[]
}

export function ActionsPanel({ actions }: ActionsPanelProps) {
  const columns: DataTableColumn<CorporateAction>[] = [
    { key: 'ex_date', header: 'Ex-date', align: 'right', sortValue: (a) => a.ex_date, render: (a) => <span className="num">{fmtIstDate(a.ex_date)}</span> },
    { key: 'type', header: 'Type', sortValue: (a) => a.action_type, render: (a) => ACTION_TYPE_LABELS[a.action_type] },
    { key: 'subject', header: 'Subject', sortValue: (a) => a.subject, render: (a) => a.subject },
    { key: 'value', header: 'Value / ratio', align: 'right', render: (a) => <span className="num">{valueOrRatio(a)}</span> },
    {
      key: 'factor',
      header: 'Price factor',
      align: 'right',
      sortValue: (a) => a.price_factor ?? -Infinity,
      render: (a) => <span className="num">{a.price_factor !== null ? fmtNum(a.price_factor, 4) : '—'}</span>,
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={actions}
      rowKey={(a) => `${a.symbol}|${a.action_type}|${a.ex_date}`}
      pageSize={100}
      emptyMessage="No corporate actions for this symbol."
    />
  )
}
