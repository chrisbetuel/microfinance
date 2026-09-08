import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  className?: string
  /** Provide to make the column sortable. Returns the value to sort on. */
  sort?: (row: T) => string | number
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyMessage = 'Nothing to show yet.',
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyMessage?: string
}) {
  const [sort, setSort] = useState<{ index: number; dir: 'asc' | 'desc' } | null>(null)

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const col = columns[sort.index]
    if (!col?.sort) return rows
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = col.sort!(a)
      const bv = col.sort!(b)
      if (av < bv) return -1 * factor
      if (av > bv) return 1 * factor
      return 0
    })
  }, [rows, sort, columns])

  function toggleSort(index: number) {
    setSort((prev) => {
      if (prev?.index !== index) return { index, dir: 'asc' }
      if (prev.dir === 'asc') return { index, dir: 'desc' }
      return null
    })
  }

  return (
    <div className="max-h-[70vh] overflow-auto rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)]">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
          <tr>
            {columns.map((col, i) => (
              <th
                key={col.header}
                className={clsx(
                  'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500',
                  col.sort && 'cursor-pointer select-none hover:text-slate-800',
                )}
                onClick={col.sort ? () => toggleSort(i) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sort &&
                    (sort?.index === i ? (
                      sort.dir === 'asc' ? (
                        <ChevronUp size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )
                    ) : (
                      <ChevronsUpDown size={12} className="text-slate-300" />
                    ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedRows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={clsx('transition-colors', onRowClick && 'cursor-pointer hover:bg-brand-50/50')}
            >
              {columns.map((col) => (
                <td key={col.header} className={`px-4 py-3.5 text-slate-700 ${col.className ?? ''}`}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-400">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
