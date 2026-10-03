import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Button } from '../../components/ui/Button'
import { Field, inputClass } from '../../components/ui/Field'
import { formatMoney } from '../../lib/format'
import { api } from '../../lib/api'
import type { RestructurePreview } from '../../types'

/** Agree a new repayment plan for a loan in arrears (supervisors only). */
export function RestructureBlock({ loanId }: { loanId: string }) {
  const currency = useStore((s) => s.lender.currency)
  const restructureLoan = useStore((s) => s.restructureLoan)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newTerm, setNewTerm] = useState('6')
  const [firstDueDate, setFirstDueDate] = useState('')
  const [waivePenalties, setWaivePenalties] = useState(false)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<RestructurePreview | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .get<RestructurePreview>(`/loans/${loanId}/restructure?waivePenalties=${waivePenalties}`)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null))
    return () => {
      cancelled = true
    }
  }, [open, waivePenalties, loanId])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700"
      >
        <CalendarClock size={15} />
        Restructure this loan
      </button>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <p className="text-sm font-semibold text-slate-800">Restructure loan</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New term (instalments)">
          <input type="number" min={1} className={inputClass} value={newTerm} onChange={(e) => setNewTerm(e.target.value)} />
        </Field>
        <Field label="First payment due" hint="Optional — defaults to next period">
          <input type="date" className={inputClass} value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={waivePenalties} onChange={(e) => setWaivePenalties(e.target.checked)} />
        Waive accrued penalties as a concession
      </label>
      <Field label="Reason">
        <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. business hardship, agreed plan" />
      </Field>
      {preview && (
        <div className="rounded-lg bg-white p-3 text-xs ring-1 ring-inset ring-slate-200">
          <div className="flex justify-between py-0.5">
            <span className="text-slate-500">Remaining principal</span>
            <span className="tabular-nums">{formatMoney(preview.remainingPrincipal, currency)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-slate-500">Arrears carried forward</span>
            <span className="tabular-nums">{formatMoney(preview.carriedArrears, currency)}</span>
          </div>
          {preview.penaltyWaived > 0 && (
            <div className="flex justify-between py-0.5 text-emerald-600">
              <span>Penalty waived</span>
              <span className="tabular-nums">−{formatMoney(preview.penaltyWaived, currency)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-800">
            <span>New principal</span>
            <span className="tabular-nums">{formatMoney(preview.newPrincipal, currency)}</span>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !Number(newTerm)}
          onClick={async () => {
            setBusy(true)
            try {
              await restructureLoan(loanId, { newTerm: Number(newTerm), firstDueDate: firstDueDate || null, waivePenalties, reason: reason.trim() })
              setOpen(false)
            } finally {
              setBusy(false)
            }
          }}
        >
          Confirm restructure
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
