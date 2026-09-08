import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { useToasts } from '../../lib/toast'
import type { ToastTone } from '../../lib/toast'

const config: Record<ToastTone, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'ring-emerald-200', iconColor: 'text-emerald-500' },
  error: { icon: AlertCircle, ring: 'ring-accent-200', iconColor: 'text-accent-600' },
  info: { icon: Info, ring: 'ring-brand-200', iconColor: 'text-brand-600' },
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const c = config[t.tone]
        const Icon = c.icon
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl bg-white p-3.5 shadow-[var(--shadow-pop)] ring-1 ring-inset ${c.ring}`}
            style={{ animation: 'toast-in 0.18s ease-out' }}
          >
            <Icon size={18} className={`mt-0.5 shrink-0 ${c.iconColor}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="shrink-0 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
