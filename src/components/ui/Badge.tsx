import type { ReactNode } from 'react'
import clsx from 'clsx'

export type BadgeTone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet'

const toneClasses: Record<BadgeTone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  // "disbursed" status — kept distinct from the danger red, in the brand family
  violet: 'bg-brand-50 text-brand-700 ring-brand-100',
}

const dotClasses: Record<BadgeTone, string> = {
  slate: 'bg-slate-400',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  violet: 'bg-brand-500',
}

export function Badge({
  children,
  tone = 'slate',
  className,
  dot = false,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
  dot?: boolean
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', dotClasses[tone])} />}
      {children}
    </span>
  )
}
