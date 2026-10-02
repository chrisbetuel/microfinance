import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  User,
  MapPin,
  Briefcase,
  Wallet,
  PhoneCall,
  ShieldCheck,
  FileText,
  ClipboardCheck,
  Check,
  Plus,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Field, inputClass } from '../../components/ui/Field'
import { formatMoney } from '../../lib/format'
import type { BorrowerProfile, GuarantorInput } from '../../types'

const DOC_TYPES = ['NIDA / National ID', 'Passport photo', 'Business licence', 'Proof of employment', 'Bank statement', 'Other']

const emptyGuarantor = (): GuarantorInput => ({
  name: '',
  nationalId: '',
  phone: '',
  relationship: '',
  address: '',
  occupation: '',
  monthlyIncome: 0,
  guaranteeAmount: 0,
  status: 'pending',
  consentGiven: false,
})

function blankProfile(branchId: string, officerId: string): BorrowerProfile {
  return {
    type: 'individual',
    branchId,
    officerId,
    fullName: '',
    dateOfBirth: null,
    gender: '',
    nationalId: '',
    phone: '',
    altPhone: '',
    email: '',
    maritalStatus: '',
    region: '',
    district: '',
    ward: '',
    street: '',
    residence: '',
    postalAddress: '',
    incomeSource: '',
    occupation: '',
    employerName: '',
    jobTitle: '',
    employmentType: '',
    yearsEmployed: null,
    businessName: '',
    registrationNumber: '',
    taxId: '',
    sector: '',
    businessLocation: '',
    yearsTrading: null,
    dependents: null,
    monthlyIncome: 0,
    monthlyExpenses: 0,
    otherIncomeSources: '',
    existingLoans: '',
    existingLoanPayments: 0,
    bankName: '',
    bankAccount: '',
    mobileMoneyProvider: '',
    mobileMoneyNumber: '',
    nextOfKin: '',
    emergencyName: '',
    emergencyRelationship: '',
    emergencyPhone: '',
    emergencyAddress: '',
  }
}

const STEPS = [
  { id: 'personal', label: 'Personal information', icon: User },
  { id: 'address', label: 'Address', icon: MapPin },
  { id: 'work', label: 'Employment / business', icon: Briefcase },
  { id: 'finance', label: 'Financial information', icon: Wallet },
  { id: 'emergency', label: 'Emergency contact', icon: PhoneCall },
  { id: 'guarantors', label: 'Guarantors', icon: ShieldCheck },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'review', label: 'Review & save', icon: ClipboardCheck },
] as const
type StepId = (typeof STEPS)[number]['id']

