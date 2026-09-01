import type { ReactNode } from 'react'
import clsx from 'clsx'

export function Card({
  children,
  className,
  padded = true,
  interactive = false,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
  interactive?: boolean
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)] transition-shadow',
        interactive && 'hover:shadow-[var(--shadow-card-hover)]',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
