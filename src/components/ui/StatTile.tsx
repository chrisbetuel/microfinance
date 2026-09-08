import type { ReactNode } from 'react'
import clsx from 'clsx'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

const tones = {
  brand: { chip: 'bg-brand-50 text-brand-600 ring-brand-100', accent: 'before:bg-brand-500' },
  green: { chip: 'bg-emerald-50 text-emerald-600 ring-emerald-100', accent: 'before:bg-emerald-500' },
  red: { chip: 'bg-accent-50 text-accent-600 ring-accent-100', accent: 'before:bg-accent-500' },
  amber: { chip: 'bg-amber-50 text-amber-600 ring-amber-100', accent: 'before:bg-amber-500' },
}

function Sparkline({ points, tone }: { points: number[]; tone: keyof typeof tones }) {
  if (points.length < 2) return null
  const max = Math.max(...points)
  const min = Math.min(...points)
  const span = max - min || 1
  const stroke =
    tone === 'green' ? '#10b981' : tone === 'red' ? '#ee0033' : tone === 'amber' ? '#f59e0b' : '#6366f1'
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100
      const y = 24 - ((p - min) / span) * 22 - 1
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-7 w-20" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  delta,
  trend,
}: {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
  tone?: keyof typeof tones
  /** e.g. "+12%" / "-4%" — arrow direction and colour follow the sign. */
  delta?: string
  trend?: number[]
}) {
  const t = tones[tone]
  const deltaPositive = delta ? !delta.trim().startsWith('-') : undefined

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
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          {delta && (
            <span
              className={clsx(
                'inline-flex items-center gap-0.5 text-xs font-semibold',
                deltaPositive ? 'text-emerald-600' : 'text-accent-600',
              )}
            >
              {deltaPositive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {delta}
            </span>
          )}
          {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
        {trend && <Sparkline points={trend} tone={tone} />}
      </div>
    </div>
  )
}
