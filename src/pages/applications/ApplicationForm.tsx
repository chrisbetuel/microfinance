import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { User, Banknote, Calculator, History, ShieldCheck, Gem, Users2, FileText, ClipboardCheck, Check, X, Plus } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import type { ApplicationInput, Borrower, DisbursementChannel, EligibilityCheck, GuarantorInput, LoanProduct } from '../../types'
import {
  BorrowingSummary,
  CapacityPanel,
  EligibilityList,
  DISBURSEMENT_LABEL,
  GroupSnapshot,
  capacityOf,
  firstInstalment,
  monthlyEquivalent,
  requiredDocuments,
} from './ApplicationParts'

const STEPS = [
  { id: 'applicant', label: 'Applicant', icon: User },
  { id: 'loan', label: 'Loan details', icon: Banknote },
  { id: 'financial', label: 'Financial assessment', icon: Calculator },
  { id: 'history', label: 'Previous borrowing', icon: History },
  { id: 'guarantors', label: 'Guarantors', icon: ShieldCheck },
  { id: 'collateral', label: 'Collateral', icon: Gem },
  { id: 'group', label: 'Group information', icon: Users2 },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'review', label: 'Review & submit', icon: ClipboardCheck },
] as const
type StepId = (typeof STEPS)[number]['id']

const FREQ_LABEL: Record<LoanProduct['repaymentFrequency'], string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  fortnightly: 'Every two weeks',
  monthly: 'Monthly',
}

function addPeriod(date: Date, frequency: LoanProduct['repaymentFrequency']): Date {
  const d = new Date(date)
  if (frequency === 'daily') d.setDate(d.getDate() + 1)
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7)
  else if (frequency === 'fortnightly') d.setDate(d.getDate() + 14)
  else d.setMonth(d.getMonth() + 1)
  return d
}
const iso = (d: Date) => d.toLocaleDateString('en-CA') // local YYYY-MM-DD

/** The product's default first repayment date (mirrors services/products.first_repayment_date). */
function defaultFirstRepayment(p: LoanProduct): string {
  if (p.firstRepaymentRule === 'day_of_month' && p.firstRepaymentDay) {
    const earliest = new Date(Date.now() + 14 * 864e5)
    const d = new Date(earliest.getFullYear(), earliest.getMonth(), Math.min(p.firstRepaymentDay, 28))
    if (d < earliest) d.setMonth(d.getMonth() + 1)
    return iso(d)
  }
  return iso(addPeriod(new Date(), p.repaymentFrequency))
}

function fromBorrower(b: Borrower | undefined) {
  return {
    declaredIncome: b?.monthlyIncome ?? 0,
    declaredExpenses: b?.monthlyExpenses ?? 0,
    existingRepayments: b?.existingLoanPayments ?? 0,
    dependents: b?.dependents ?? 0,
  }
}

