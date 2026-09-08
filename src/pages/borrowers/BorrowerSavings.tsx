import { useCallback, useEffect, useState } from 'react'
import { PiggyBank, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Field, inputClass } from '../../components/ui/Field'
import { Badge } from '../../components/ui/Badge'
import { formatMoney, formatDateTime } from '../../lib/format'
import { api } from '../../lib/api'
import { toast } from '../../lib/toast'
import { useStore } from '../../store/useStore'
import type { SavingsAccount, SavingsTransactionKind } from '../../types'

const kindLabel: Record<SavingsTransactionKind, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  loan_deduction: 'Loan deduction',
  release: 'Release',
}
const kindTone: Record<SavingsTransactionKind, 'green' | 'red' | 'blue' | 'slate'> = {
  deposit: 'green',
  withdrawal: 'red',
  loan_deduction: 'blue',
  release: 'slate',
}
const kindIconColor: Record<SavingsTransactionKind, string> = {
  deposit: 'text-emerald-500',
  withdrawal: 'text-accent-500',
  loan_deduction: 'text-blue-500',
  release: 'text-slate-400',
}

export function BorrowerSavings({ borrowerId, canEdit }: { borrowerId: string; canEdit: boolean }) {
  const currency = useStore((s) => s.lender.currency)
  const [account, setAccount] = useState<SavingsAccount | null>(null)
  const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<SavingsAccount>(`/borrowers/${borrowerId}/savings`).then(setAccount).catch(() => setAccount(null))
  }, [borrowerId])

  useEffect(load, [load])

  async function submit() {
    setBusy(true)
    try {
      const updated = await api.post<SavingsAccount>(`/borrowers/${borrowerId}/savings`, {
        kind,
        amount: Number(amount),
        note: note.trim(),
      })
      setAccount(updated)
      setAmount('')
      setNote('')
      toast.success(kind === 'deposit' ? 'Deposit recorded' : 'Withdrawal recorded')
    } catch (e) {
      toast.error('Could not save', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  if (!account) return <p className="text-sm text-slate-400">Loading savings…</p>

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <PiggyBank size={20} />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Savings balance</p>
            <p className="tabular-nums text-2xl font-extrabold text-slate-900">{formatMoney(account.balance, currency)}</p>
          </div>
        </div>

        {canEdit && (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4 sm:items-end">
            <Field label="Type">
              <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as 'deposit' | 'withdrawal')}>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
              </select>
            </Field>
            <Field label="Amount">
              <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Note">
              <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button disabled={busy || !Number(amount)} onClick={submit}>
              {busy ? 'Saving…' : 'Record'}
            </Button>
          </div>
        )}
      </Card>

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-800">Transactions</p>
        {account.transactions.length === 0 && <p className="text-sm text-slate-400">No transactions yet.</p>}
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {account.transactions.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <span className={kindIconColor[t.kind]}>
                {t.kind === 'withdrawal' || t.kind === 'release' ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge tone={kindTone[t.kind]}>{kindLabel[t.kind]}</Badge>
                  <span className="text-xs text-slate-400">
                    {formatDateTime(t.createdAt)} · {t.createdBy}
                  </span>
                </div>
                {t.note && <p className="mt-0.5 text-xs text-slate-500">{t.note}</p>}
              </div>
              <div className="text-right">
                <p className="tabular-nums text-sm font-semibold text-slate-800">{formatMoney(t.amount, currency)}</p>
                <p className="tabular-nums text-xs text-slate-400">bal {formatMoney(t.balanceAfter, currency)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
