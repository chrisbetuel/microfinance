import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Field, inputClass } from '../../components/ui/Field'
import { formatMoney } from '../../lib/format'
import type { DisbursementChannel, DisbursementInput, DisbursementPreview } from '../../types'
import { METHOD_HINT, METHOD_LABEL, NETWORKS } from './disbursementParts'
import { LoanInformation } from './DisbursementDetail'

const METHODS: DisbursementChannel[] = ['bank_transfer', 'mobile_money', 'cash', 'wallet', 'supplier']

export default function DisbursementPrepare() {
  const { applicationId, id } = useParams()
  const navigate = useNavigate()
  const existing = useStore((s) => (id ? s.disbursements.find((d) => d.id === id) : undefined))
  const appId = existing?.applicationId ?? applicationId
  const application = useStore((s) => s.applications.find((a) => a.id === appId))
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === application?.borrowerId))
  const currency = useStore((s) => s.lender.currency)
  const previewDisbursement = useStore((s) => s.previewDisbursement)
  const prepareDisbursement = useStore((s) => s.prepareDisbursement)
  const updateDisbursement = useStore((s) => s.updateDisbursement)

  const [form, setForm] = useState<DisbursementInput>(() => {
    if (existing) {
      return {
        applicationId: existing.applicationId, method: existing.method, recipientType: existing.recipientType,
        recipientName: existing.recipientName, recipientProvider: existing.recipientProvider,
        recipientAccount: existing.recipientAccount, authorisationNote: existing.authorisationNote,
        insurance: existing.insurance, otherDeductions: existing.otherDeductions,
      }
    }
    const method: DisbursementChannel = application?.disbursementMethod || 'mobile_money'
    return {
      applicationId: appId ?? '', method, recipientType: 'borrower', recipientName: borrower?.fullName ?? '',
      recipientProvider: method === 'bank_transfer' ? borrower?.bankName ?? '' : 'mpesa',
      recipientAccount: method === 'bank_transfer' ? borrower?.bankAccount ?? '' : borrower?.mobileMoneyNumber || borrower?.phone || '',
      authorisationNote: '', insurance: 0, otherDeductions: [],
    }
  })
  const [preview, setPreview] = useState<DisbursementPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof DisbursementInput>(k: K, v: DisbursementInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const money = (n: number) => formatMoney(n, currency)

  useEffect(() => {
    if (!form.applicationId) return
    const t = setTimeout(() => {
      previewDisbursement(form).then(setPreview).catch(() => setPreview(null))
    }, 250)
    return () => clearTimeout(t)
  }, [form, previewDisbursement])

  if (!application || !borrower) return <p className="text-sm text-slate-500">Application not found.</p>
  if (!existing && application.status !== 'approved') {
    return (
      <p className="text-sm text-slate-500">
        {application.reference} is {application.status.replace('_', ' ')}. Only an approved application can be disbursed.{' '}
        <Link to="/disbursement" className="text-brand-700 underline">Back to disbursement</Link>
      </p>
    )
  }

  function pickMethod(m: DisbursementChannel) {
    setForm((f) => ({
      ...f,
      method: m,
      recipientProvider: m === 'bank_transfer' || m === 'supplier' ? (f.recipientType === 'borrower' ? borrower?.bankName ?? '' : '') : m === 'mobile_money' ? 'mpesa' : '',
      recipientAccount:
        m === 'bank_transfer' ? (f.recipientType === 'borrower' ? borrower?.bankAccount ?? '' : '')
        : m === 'mobile_money' ? borrower?.mobileMoneyNumber || borrower?.phone || ''
        : m === 'cash' ? borrower?.nationalId ?? '' : '',
      recipientType: m === 'supplier' ? 'third_party' : m === 'wallet' || m === 'cash' ? 'borrower' : f.recipientType,
      recipientName: m === 'supplier' ? '' : f.recipientType === 'third_party' ? f.recipientName : borrower?.fullName ?? '',
    }))
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (existing) {
        const { applicationId: _a, ...patch } = form
        await updateDisbursement(existing.id, patch)
        navigate(`/disbursement/${existing.id}`)
      } else {
        const d = await prepareDisbursement(form)
        navigate(`/disbursement/${d.id}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the disbursement')
    } finally {
      setBusy(false)
    }
  }

  const needsAccount = form.method === 'bank_transfer' || form.method === 'supplier' || form.method === 'mobile_money'

  return (
    <div>
      <PageHeader
        title={existing ? `Change ${existing.number}` : 'Prepare disbursement'}
        subtitle={`${application.reference} · ${borrower.fullName}. Preparing does not move money: it goes for verification and authorisation first.`}
      />
      {existing && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Saving changes sends this disbursement back to <b>Pending</b>. Verification and authorisation have to be done again.
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <LoanInformation applicationId={application.id} />

          <Card>
            <CardHeader title="Disbursement method" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => pickMethod(m)}
                  className={clsx(
                    'rounded-xl border p-3 text-left',
                    form.method === m ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <p className={clsx('text-sm font-semibold', form.method === m ? 'text-brand-800' : 'text-slate-800')}>{METHOD_LABEL[m]}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{METHOD_HINT[m]}</p>
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Recipient information" subtitle="Where the money is going" />
            {form.method !== 'wallet' && form.method !== 'supplier' && (
              <div className="mb-4 grid grid-cols-2 gap-2 sm:w-96">
                {(['borrower', 'third_party'] as const).map((t) => (
                  <button
                    key={t}
                    disabled={form.method === 'cash' && t === 'third_party'}
                    onClick={() => setForm((f) => ({ ...f, recipientType: t, recipientName: t === 'borrower' ? borrower.fullName : '' }))}
                    className={clsx(
                      'rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-40',
                      form.recipientType === t ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600',
                    )}
                  >
                    {t === 'borrower' ? 'The borrower' : 'Authorised recipient'}
                  </button>
                ))}
              </div>
            )}
            {form.method === 'wallet' ? (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                The net amount is credited to <b>{borrower.fullName}</b>'s savings wallet ({borrower.customerNumber}).
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Account holder name">
                  <input className={inputClass} value={form.recipientName} onChange={(e) => set('recipientName', e.target.value)} />
                </Field>
                {form.method === 'mobile_money' ? (
                  <Field label="Mobile-money network">
                    <select className={inputClass} value={form.recipientProvider} onChange={(e) => set('recipientProvider', e.target.value)}>
                      {Object.entries(NETWORKS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                ) : form.method === 'cash' ? (
                  <Field label="Paid at">
                    <input disabled className={`${inputClass} bg-slate-50`} value="Branch till" />
                  </Field>
                ) : (
                  <Field label="Bank">
                    <input className={inputClass} value={form.recipientProvider} onChange={(e) => set('recipientProvider', e.target.value)} placeholder="e.g. CRDB, NMB" />
                  </Field>
                )}
                <Field label={form.method === 'mobile_money' ? 'Phone number' : form.method === 'cash' ? 'ID shown at collection' : 'Account number'}>
                  <input className={inputClass} value={form.recipientAccount} onChange={(e) => set('recipientAccount', e.target.value)} />
                </Field>
                {form.recipientType === 'third_party' && (
                  <Field label="Borrower's authorisation" hint="e.g. signed instruction to pay supplier, dated">
                    <input className={inputClass} value={form.authorisationNote} onChange={(e) => set('authorisationNote', e.target.value)} />
                  </Field>
                )}
              </div>
            )}
            <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">On the borrower's profile</p>
              Phone {borrower.phone}{borrower.phoneVerified ? ' (verified)' : ' (not verified)'}
              {borrower.mobileMoneyNumber && ` · Mobile money ${borrower.mobileMoneyNumber}`}
              {borrower.bankAccount && ` · ${borrower.bankName || 'Bank'} ${borrower.bankAccount}`}
            </div>
            {preview && preview.warnings.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {preview.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            )}
            {preview && preview.warnings.length === 0 && needsAccount && (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <ShieldCheck size={15} /> Destination matches the borrower's profile.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Amount to disburse" />
            <Breakdown preview={preview} money={money} />
            <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
              <Field label="Insurance / other applicable charges">
                <input type="number" min={0} className={inputClass} value={form.insurance} onChange={(e) => set('insurance', Number(e.target.value))} />
              </Field>
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Other deductions</p>
                {form.otherDeductions.map((d, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <input
                      className={inputClass}
                      placeholder="Label"
                      value={d.label}
                      onChange={(e) => set('otherDeductions', form.otherDeductions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    />
                    <input
                      type="number"
                      min={0}
                      className={`${inputClass} w-32`}
                      value={d.amount}
                      onChange={(e) => set('otherDeductions', form.otherDeductions.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))}
                    />
                    <button className="text-slate-400 hover:text-accent-600" onClick={() => set('otherDeductions', form.otherDeductions.filter((_, j) => j !== i))}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => set('otherDeductions', [...form.otherDeductions, { label: '', amount: 0 }])}>
                  Add deduction
                </Button>
              </div>
            </div>
          </Card>
          {preview?.requiresDualAuthorisation && (
            <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Loans of {money(preview.dualAuthorisationThreshold)} or more need <b>two different authorisers</b> before release.
            </p>
          )}
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
            <Button className="flex-1" disabled={busy || !preview || preview.netAmount <= 0} onClick={save}>
              {existing ? 'Save changes' : 'Prepare disbursement'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Breakdown({
  preview,
  money,
}: {
  preview: Pick<DisbursementPreview, 'approvedAmount' | 'fees' | 'insurance' | 'savingsDeducted' | 'otherDeductions' | 'netAmount'> | null
  money: (n: number) => string
}) {
  if (!preview) return <p className="text-sm text-slate-400">Calculating…</p>
  const line = (label: ReactNode, amount: number, minus = true) => (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums text-slate-800">{minus && amount > 0 ? '−' : ''}{money(amount)}</span>
    </div>
  )
  return (
    <div>
      {line('Approved loan amount', preview.approvedAmount, false)}
      {preview.fees.map((f) => <div key={f.name}>{line(f.name, f.amount)}</div>)}
      {preview.fees.length === 0 && line('Processing / origination fees', 0)}
      {preview.insurance > 0 && line('Insurance / charges', preview.insurance)}
      {preview.savingsDeducted > 0 && line(<>Compulsory savings <Badge>to savings</Badge></>, preview.savingsDeducted)}
      {preview.otherDeductions.map((d, i) => <div key={i}>{line(d.label || 'Deduction', d.amount)}</div>)}
      <div className="mt-2 flex justify-between border-t-2 border-slate-800 pt-2 text-base font-bold">
        <span>Net to borrower</span>
        <span className={clsx('tabular-nums', preview.netAmount <= 0 ? 'text-red-600' : 'text-brand-700')}>{money(preview.netAmount)}</span>
      </div>
    </div>
  )
}
