import type { ReactNode } from 'react'

export function DashboardHero({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 px-5 py-5 text-white shadow-[var(--shadow-card)] ring-1 ring-inset ring-white/10 sm:px-7 sm:py-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(90% 120% at 100% 0%, rgba(255,255,255,0.12), transparent 55%)',
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">{eyebrow}</p>
          <h1 className="mt-1 text-xl font-bold leading-tight tracking-tight sm:text-2xl">{title}</h1>
          <p className="mt-1 truncate text-[13px] text-white/65">{subtitle}</p>
        </div>
        {action && <div className="flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  )
}
