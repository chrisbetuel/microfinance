import type { ReactNode } from 'react'
import clsx from 'clsx'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

export function Table<T>({ columns, rows, rowKey, onRowClick }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)]">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/80">
          <tr>
            {columns.map((col) => (
              <th key={col.header} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={clsx('transition-colors', onRowClick && 'cursor-pointer hover:bg-indigo-50/50')}
            >
              {columns.map((col) => (
                <td key={col.header} className={`px-4 py-3.5 text-slate-700 ${col.className ?? ''}`}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-400">
                Nothing to show yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
