import type { ReactNode } from 'react'
import { shade, withAlpha } from '../../lib/color'

export function DashboardHero({
  brandColor,
  eyebrow,
  title,
  subtitle,
  action,
}: {
  brandColor: string
  eyebrow: string
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-2xl px-6 py-8 text-white shadow-[var(--shadow-pop)] ring-1 ring-inset ring-white/10 sm:px-9 sm:py-9"
      style={{
        backgroundColor: shade(brandColor, -30),
        backgroundImage: `linear-gradient(112deg, ${shade(brandColor, -44)} 0%, ${shade(brandColor, -14)} 50%, ${brandColor} 100%)`,
      }}
    >
      {/* soft key light */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: `radial-gradient(120% 90% at 8% 0%, ${withAlpha('#ffffff', 0.18)}, transparent 55%)` }}
      />
      {/* fine engraved grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: `linear-gradient(${withAlpha('#ffffff', 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${withAlpha('#ffffff', 0.05)} 1px, transparent 1px)`,
          backgroundSize: '46px 46px',
          maskImage: 'linear-gradient(105deg, black, transparent 78%)',
          WebkitMaskImage: 'linear-gradient(105deg, black, transparent 78%)',
        }}
      />
      {/* concentric growth arcs */}
      <svg
        className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 text-white/10"
        viewBox="0 0 200 200"
        fill="none"
        aria-hidden
      >
        {[40, 66, 92, 118].map((r) => (
          <circle key={r} cx="150" cy="150" r={r} stroke="currentColor" strokeWidth="1.5" />
        ))}
      </svg>
      <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-white/10 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">{eyebrow}</p>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
          <p className="mt-2.5 max-w-2xl text-sm text-white/70">{subtitle}</p>
        </div>
        {action && <div className="flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  )
}
