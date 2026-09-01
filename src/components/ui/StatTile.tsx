import type { ReactNode } from 'react'
import clsx from 'clsx'

const tones = {
  brand: { chip: 'bg-indigo-50 text-indigo-600 ring-indigo-100', accent: 'before:bg-indigo-500' },
  green: { chip: 'bg-emerald-50 text-emerald-600 ring-emerald-100', accent: 'before:bg-emerald-500' },
  red: { chip: 'bg-red-50 text-red-600 ring-red-100', accent: 'before:bg-red-500' },
  amber: { chip: 'bg-amber-50 text-amber-600 ring-amber-100', accent: 'before:bg-amber-500' },
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
  tone?: keyof typeof tones
}) {
  const t = tones[tone]

  return (
    <div
      className={clsx(
        'group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-4 pl-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-slate-300/80 hover:shadow-[var(--shadow-card-hover)]',
        'before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-full before:opacity-70 before:transition-opacity group-hover:before:opacity-100',
        t.accent,
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {icon && <span className={clsx('rounded-lg p-1.5 ring-1 ring-inset', t.chip)}>{icon}</span>}
      </div>
      <p className="tabular-nums mt-2.5 text-[27px] font-extrabold leading-none tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
