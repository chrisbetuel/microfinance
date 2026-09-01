import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'hero'
type Size = 'sm' | 'md'

const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-brand-600',
  secondary:
    'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 shadow-sm hover:bg-slate-50 hover:ring-slate-400 focus-visible:outline-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:outline-slate-400',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 focus-visible:outline-red-600',
  hero: 'bg-white/15 text-white ring-1 ring-inset ring-white/30 backdrop-blur-sm hover:bg-white/25 focus-visible:outline-white',
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  icon,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode; children: ReactNode }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
