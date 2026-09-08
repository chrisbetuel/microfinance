import { useCallback, useEffect, useState } from 'react'
import { Wallet, ArrowDownLeft, ArrowUpRight, Lock, CheckCircle2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Field, inputClass } from '../../components/ui/Field'
import { Table } from '../../components/ui/Table'
import { formatMoney, formatDate } from '../../lib/format'
import { api } from '../../lib/api'
import { toast } from '../../lib/toast'
import { useCanEdit } from '../../lib/useCanEdit'

interface Position {
  businessDate: string
  cashierName: string
  openingFloat: number
  cashIn: number
  cashOut: number
  expectedClose: number
  closed: boolean
  countedClose: number | null
  variance: number | null
}

interface Reconciliation {
  id: string
  cashierName: string
  businessDate: string
  openingFloat: number
  cashIn: number
  cashOut: number
  expectedClose: number
  countedClose: number
  variance: number
  note: string
}

export function CashDrawer() {
  const currency = useStore((s) => s.lender.currency)
  const canEdit = useCanEdit()
  const [pos, setPos] = useState<Position | null>(null)
  const [history, setHistory] = useState<Reconciliation[]>([])
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<Position>('/till/today').then(setPos).catch(() => setPos(null))
    api.get<Reconciliation[]>('/till').then(setHistory).catch(() => setHistory([]))
  }, [])

  useEffect(load, [load])

  async function close() {
    if (!pos) return
    setBusy(true)
    try {
      await api.post('/till', { countedClose: Number(counted), note: note.trim() })
      toast.success('Cash drawer closed')
      setCounted('')
      setNote('')
      load()
    } catch (e) {
      toast.error('Could not close drawer', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  if (!pos) return <p className="text-sm text-slate-400">Loading cash position…</p>

  const variancePreview = counted ? Number(counted) - pos.expectedClose : null

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Your drawer — {formatDate(pos.businessDate)}</h3>
            <p className="text-xs text-slate-500">Cash movements you handled today</p>
          </div>
          {pos.closed && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <CheckCircle2 size={13} /> Closed
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Line icon={<Wallet size={15} />} label="Opening float" value={formatMoney(pos.openingFloat, currency)} />
          <Line
            icon={<ArrowDownLeft size={15} className="text-emerald-500" />}
            label="Cash in (repayments)"
            value={formatMoney(pos.cashIn, currency)}
          />
          <Line
            icon={<ArrowUpRight size={15} className="text-accent-500" />}
            label="Cash out (disbursed)"
            value={formatMoney(pos.cashOut, currency)}
          />
          <Line
            icon={<Lock size={15} />}
            label="Expected in drawer"
            value={formatMoney(pos.expectedClose, currency)}
            strong
          />
        </div>

        {!pos.closed && canEdit && (
          <div className="mt-5 space-y-3 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-800">Close the drawer</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cash counted">
                <input type="number" className={inputClass} value={counted} onChange={(e) => setCounted(e.target.value)} />
              </Field>
              <Field label="Note (optional)">
                <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain any variance" />
              </Field>
            </div>
            {variancePreview !== null && Math.abs(variancePreview) > 0.01 && (
              <p className={`text-xs font-medium ${variancePreview < 0 ? 'text-accent-600' : 'text-amber-600'}`}>
                Variance: {variancePreview > 0 ? '+' : ''}
                {formatMoney(variancePreview, currency)} ({variancePreview < 0 ? 'short' : 'over'})
              </p>
            )}
            <Button size="sm" disabled={busy || counted === ''} onClick={close}>
              {busy ? 'Closing…' : 'Close drawer'}
            </Button>
          </div>
        )}

        {pos.closed && pos.variance !== null && (
          <p className="mt-4 text-sm text-slate-600">
            Counted {formatMoney(pos.countedClose ?? 0, currency)} · variance{' '}
            <span className={pos.variance < 0 ? 'text-accent-600' : pos.variance > 0 ? 'text-amber-600' : 'text-emerald-600'}>
              {pos.variance > 0 ? '+' : ''}
              {formatMoney(pos.variance, currency)}
            </span>
          </p>
        )}
      </Card>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Reconciliation history</h3>
        <Table
          rowKey={(r) => r.id}
          rows={history}
          pageSize={15}
          emptyMessage="No drawers closed yet."
          columns={[
            { header: 'Date', cell: (r) => formatDate(r.businessDate), sort: (r) => r.businessDate },
            { header: 'Cashier', cell: (r) => r.cashierName },
            { header: 'Cash in', cell: (r) => formatMoney(r.cashIn, currency) },
            { header: 'Cash out', cell: (r) => formatMoney(r.cashOut, currency) },
            { header: 'Expected', cell: (r) => formatMoney(r.expectedClose, currency) },
            { header: 'Counted', cell: (r) => formatMoney(r.countedClose, currency) },
            {
              header: 'Variance',
              cell: (r) => (
                <span className={r.variance < 0 ? 'text-accent-600' : r.variance > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                  {r.variance > 0 ? '+' : ''}
                  {formatMoney(r.variance, currency)}
                </span>
              ),
              sort: (r) => r.variance,
            },
          ]}
        />
      </div>
    </div>
  )
}

function Line({ icon, label, value, strong }: { icon: React.ReactNode; label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/70">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      <p className={`mt-1 tabular-nums ${strong ? 'text-base font-bold text-slate-900' : 'text-sm font-semibold text-slate-700'}`}>
        {value}
      </p>
    </div>
  )
}
