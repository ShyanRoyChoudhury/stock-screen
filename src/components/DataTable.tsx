import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react'

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string | number
  /** Returns a comparable value for this column; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | null | undefined
  render?: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  /** Renders extra content in a full-width row beneath an expanded row. */
  expandable?: (row: T) => ReactNode
  pageSize?: number
  emptyMessage?: string
}

type SortDir = 'asc' | 'desc'

const ALIGN_CLASS: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'align-right',
  center: 'text-center',
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, expandable, pageSize = 100, emptyMessage = 'No rows.' }: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set())

  const sortColumn = useMemo(() => columns.find((c) => c.key === sortKey), [columns, sortKey])

  const sortedRows = useMemo(() => {
    if (!sortColumn?.sortValue) return rows
    const dir = sortDir === 'asc' ? 1 : -1
    const withValues = rows.map((row) => ({ row, value: sortColumn.sortValue!(row) }))
    withValues.sort((a, b) => {
      const av = a.value
      const bv = b.value
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1
      if (bv === null || bv === undefined) return -1
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return withValues.map((w) => w.row)
  }, [rows, sortColumn, sortDir])

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageRows = useMemo(
    () => sortedRows.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize),
    [sortedRows, clampedPage, pageSize],
  )

  function handleSort(col: DataTableColumn<T>) {
    if (!col.sortValue) return
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(col.key)
      setSortDir('asc')
    }
    setPage(0)
  }

  function toggleExpanded(key: string | number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{emptyMessage}</p>
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="dense">
        <thead>
          <tr>
            {expandable && <th style={{ width: 24 }} />}
            {columns.map((col) => (
              <th
                key={col.key}
                className={ALIGN_CLASS[col.align ?? 'left']}
                style={col.width ? { width: col.width } : undefined}
                onClick={() => handleSort(col)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortValue &&
                    (sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ChevronUp size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )
                    ) : (
                      <ChevronsUpDown size={12} className="opacity-40" />
                    ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => {
            const key = rowKey(row)
            const isExpanded = expanded.has(key)
            return (
              <Fragment key={key}>
                <tr
                  onClick={() => onRowClick?.(row)}
                  className={onRowClick ? 'cursor-pointer' : undefined}
                >
                  {expandable && (
                    <td
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpanded(key)
                      }}
                      className="cursor-pointer"
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={ALIGN_CLASS[col.align ?? 'left']}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
                {expandable && isExpanded && (
                  <tr>
                    <td colSpan={columns.length + 1} className="bg-surface-2">
                      {expandable(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-2 py-1.5 text-xs text-muted">
          <span>
            Page {clampedPage + 1} of {pageCount} ({sortedRows.length} rows)
          </span>
          <button
            type="button"
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={clampedPage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