export default function ApplicationForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const canEdit = useCanEdit()
  const borrowers = useStore((s) => s.borrowers)
  const allProducts = useStore((s) => s.products)
  const groups = useStore((s) => s.groups)
  const staff = useStore((s) => s.staff)
  const branches = useStore((s) => s.branches)
  const allCollateral = useStore((s) => s.collateral)
  const currency = useStore((s) => s.lender.currency)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const existing = useStore((s) => (id ? s.applications.find((a) => a.id === id) : undefined))
  const createApplication = useStore((s) => s.createApplication)
  const updateApplication = useStore((s) => s.updateApplication)
  const addApplicationDocument = useStore((s) => s.addApplicationDocument)
  const addGuarantor = useStore((s) => s.addGuarantor)
  const addCollateral = useStore((s) => s.addCollateral)

  const products = useMemo(() => allProducts.filter((p) => p.active), [allProducts])
  const editing = !!existing
  const eligible = borrowers.filter((b) => !b.blacklisted && b.status !== 'suspended' && b.status !== 'blacklisted')

  const [kind, setKind] = useState<'individual' | 'group'>(existing?.groupId ? 'group' : 'individual')
  const [form, setForm] = useState<ApplicationInput>(() => {
    if (existing) {
      return {
        borrowerId: existing.borrowerId, productId: existing.productId, branchId: existing.branchId, groupId: existing.groupId,
        amount: existing.requestedAmount || existing.amount, termInstalments: existing.requestedTerm || existing.termInstalments,
        purpose: existing.purpose, declaredIncome: existing.declaredIncome, declaredExpenses: existing.declaredExpenses,
        creditBureauConsent: existing.creditBureauConsent, loanOfficerId: existing.loanOfficerId,
        disbursementMethod: existing.disbursementMethod, firstRepaymentDate: existing.firstRepaymentDate,
        groupMemberIds: existing.groupMemberIds, guarantorIds: existing.guarantorIds, collateralIds: existing.collateralIds,
        otherIncome: existing.otherIncome, businessIncome: existing.businessIncome, businessExpenses: existing.businessExpenses,
        existingLoansCount: existing.existingLoansCount, existingRepayments: existing.existingRepayments, dependents: existing.dependents,
      }
    }
    const params = new URLSearchParams(window.location.search)
    const b = eligible.find((x) => x.id === params.get('borrower')) ?? eligible[0]
    const p = products[0]
    return {
      borrowerId: b?.id ?? '', productId: p?.id ?? '', groupId: null, amount: p?.minAmount ?? 0,
      termInstalments: p?.minTermInstalments ?? 1, purpose: '', creditBureauConsent: false,
      loanOfficerId: b?.officerId ?? currentStaffId, disbursementMethod: 'mobile_money',
      firstRepaymentDate: p ? defaultFirstRepayment(p) : null,
      groupMemberIds: [], guarantorIds: [], collateralIds: [], otherIncome: 0, businessIncome: 0, businessExpenses: 0,
      existingLoansCount: 0, ...fromBorrower(b),
    }
  })
  const [docs, setDocs] = useState<{ type: string; name: string }[]>([])
  const [eligibility, setEligibility] = useState<EligibilityCheck[]>([])
  const loadEligibility = useStore((s) => s.loadEligibility)
  useEffect(() => {
    if (!form.productId || !form.borrowerId) return
    const t = setTimeout(() => {
      loadEligibility({
        productId: form.productId, borrowerId: form.borrowerId, amount: form.amount, term: form.termInstalments,
        groupId: kind === 'group' ? form.groupId : null,
        income: form.declaredIncome + form.otherIncome + form.businessIncome - form.businessExpenses,
      }).then(setEligibility).catch(() => setEligibility([]))
    }, 300)
    return () => clearTimeout(t)
  }, [form.productId, form.borrowerId, form.amount, form.termInstalments, form.groupId, form.declaredIncome, form.otherIncome, form.businessIncome, form.businessExpenses, kind, loadEligibility])
  const [step, setStep] = useState<StepId>('applicant')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof ApplicationInput>(k: K, v: ApplicationInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (k: keyof ApplicationInput) => ({
    type: 'number',
    min: 0,
    className: inputClass,
    value: Number(form[k] ?? 0),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never),
  })

  const borrower = borrowers.find((b) => b.id === form.borrowerId)
  const product = products.find((p) => p.id === form.productId) ?? allProducts.find((p) => p.id === form.productId)
  const group = groups.find((g) => g.id === form.groupId)
  const borrowerGroups = groups.filter((g) => g.status !== 'closed' && g.memberships.some((m) => m.status === 'active'))
  const security = product?.securityRequired ?? []
  const guarantors = borrower?.guarantors ?? []
  const collateral = allCollateral.filter(
    (c) => c.borrowerId === form.borrowerId && (form.collateralIds.includes(c.id) || (!c.loanId && c.status !== 'released' && c.status !== 'seized')),
  )
  const steps = STEPS.filter((s) => s.id !== 'group' || kind === 'group')
  const idx = steps.findIndex((s) => s.id === step)

  const withinAmount = product ? form.amount >= product.minAmount && form.amount <= product.maxAmount : false
  const withinTerm = product ? form.termInstalments >= product.minTermInstalments && form.termInstalments <= product.maxTermInstalments : false
  const instalment = firstInstalment(product, form.amount, form.termInstalments)
  const capacity = capacityOf(form)
  const required = requiredDocuments({
    product, businessIncome: form.businessIncome, hasGroup: kind === 'group',
    hasGuarantors: form.guarantorIds.length > 0, hasCollateral: form.collateralIds.length > 0,
  })
  const existingDocs = existing?.documents ?? []
  const docsOf = (type: string) => [...existingDocs.filter((d) => d.type === type), ...docs.filter((d) => d.type === type)]

  const problems = [
    !borrower && 'Choose the applicant',
    kind === 'group' && !group && 'Choose the group',
    !product && 'Choose a loan product',
    product && !withinAmount && `Amount must be ${formatMoney(product.minAmount, currency)}–${formatMoney(product.maxAmount, currency)}`,
    product && !withinTerm && `Repayment period must be ${product.minTermInstalments}–${product.maxTermInstalments} instalments`,
    !form.purpose.trim() && 'Give the purpose of the loan',
    form.declaredIncome <= 0 && 'Enter the monthly income',
    ...eligibility.filter((c) => !c.ok && !['Amount', 'Repayment period'].includes(c.rule)).map((c) => `${c.rule}: ${c.detail}`),
  ].filter(Boolean) as string[]
  const warnings = [
    security.includes('guarantors') && form.guarantorIds.length === 0 && 'This product requires a guarantor',
    security.includes('collateral') && form.collateralIds.length === 0 && 'This product requires collateral',
    monthlyEquivalent(instalment, product?.repaymentFrequency ?? 'monthly') > capacity.maxInstalment && 'Instalment exceeds the repayment capacity',
    required.filter((r) => r.required && docsOf(r.type).length === 0).length > 0 &&
      `${required.filter((r) => r.required && docsOf(r.type).length === 0).length} required document(s) not attached`,
  ].filter(Boolean) as string[]

  function pickBorrower(bid: string) {
    const b = borrowers.find((x) => x.id === bid)
    setForm((f) => ({
      ...f,
      borrowerId: bid,
      loanOfficerId: b?.officerId ?? f.loanOfficerId,
      guarantorIds: [],
      collateralIds: [],
      groupMemberIds: f.groupId ? Array.from(new Set([...f.groupMemberIds, bid])) : [],
      ...fromBorrower(b),
    }))
  }

  function pickGroup(gid: string) {
    const g = groups.find((x) => x.id === gid)
    const active = g?.memberships.filter((m) => m.status === 'active') ?? []
    const rep = active.find((m) => m.role === 'chair') ?? active[0]
    setForm((f) => ({ ...f, groupId: gid || null, groupMemberIds: active.map((m) => m.borrowerId) }))
    if (rep) pickBorrower(rep.borrowerId)
  }

  async function save(mode: 'draft' | 'submit' | 'update') {
    setBusy(true)
    setError(null)
    try {
      const payload = { ...form, groupId: kind === 'group' ? form.groupId : null, groupMemberIds: kind === 'group' ? form.groupMemberIds : [] }
      if (mode === 'update' && existing) {
        const { borrowerId: _b, branchId: _br, ...patch } = payload
        await updateApplication(existing.id, patch)
        for (const d of docs) await addApplicationDocument(existing.id, d.type, d.name)
        navigate(`/applications/${existing.id}`)
      } else {
        const newId = await createApplication({ ...payload, branchId: borrower?.branchId, draft: mode === 'draft', documents: docs })
        navigate(`/applications/${newId}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the application')
    } finally {
      setBusy(false)
    }
  }

  if (!canEdit) return <p className="text-sm text-slate-500">Your account has view-only access to applications.</p>
  if (editing && existing && !['draft', 'submitted', 'under_assessment'].includes(existing.status)) {
    return <p className="text-sm text-slate-500">This application has gone for approval and can no longer be edited.</p>
  }

  const money = (n: number) => formatMoney(n, currency)

  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${existing?.reference}` : 'New loan application'}
        subtitle="Who is borrowing, how much, why, how they will repay, and what the risk is"
      />
      <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
        <nav className="h-fit rounded-2xl bg-white p-3">
          {steps.map((s, i) => {
            const active = s.id === step
            const done = i < idx
            return (
              <button
                key={s.id}
                onClick={() => setStep(s.id)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm',
                  active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <span
                  className={clsx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    active ? 'bg-brand-600 text-white' : done ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400',
                  )}
                >
                  {done ? <Check size={13} /> : <s.icon size={13} />}
                </span>
                {s.label}
              </button>
            )
          })}
        </nav>

        <Card className="p-6 sm:p-7">
          {step === 'applicant' && (
            <Section title="Applicant information">
              {!editing && (
                <div className="mb-5 grid grid-cols-2 gap-2 sm:w-96">
                  {(['individual', 'group'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        setKind(k)
                        if (k === 'individual') setForm((f) => ({ ...f, groupId: null, groupMemberIds: [] }))
                        else if (borrowerGroups[0] && !form.groupId) pickGroup(borrowerGroups[0].id)
                      }}
                      className={clsx(
                        'rounded-xl border px-3 py-2.5 text-sm font-medium',
                        kind === k ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600',
                      )}
                    >
                      {k === 'individual' ? 'Individual loan' : 'Group loan'}
                    </button>
                  ))}
                </div>
              )}
              <Grid>
                {kind === 'group' && (
                  <Field label="Group">
                    <select disabled={editing} className={inputClass} value={form.groupId ?? ''} onChange={(e) => pickGroup(e.target.value)}>
                      <option value="">Select a group…</option>
                      {borrowerGroups.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.groupNumber}</option>)}
                    </select>
                  </Field>
                )}
                <Field label={kind === 'group' ? 'Applying member (representative)' : 'Borrower'}>
                  <select disabled={editing} className={inputClass} value={form.borrowerId} onChange={(e) => pickBorrower(e.target.value)}>
                    {(kind === 'group' && group
                      ? eligible.filter((b) => group.memberships.some((m) => m.borrowerId === b.id && m.status === 'active'))
                      : eligible
                    ).map((b) => <option key={b.id} value={b.id}>{b.fullName} · {b.customerNumber}</option>)}
                  </select>
                </Field>
                <Field label="Loan officer">
                  <select className={inputClass} value={form.loanOfficerId ?? ''} onChange={(e) => set('loanOfficerId', e.target.value || null)}>
                    {staff.filter((s) => s.active && ['loan_officer', 'branch_manager', 'lender_admin'].includes(s.role)).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Application date">
                  <input disabled className={`${inputClass} bg-slate-50`} value={formatDate(existing?.applicationDate ?? new Date().toISOString())} />
                </Field>
              </Grid>
              {borrower && (
                <dl className="mt-5 grid gap-x-8 gap-y-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                  <Row k={kind === 'group' ? 'Group / customer ID' : 'Customer ID'} v={[group?.groupNumber, borrower.customerNumber].filter(Boolean).join(' · ')} />
                  <Row k="Phone" v={borrower.phone} />
                  <Row k="Address" v={[borrower.street, borrower.ward, borrower.district, borrower.region].filter(Boolean).join(', ')} />
                  <Row k="Branch / office" v={branches.find((b) => b.id === borrower.branchId)?.name} />
                  <Row k="Profile" v={`${borrower.status}${borrower.verified ? ' · verified' : ' · not verified'}`} />
                </dl>
              )}
              {kind === 'group' && group && (
                <div className="mt-5">
                  <p className="mb-2 text-sm font-medium text-slate-700">Members included in this application</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.memberships.filter((m) => m.status === 'active').map((m) => {
                      const on = form.groupMemberIds.includes(m.borrowerId)
                      const isApplicant = m.borrowerId === form.borrowerId
                      return (
                        <label key={m.id} className={clsx('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm', on ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200')}>
                          <input
                            type="checkbox"
                            disabled={isApplicant}
                            checked={on || isApplicant}
                            onChange={(e) => set('groupMemberIds', e.target.checked ? [...form.groupMemberIds, m.borrowerId] : form.groupMemberIds.filter((x) => x !== m.borrowerId))}
                          />
                          <span className="flex-1">{m.borrowerName}</span>
                          <span className="text-xs capitalize text-slate-400">{isApplicant ? 'applicant' : m.role}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </Section>
          )}

          {step === 'loan' && (
            <Section title="Loan details">
              <Grid>
                <Field label="Loan product">
                  <select
                    className={inputClass}
                    value={form.productId}
                    onChange={(e) => {
                      const p = products.find((x) => x.id === e.target.value)
                      setForm((f) => ({
                        ...f,
                        productId: e.target.value,
                        amount: p ? p.defaultAmount ?? Math.min(Math.max(f.amount, p.minAmount), p.maxAmount) : f.amount,
                        termInstalments: p ? p.defaultTerm ?? Math.min(Math.max(f.termInstalments, p.minTermInstalments), p.maxTermInstalments) : f.termInstalments,
                        firstRepaymentDate: p ? defaultFirstRepayment(p) : f.firstRepaymentDate,
                      }))
                    }}
                  >
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field
                  label="Requested amount"
                  hint={product ? `${money(product.minAmount)} – ${money(product.maxAmount)}` : undefined}
                  error={product && !withinAmount ? 'Outside the product range' : undefined}
                >
                  <input {...num('amount')} />
                </Field>
                <Field
                  label="Repayment period (instalments)"
                  hint={product ? `${product.minTermInstalments}–${product.maxTermInstalments}` : undefined}
                  error={product && !withinTerm ? 'Outside the product range' : undefined}
                >
                  <input {...num('termInstalments')} />
                </Field>
                <Field label="Repayment frequency" hint="Set by the loan product">
                  <input disabled className={`${inputClass} bg-slate-50`} value={product ? FREQ_LABEL[product.repaymentFrequency] : '—'} />
                </Field>
                <Field label="Preferred disbursement method">
                  <select className={inputClass} value={form.disbursementMethod} onChange={(e) => set('disbursementMethod', e.target.value as DisbursementChannel)}>
                    {Object.entries(DISBURSEMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Proposed first repayment date">
                  <input type="date" className={inputClass} value={form.firstRepaymentDate ?? ''} min={iso(new Date(Date.now() + 864e5))} onChange={(e) => set('firstRepaymentDate', e.target.value || null)} />
                </Field>
              </Grid>
              <div className="mt-4">
                <Field label="Purpose of the loan">
                  <textarea rows={3} className={inputClass} value={form.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="e.g. Buy stock of maize flour for the shop" />
                </Field>
              </div>
              {product?.description && <p className="mt-4 text-sm text-slate-500">{product.description}</p>}
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium text-slate-700">Product eligibility</p>
                <EligibilityList checks={eligibility} empty="Checking the product's rules…" />
              </div>
              {product && instalment > 0 && (
                <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
                  Estimated instalment <b>{money(instalment)}</b> {FREQ_LABEL[product.repaymentFrequency].toLowerCase()} at {product.interestRate}% {product.interestMethod}.
                </p>
              )}
            </Section>
          )}

          {step === 'financial' && (
            <Section title="Financial assessment" hint="Pre-filled from the borrower's profile. Update with what the applicant declares today.">
              <Grid>
                <Field label="Monthly income"><input {...num('declaredIncome')} /></Field>
                <Field label="Other income (monthly)"><input {...num('otherIncome')} /></Field>
                <Field label="Monthly expenses"><input {...num('declaredExpenses')} /></Field>
                <Field label="Number of dependents"><input {...num('dependents')} /></Field>
                <Field label="Existing loans (other lenders)"><input {...num('existingLoansCount')} /></Field>
                <Field label="Existing monthly repayments"><input {...num('existingRepayments')} /></Field>
                <Field label="Business income (monthly, if any)"><input {...num('businessIncome')} /></Field>
                <Field label="Business expenses (monthly)"><input {...num('businessExpenses')} /></Field>
              </Grid>
              <div className="mt-5">
                <CapacityPanel figures={form} instalment={instalment} frequency={product?.repaymentFrequency ?? 'monthly'} currency={currency} />
              </div>
              <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5" checked={form.creditBureauConsent} onChange={(e) => set('creditBureauConsent', e.target.checked)} />
                The applicant has given written consent for a credit bureau check.
              </label>
            </Section>
          )}

          {step === 'history' && (
            <Section title="Previous borrowing" hint="Pulled automatically from the system. Nothing to enter here.">
              {borrower ? <BorrowingSummary borrowerId={borrower.id} excludeApplicationId={existing?.id} /> : <p className="text-sm text-slate-400">Choose an applicant first.</p>}
            </Section>
          )}

          {step === 'guarantors' && borrower && (
            <Section
              title="Guarantors"
              hint={security.includes('guarantors') ? 'This product requires at least one guarantor.' : 'Optional for this product.'}
            >
              <div className="space-y-2">
                {guarantors.length === 0 && <p className="text-sm text-slate-400">No guarantors on this borrower's profile yet.</p>}
                {guarantors.map((g) => {
                  const on = form.guarantorIds.includes(g.id)
                  return (
                    <label key={g.id} className={clsx('flex gap-3 rounded-xl border p-3 text-sm', on ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200')}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={(e) => set('guarantorIds', e.target.checked ? [...form.guarantorIds, g.id] : form.guarantorIds.filter((x) => x !== g.id))}
                      />
                      <div className="grid flex-1 gap-x-6 gap-y-0.5 sm:grid-cols-3">
                        <p className="font-semibold text-slate-800 sm:col-span-3">
                          {g.name}{' '}
                          <Badge tone={g.status === 'approved' ? 'green' : g.status === 'rejected' ? 'red' : 'amber'}>
                            {g.status === 'approved' ? 'Verified' : g.status === 'rejected' ? 'Rejected' : 'Not verified'}
                          </Badge>
                        </p>
                        <Small k="Phone" v={g.phone} />
                        <Small k="ID" v={g.nationalId} />
                        <Small k="Relationship" v={g.relationship} />
                        <Small k="Address" v={g.address} />
                        <Small k="Employment / business" v={g.occupation} />
                        <Small k="Guaranteed amount" v={money(g.guaranteeAmount)} />
                      </div>
                    </label>
                  )
                })}
              </div>
              <NewGuarantor
                onAdd={async (input) => {
                  const g = await addGuarantor(borrower.id, input)
                  set('guarantorIds', [...form.guarantorIds, g.id])
                }}
              />
            </Section>
          )}

          {step === 'collateral' && borrower && (
            <Section
              title="Collateral / security"
              hint={security.includes('collateral') ? 'This product requires collateral.' : 'Optional for this product.'}
            >
              <div className="space-y-2">
                {collateral.length === 0 && <p className="text-sm text-slate-400">No free collateral recorded for this borrower.</p>}
                {collateral.map((c) => {
                  const on = form.collateralIds.includes(c.id)
                  return (
                    <label key={c.id} className={clsx('flex gap-3 rounded-xl border p-3 text-sm', on ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200')}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={(e) => set('collateralIds', e.target.checked ? [...form.collateralIds, c.id] : form.collateralIds.filter((x) => x !== c.id))}
                      />
                      <div className="grid flex-1 gap-x-6 gap-y-0.5 sm:grid-cols-3">
                        <p className="font-semibold text-slate-800 sm:col-span-3">{c.assetType}: {c.description}</p>
                        <Small k="Estimated value" v={money(c.estimatedValue)} />
                        <Small k="Ownership" v={[c.ownerName, c.ownershipDocument].filter(Boolean).join(' · ')} />
                        <Small k="Valuation" v={[c.valuationDate && formatDate(c.valuationDate), c.valuedBy].filter(Boolean).join(' · ')} />
                        <Small k="Existing claims" v={c.existingClaims || 'None declared'} />
                        <Small k="Documents" v={c.documents?.join(', ')} />
                      </div>
                    </label>
                  )
                })}
              </div>
              {form.collateralIds.length > 0 && (
                <p className="mt-3 text-sm text-slate-600">
                  Total security value{' '}
                  <b>{money(collateral.filter((c) => form.collateralIds.includes(c.id)).reduce((s, c) => s + c.estimatedValue, 0))}</b> against{' '}
                  {money(form.amount)} requested.
                </p>
              )}
              <NewCollateral
                ownerName={borrower.fullName}
                onAdd={async (input) => {
                  const c = await addCollateral(borrower.id, input)
                  set('collateralIds', [...form.collateralIds, c.id])
                }}
              />
            </Section>
          )}

          {step === 'group' && (
            <Section title="Group information" hint="Pulled automatically from the group's records.">
              {group ? <GroupSnapshot group={group} memberIds={form.groupMemberIds} /> : <p className="text-sm text-slate-400">Choose a group on the Applicant step.</p>}
            </Section>
          )}

          {step === 'documents' && (
            <Section title="Documents" hint="Each document starts as pending and is verified by staff on the application page.">
              <div className="space-y-2">
                {required.map((r) => {
                  const attached = docsOf(r.type)
                  return (
                    <div key={r.type} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {r.type} {r.required ? <Badge tone="amber">Required</Badge> : <Badge>Optional</Badge>}
                        </p>
                        <p className="text-xs text-slate-400">{r.why}</p>
                        {attached.length > 0 && (
                          <p className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                            {attached.map((d, i) => (
                              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                                {d.name}
                                {'status' in d ? (
                                  <span className="text-slate-400">· {String(d.status)}</span>
                                ) : (
                                  <button onClick={() => setDocs((all) => all.filter((x) => x !== d))} className="text-slate-400 hover:text-accent-600">
                                    <X size={11} />
                                  </button>
                                )}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                        Upload
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) setDocs((d) => [...d, { type: r.type, name: f.name }])
                            e.target.value = ''
                          }}
                        />
                      </label>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {step === 'review' && (
            <Section title="Review & submit" hint="Submitted applications go to a loan officer for assessment, then to an approver.">
              <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <Row k="Applicant" v={borrower ? `${borrower.fullName} (${borrower.customerNumber})` : undefined} />
                {kind === 'group' && <Row k="Group" v={group ? `${group.name}, ${form.groupMemberIds.length} member(s)` : undefined} />}
                <Row k="Product" v={product?.name} />
                <Row k="Requested" v={`${money(form.amount)} over ${form.termInstalments} instalments`} />
                <Row k="Instalment" v={money(instalment)} />
                <Row k="First repayment" v={form.firstRepaymentDate ? formatDate(form.firstRepaymentDate) : '—'} />
                <Row k="Disbursement" v={form.disbursementMethod ? DISBURSEMENT_LABEL[form.disbursementMethod] : '—'} />
                <Row k="Loan officer" v={staff.find((s) => s.id === form.loanOfficerId)?.name} />
                <Row k="Free cash / max instalment" v={`${money(capacity.disposable)} / ${money(capacity.maxInstalment)}`} />
                <Row k="Guarantors · collateral" v={`${form.guarantorIds.length} · ${form.collateralIds.length}`} />
                <Row k="Documents" v={String(existingDocs.length + docs.length)} />
              </dl>
              {problems.length > 0 && (
                <ul className="mt-5 space-y-1.5">
                  {problems.map((p) => <li key={p} className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-800">{p}</li>)}
                </ul>
              )}
              {warnings.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {warnings.map((w) => <li key={w} className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">⚠ {w}. The assessor will see this.</li>)}
                </ul>
              )}
              {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
            </Section>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-5">
            <Button variant="ghost" onClick={() => (idx === 0 ? navigate(-1) : setStep(steps[idx - 1].id))}>
              {idx === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step === 'review' ? (
              editing ? (
                <Button disabled={busy || problems.length > 0} onClick={() => save('update')}>Save changes</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busy || !borrower || !product} onClick={() => save('draft')}>Save as draft</Button>
                  <Button disabled={busy || problems.length > 0} onClick={() => save('submit')}>Submit application</Button>
                </div>
              )
            ) : (
              <Button onClick={() => setStep(steps[idx + 1].id)}>Continue</Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function NewGuarantor({ onAdd }: { onAdd: (g: GuarantorInput) => Promise<void> }) {
  const blank: GuarantorInput = {
    name: '', nationalId: '', phone: '', relationship: '', address: '', occupation: '', monthlyIncome: 0,
    guaranteeAmount: 0, status: 'pending', consentGiven: false,
  }
  const [open, setOpen] = useState(false)
  const [g, setG] = useState(blank)
  const [busy, setBusy] = useState(false)
  const txt = (k: keyof GuarantorInput) => ({
    className: inputClass,
    value: String(g[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setG({ ...g, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }),
  })
  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mt-4" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
        Add guarantor
      </Button>
    )
  }
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4">
      <Grid>
        <Field label="Guarantor name"><input {...txt('name')} /></Field>
        <Field label="Phone"><input {...txt('phone')} /></Field>
        <Field label="ID (NIDA)"><input {...txt('nationalId')} /></Field>
        <Field label="Relationship"><input {...txt('relationship')} /></Field>
        <Field label="Address"><input {...txt('address')} /></Field>
        <Field label="Employment / business"><input {...txt('occupation')} /></Field>
        <Field label="Guaranteed amount"><input type="number" {...txt('guaranteeAmount')} /></Field>
        <Field label="Monthly income"><input type="number" {...txt('monthlyIncome')} /></Field>
      </Grid>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={g.consentGiven} onChange={(e) => setG({ ...g, consentGiven: e.target.checked })} />
        Guarantor has signed consent
      </label>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          disabled={busy || !g.name.trim() || !g.phone.trim() || !g.nationalId.trim()}
          onClick={async () => {
            setBusy(true)
            try {
              await onAdd({ ...g, consentDate: g.consentGiven ? new Date().toISOString().slice(0, 10) : null })
              setG(blank)
              setOpen(false)
            } finally {
              setBusy(false)
            }
          }}
        >
          Save guarantor
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}

function NewCollateral({
  ownerName,
  onAdd,
}: {
  ownerName: string
  onAdd: (c: {
    assetType: string; description: string; estimatedValue: number; ownerName: string; ownershipDocument: string
    valuationDate: string | null; valuedBy: string; existingClaims: string; documents: string[]
  }) => Promise<void>
}) {
  const blank = {
    assetType: 'Motor vehicle', description: '', estimatedValue: 0, ownerName, ownershipDocument: '',
    valuationDate: new Date().toISOString().slice(0, 10) as string | null, valuedBy: '', existingClaims: '', documents: [] as string[],
  }
  const [open, setOpen] = useState(false)
  const [c, setC] = useState(blank)
  const [busy, setBusy] = useState(false)
  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mt-4" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
        Add collateral
      </Button>
    )
  }
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4">
      <Grid>
        <Field label="Collateral type">
          <select className={inputClass} value={c.assetType} onChange={(e) => setC({ ...c, assetType: e.target.value })}>
            {['Motor vehicle', 'Motorcycle', 'Land / title deed', 'Household goods', 'Business equipment', 'Livestock', 'Savings / deposit', 'Other'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Description"><input className={inputClass} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} placeholder="Make, model, plot no., serial…" /></Field>
        <Field label="Estimated value"><input type="number" className={inputClass} value={c.estimatedValue} onChange={(e) => setC({ ...c, estimatedValue: Number(e.target.value) })} /></Field>
        <Field label="Owner"><input className={inputClass} value={c.ownerName} onChange={(e) => setC({ ...c, ownerName: e.target.value })} /></Field>
        <Field label="Ownership document no."><input className={inputClass} value={c.ownershipDocument} onChange={(e) => setC({ ...c, ownershipDocument: e.target.value })} placeholder="Title / card / logbook number" /></Field>
        <Field label="Valuation date"><input type="date" className={inputClass} value={c.valuationDate ?? ''} onChange={(e) => setC({ ...c, valuationDate: e.target.value || null })} /></Field>
        <Field label="Valued by"><input className={inputClass} value={c.valuedBy} onChange={(e) => setC({ ...c, valuedBy: e.target.value })} /></Field>
        <Field label="Existing claims on the asset"><input className={inputClass} value={c.existingClaims} onChange={(e) => setC({ ...c, existingClaims: e.target.value })} placeholder="e.g. None / pledged to XYZ Bank" /></Field>
      </Grid>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        {c.documents.map((d) => <span key={d} className="rounded-full bg-slate-100 px-2 py-0.5">{d}</span>)}
        <label className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 font-medium hover:bg-slate-50">
          Attach supporting document
          <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setC({ ...c, documents: [...c.documents, f.name] }); e.target.value = '' }} />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          disabled={busy || !c.description.trim() || c.estimatedValue <= 0}
          onClick={async () => {
            setBusy(true)
            try {
              await onAdd(c)
              setC(blank)
              setOpen(false)
            } finally {
              setBusy(false)
            }
          }}
        >
          Save collateral
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      <div className="mt-5">{children}</div>
    </div>
  )
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-800">{v || '—'}</dd>
    </div>
  )
}

function Small({ k, v }: { k: string; v?: string | null }) {
  return (
    <p className="text-xs">
      <span className="text-slate-400">{k}: </span>
      <span className="text-slate-700">{v || '—'}</span>
    </p>
  )
}