export default function BorrowerForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const borrowers = useStore((s) => s.borrowers)
  const branches = useStore((s) => s.branches)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const addBorrower = useStore((s) => s.addBorrower)
  const updateBorrower = useStore((s) => s.updateBorrower)
  const uploadDoc = useStore((s) => s.uploadBorrowerDocument)

  const existing = id ? borrowers.find((b) => b.id === id) : undefined
  const editing = !!existing
  const steps = STEPS.filter((s) => !(editing && s.id === 'documents'))

  const [form, setForm] = useState<BorrowerProfile>(() => {
    if (!existing) return blankProfile(branches[0]?.id ?? '', currentStaffId)
    const { id: _i, customerNumber: _c, status: _s, guarantors: _g, documents: _d, blacklisted: _b, blacklistReason: _r, createdAt: _t, history: _h, ...profile } = existing
    return profile
  })
  const [guarantors, setGuarantors] = useState<GuarantorInput[]>(() =>
    existing ? existing.guarantors.map(({ id: _id, ...g }) => g) : [],
  )
  const [docs, setDocs] = useState<{ type: string; name: string }[]>([])
  const [step, setStep] = useState<StepId>('personal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof BorrowerProfile>(key: K, value: BorrowerProfile[K]) => setForm((f) => ({ ...f, [key]: value }))
  const text = (key: keyof BorrowerProfile) => ({
    className: inputClass,
    value: (form[key] as string | null | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set(key, e.target.value as never),
  })
  const num = (key: keyof BorrowerProfile) => ({
    type: 'number',
    min: 0,
    className: inputClass,
    value: (form[key] as number | null | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, (e.target.value === '' ? null : Number(e.target.value)) as never),
  })

  const duplicate = useMemo(
    () => (form.nationalId ? borrowers.find((b) => b.nationalId === form.nationalId && b.id !== id) : undefined),
    [borrowers, form.nationalId, id],
  )

  const stepIndex = steps.findIndex((s) => s.id === step)
  const personalOk = !!(form.fullName.trim() && form.nationalId.trim() && form.phone.trim() && form.branchId)
  const guarantorsOk = guarantors.every((g) => g.name.trim() && g.nationalId.trim() && g.phone.trim())
  const canSave = personalOk && guarantorsOk

  const disposable = form.monthlyIncome - form.monthlyExpenses - form.existingLoanPayments
  const officers = staff.filter((s) => ['loan_officer', 'branch_manager', 'lender_admin'].includes(s.role))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const payload = { ...form, nextOfKin: form.nextOfKin || form.emergencyName, guarantors }
      if (editing && existing) {
        await updateBorrower(existing.id, payload)
        navigate(`/borrowers/${existing.id}`)
      } else {
        const newId = await addBorrower(payload)
        for (const d of docs) await uploadDoc(newId, d.name, d.type)
        navigate(`/borrowers/${newId}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the borrower')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${existing?.fullName}` : 'Register borrower'}
        subtitle={editing ? `${existing?.customerNumber} · update the borrower's profile` : 'Fill in each section — only personal details are required to save'}
      />

      <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
        {/* stepper */}
        <nav className="h-fit rounded-2xl bg-white p-3">
          {steps.map((s, i) => {
            const done = i < stepIndex
            const active = s.id === step
            return (
              <button
                key={s.id}
                onClick={() => setStep(s.id)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                  active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <span
                  className={clsx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs',
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
          {step === 'personal' && (
            <Section title="Personal information" hint="Required to save: full name, NIDA number, phone and branch.">
              <Grid>
                <Field label="Customer number">
                  <input disabled className={`${inputClass} bg-slate-50`} value={existing?.customerNumber ?? 'Assigned on save'} />
                </Field>
                <Field label="Borrower type">
                  <select {...text('type')}>
                    <option value="individual">Individual</option>
                    <option value="business">Business</option>
                  </select>
                </Field>
                <Field label="Full name *">
                  <input {...text('fullName')} />
                </Field>
                <Field label="Date of birth">
                  <input type="date" {...text('dateOfBirth')} onChange={(e) => set('dateOfBirth', e.target.value || null)} />
                </Field>
                <Field label="Gender">
                  <select {...text('gender')}>
                    <option value="">Select…</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </Field>
                <Field label="Marital status">
                  <select {...text('maritalStatus')}>
                    <option value="">Select…</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="divorced">Divorced</option>
                    <option value="widowed">Widowed</option>
                  </select>
                </Field>
                <Field label="NIDA / National ID number *" error={duplicate ? `Already registered to ${duplicate.fullName} (${duplicate.customerNumber})` : undefined}>
                  <input {...text('nationalId')} />
                </Field>
                <Field label="Phone number *">
                  <input {...text('phone')} placeholder="+255 7…" />
                </Field>
                <Field label="Alternative phone">
                  <input {...text('altPhone')} />
                </Field>
                <Field label="Email">
                  <input type="email" {...text('email')} />
                </Field>
                <Field label="Branch *">
                  <select {...text('branchId')}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Loan officer">
                  <select {...text('officerId')}>
                    {officers.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </Grid>
            </Section>
          )}

          {step === 'address' && (
            <Section title="Address">
              <Grid>
                <Field label="Region"><input {...text('region')} /></Field>
                <Field label="District"><input {...text('district')} /></Field>
                <Field label="Ward"><input {...text('ward')} /></Field>
                <Field label="Street / village"><input {...text('street')} /></Field>
                <Field label="Physical address"><input {...text('residence')} placeholder="House no., landmark…" /></Field>
                <Field label="Postal address" hint="If applicable"><input {...text('postalAddress')} placeholder="P.O. Box …" /></Field>
              </Grid>
            </Section>
          )}

          {step === 'work' && (
            <Section title="Employment / business" hint="Choose how the borrower earns their income.">
              <div className="mb-5 flex flex-wrap gap-2">
                {(['employed', 'business', 'other'] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => set('incomeSource', src)}
                    className={clsx(
                      'rounded-full px-4 py-1.5 text-sm font-medium capitalize',
                      form.incomeSource === src ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    )}
                  >
                    {src === 'business' ? 'Business owner' : src}
                  </button>
                ))}
              </div>
              {form.incomeSource === 'employed' && (
                <Grid>
                  <Field label="Employer name"><input {...text('employerName')} /></Field>
                  <Field label="Job title"><input {...text('jobTitle')} /></Field>
                  <Field label="Employment type">
                    <select {...text('employmentType')}>
                      <option value="">Select…</option>
                      <option value="permanent">Permanent</option>
                      <option value="contract">Contract</option>
                      <option value="casual">Casual</option>
                      <option value="self_employed">Self-employed</option>
                    </select>
                  </Field>
                  <Field label="Years employed"><input {...num('yearsEmployed')} /></Field>
                  <Field label="Monthly income"><input {...num('monthlyIncome')} /></Field>
                </Grid>
              )}
              {form.incomeSource === 'business' && (
                <Grid>
                  <Field label="Business name"><input {...text('businessName')} /></Field>
                  <Field label="Business type"><input {...text('sector')} placeholder="e.g. Retail shop" /></Field>
                  <Field label="Business location"><input {...text('businessLocation')} /></Field>
                  <Field label="Years in business"><input {...num('yearsTrading')} /></Field>
                  <Field label="Estimated monthly income"><input {...num('monthlyIncome')} /></Field>
                  <Field label="Estimated monthly expenses"><input {...num('monthlyExpenses')} /></Field>
                  <Field label="Registration number"><input {...text('registrationNumber')} /></Field>
                  <Field label="TIN"><input {...text('taxId')} /></Field>
                </Grid>
              )}
              {form.incomeSource === 'other' && (
                <Grid>
                  <Field label="Occupation / source of income"><input {...text('occupation')} /></Field>
                  <Field label="Monthly income"><input {...num('monthlyIncome')} /></Field>
                </Grid>
              )}
              {form.incomeSource === '' && <p className="text-sm text-slate-400">Pick an option above.</p>}
            </Section>
          )}

          {step === 'finance' && (
            <Section title="Financial information" hint="Helps the system assess the borrower's ability to repay.">
              <Grid>
                <Field label="Monthly income"><input {...num('monthlyIncome')} /></Field>
                <Field label="Monthly expenses"><input {...num('monthlyExpenses')} /></Field>
                <Field label="Number of dependents"><input {...num('dependents')} /></Field>
                <Field label="Other sources of income"><input {...text('otherIncomeSources')} /></Field>
                <Field label="Existing loans" hint="Lender and amount"><input {...text('existingLoans')} /></Field>
                <Field label="Existing monthly loan payments"><input {...num('existingLoanPayments')} /></Field>
                <div />
                <Field label="Bank name"><input {...text('bankName')} /></Field>
                <Field label="Bank account number"><input {...text('bankAccount')} /></Field>
                <Field label="Mobile-money provider">
                  <select {...text('mobileMoneyProvider')}>
                    <option value="">Select…</option>
                    {['M-Pesa', 'Tigo Pesa', 'Airtel Money', 'HaloPesa', 'T-Pesa'].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Mobile-money number"><input {...text('mobileMoneyNumber')} /></Field>
              </Grid>
              <div
                className={clsx(
                  'mt-5 rounded-xl px-4 py-3 text-sm',
                  disposable > 0 ? 'bg-brand-50 text-brand-800' : 'bg-accent-50 text-accent-800',
                )}
              >
                Disposable income after expenses and existing loans: <b>{formatMoney(disposable)}</b> / month
              </div>
            </Section>
          )}

          {step === 'emergency' && (
            <Section title="Emergency contact" hint="Someone the institution can reach if the borrower can't be contacted.">
              <Grid>
                <Field label="Full name"><input {...text('emergencyName')} /></Field>
                <Field label="Relationship"><input {...text('emergencyRelationship')} placeholder="Spouse, sibling…" /></Field>
                <Field label="Phone number"><input {...text('emergencyPhone')} /></Field>
                <Field label="Address"><input {...text('emergencyAddress')} /></Field>
              </Grid>
            </Section>
          )}

          {step === 'guarantors' && (
            <Section title="Guarantors" hint="Add guarantors if the loan product requires them.">
              <div className="space-y-4">
                {guarantors.map((g, i) => {
                  const upd = (patch: Partial<GuarantorInput>) =>
                    setGuarantors((gs) => gs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                  return (
                    <div key={i} className="rounded-xl border border-slate-200 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-800">Guarantor {i + 1}</p>
                        <button onClick={() => setGuarantors((gs) => gs.filter((_, j) => j !== i))} className="text-slate-400 hover:text-accent-600">
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <Grid>
                        <Field label="Name *"><input className={inputClass} value={g.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                        <Field label="Phone *"><input className={inputClass} value={g.phone} onChange={(e) => upd({ phone: e.target.value })} /></Field>
                        <Field label="NIDA / ID number *"><input className={inputClass} value={g.nationalId} onChange={(e) => upd({ nationalId: e.target.value })} /></Field>
                        <Field label="Relationship to borrower"><input className={inputClass} value={g.relationship} onChange={(e) => upd({ relationship: e.target.value })} /></Field>
                        <Field label="Address"><input className={inputClass} value={g.address} onChange={(e) => upd({ address: e.target.value })} /></Field>
                        <Field label="Employment / business"><input className={inputClass} value={g.occupation} onChange={(e) => upd({ occupation: e.target.value })} /></Field>
                        <Field label="Monthly income"><input type="number" min={0} className={inputClass} value={g.monthlyIncome} onChange={(e) => upd({ monthlyIncome: Number(e.target.value) })} /></Field>
                        <Field label="Guarantee amount"><input type="number" min={0} className={inputClass} value={g.guaranteeAmount} onChange={(e) => upd({ guaranteeAmount: Number(e.target.value) })} /></Field>
                        <Field label="Status">
                          <select className={inputClass} value={g.status} onChange={(e) => upd({ status: e.target.value as GuarantorInput['status'] })}>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </Field>
                        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                          <input type="checkbox" checked={g.consentGiven} onChange={(e) => upd({ consentGiven: e.target.checked })} />
                          Consent given
                        </label>
                      </Grid>
                    </div>
                  )
                })}
                <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setGuarantors((gs) => [...gs, emptyGuarantor()])}>
                  Add guarantor
                </Button>
              </div>
            </Section>
          )}

          {step === 'documents' && (
            <Section title="Documents" hint="Attach supporting documents. You can add more later from the borrower's file.">
              <div className="space-y-3">
                {DOC_TYPES.map((type) => {
                  const attached = docs.filter((d) => d.type === type)
                  return (
                    <div key={type} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{type}</p>
                        <p className="text-xs text-slate-400">{attached.length ? attached.map((d) => d.name).join(', ') : 'Not attached'}</p>
                      </div>
                      <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                        Choose file
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) setDocs((d) => [...d, { type, name: f.name }])
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
            <Section title="Review & save">
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <Row k="Full name" v={form.fullName} />
                <Row k="NIDA" v={form.nationalId} />
                <Row k="Phone" v={form.phone} />
                <Row k="Branch" v={branches.find((b) => b.id === form.branchId)?.name} />
                <Row k="Address" v={[form.street, form.ward, form.district, form.region].filter(Boolean).join(', ')} />
                <Row k="Income source" v={form.incomeSource} />
                <Row k="Monthly income" v={formatMoney(form.monthlyIncome)} />
                <Row k="Disposable income" v={formatMoney(disposable)} />
                <Row k="Emergency contact" v={form.emergencyName && `${form.emergencyName} (${form.emergencyRelationship || '—'})`} />
                <Row k="Guarantors" v={String(guarantors.length)} />
                {!editing && <Row k="Documents" v={String(docs.length)} />}
              </dl>
              {!personalOk && (
                <p className="mt-5 flex items-center gap-2 rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-800">
                  <AlertTriangle size={15} /> Complete the required personal information first.
                </p>
              )}
              {!guarantorsOk && (
                <p className="mt-3 flex items-center gap-2 rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-800">
                  <AlertTriangle size={15} /> Every guarantor needs a name, ID number and phone.
                </p>
              )}
              {error && <p className="mt-3 rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-800">{error}</p>}
            </Section>
          )}

          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
            <Button
              variant="ghost"
              onClick={() => (stepIndex === 0 ? navigate(-1) : setStep(steps[stepIndex - 1].id))}
            >
              {stepIndex === 0 ? 'Cancel' : 'Back'}
            </Button>
            <div className="flex gap-2">
              {step !== 'review' && canSave && (
                <Button variant="secondary" disabled={busy} onClick={save}>
                  Save now
                </Button>
              )}
              {step === 'review' ? (
                <Button disabled={!canSave || busy} onClick={save}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Register borrower'}
                </Button>
              ) : (
                <Button onClick={() => setStep(steps[stepIndex + 1].id)}>Continue</Button>
              )}
            </div>
          </div>
        </Card>
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
