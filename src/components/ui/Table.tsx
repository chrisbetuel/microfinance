import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, ChevronsUpDown, Search, ChevronLeft, ChevronRight } from 'lucide-react'

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
  filterAccessor,
  filterPlaceholder = 'Filter…',
  pageSize,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyMessage?: string
  /** When set, a search box filters rows by this string. */
  filterAccessor?: (row: T) => string
  filterPlaceholder?: string
  /** When set, rows are paginated at this size. */
  pageSize?: number
}) {
  const [sort, setSort] = useState<{ index: number; dir: 'asc' | 'desc' } | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    if (!filterAccessor || !query.trim()) return rows
    const q = query.trim().toLowerCase()
    return rows.filter((r) => filterAccessor(r).toLowerCase().includes(q))
  }, [rows, query, filterAccessor])

  const sortedRows = useMemo(() => {
    if (!sort) return filtered
    const col = columns[sort.index]
    if (!col?.sort) return filtered
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = col.sort!(a)
      const bv = col.sort!(b)
      if (av < bv) return -1 * factor
      if (av > bv) return 1 * factor
      return 0
    })
  }, [filtered, sort, columns])

  const pageCount = pageSize ? Math.max(1, Math.ceil(sortedRows.length / pageSize)) : 1
  useEffect(() => {
    if (page >= pageCount) setPage(0)
  }, [page, pageCount])

  const visibleRows = pageSize ? sortedRows.slice(page * pageSize, page * pageSize + pageSize) : sortedRows

  function toggleSort(index: number) {
    setSort((prev) => {
      if (prev?.index !== index) return { index, dir: 'asc' }
      if (prev.dir === 'asc') return { index, dir: 'desc' }
      return null
    })
  }

  return (
    <div className="space-y-3">
      {filterAccessor && (
        <div className="relative max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={filterPlaceholder}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
      )}

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
            {visibleRows.map((row) => (
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
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-400">
                  {query.trim() ? 'No matches.' : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageSize && sortedRows.length > pageSize && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sortedRows.length)} of {sortedRows.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-40 enabled:hover:bg-slate-50"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-1 tabular-nums">
              {page + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-40 enabled:hover:bg-slate-50"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
