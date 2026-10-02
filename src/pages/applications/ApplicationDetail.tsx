import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { CheckCircle2, XCircle, FileText, Pencil, Send, ClipboardList, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { STAFF_ROLE_LABELS } from '../../types'
import type { Application, AssessmentResult } from '../../types'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import { NAV_ACCESS } from '../../lib/permissions'
import { useCanEdit } from '../../lib/useCanEdit'
import {
  APP_STATUS_LABEL,
  ASSESSMENT_LABEL,
  ASSESSMENT_TONE,
  BorrowingSummary,
  CapacityPanel,
  DISBURSEMENT_LABEL,
  GroupSnapshot,
  StagePipeline,
  firstInstalment,
  requiredDocuments,
} from './ApplicationParts'

function CheckRow({ label, pass }: { label: string; pass: boolean }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {pass ? <CheckCircle2 size={16} className="text-emerald-600" /> : <XCircle size={16} className="text-red-600" />}
      <span className={pass ? 'text-slate-700' : 'text-red-700'}>{label}</span>
    </li>
  )
}

const FREQ: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', fortnightly: 'Every two weeks', monthly: 'Monthly' }

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const application = useStore((s) => s.applications.find((a) => a.id === id))
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === application?.borrowerId))
  const product = useStore((s) => s.products.find((p) => p.id === application?.productId))
  const group = useStore((s) => s.groups.find((g) => g.id === application?.groupId))
  const allCollateral = useStore((s) => s.collateral)
  const branches = useStore((s) => s.branches)
  const lender = useStore((s) => s.lender)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const submitApplication = useStore((s) => s.submitApplication)
  const startAssessment = useStore((s) => s.startAssessment)
  const verifyApplicationDocument = useStore((s) => s.verifyApplicationDocument)
  const addApplicationDocument = useStore((s) => s.addApplicationDocument)
  const canEdit = useCanEdit()
  const [offerOpen, setOfferOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!application || !borrower || !product) return <p className="text-sm text-slate-500">Application not found.</p>

  const money = (n: number) => formatMoney(n, lender.currency)
  const nameOf = (sid: string | null) => staff.find((s) => s.id === sid)?.name ?? '—'
  const currentStaff = staff.find((s) => s.id === currentStaffId)
  const canDisburse = currentStaff ? NAV_ACCESS[currentStaff.role].includes('/disbursement') : false
  const editable = ['draft', 'submitted', 'under_assessment'].includes(application.status)
  const guarantors = borrower.guarantors.filter((g) => application.guarantorIds.includes(g.id))
  const collateral = allCollateral.filter((c) => application.collateralIds.includes(c.id))
  const decided = ['approved', 'disbursed'].includes(application.status)
  const instalment = firstInstalment(product, application.amount, application.termInstalments)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={application.reference}
        subtitle={`${borrower.fullName} · ${product.name} · applied ${formatDate(application.applicationDate || application.createdAt)}`}
        action={
          <div className="flex flex-wrap gap-2">
            {canEdit && editable && (
              <Button variant="secondary" icon={<Pencil size={15} />} onClick={() => navigate(`/applications/${application.id}/edit`)}>
                Edit
              </Button>
            )}
            {canEdit && application.status === 'draft' && (
              <Button icon={<Send size={15} />} disabled={busy} onClick={() => run(() => submitApplication(application.id))}>
                Submit application
              </Button>
            )}
            {canEdit && application.status === 'submitted' && (
              <Button icon={<ClipboardList size={15} />} disabled={busy} onClick={() => run(() => startAssessment(application.id))}>
                Start assessment
              </Button>
            )}
            {application.status === 'approved' && (
              <Button variant="secondary" icon={<FileText size={15} />} onClick={() => setOfferOpen(true)}>
                Offer letter
              </Button>
            )}
            {application.status === 'approved' && canDisburse && <Button onClick={() => navigate('/disbursement')}>Go to disbursement</Button>}
          </div>
        }
      />

      <Card className="mb-5 p-4">
        <StagePipeline status={application.status} wasDraft={application.status === 'draft' || application.events.some((e) => e.stage === 'draft')} />
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="1. Applicant" />
            <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Row k={group ? 'Applying member' : 'Borrower'} v={<Link to={`/borrowers/${borrower.id}`} className="text-brand-700 hover:underline">{borrower.fullName}</Link>} />
              <Row k={group ? 'Customer / group ID' : 'Customer ID'} v={[borrower.customerNumber, group?.groupNumber].filter(Boolean).join(' · ')} />
              {group && <Row k="Group" v={<Link to={`/groups/${group.id}`} className="text-brand-700 hover:underline">{group.name}</Link>} />}
              <Row k="Phone" v={borrower.phone} />
              <Row k="Address" v={[borrower.street, borrower.ward, borrower.district, borrower.region].filter(Boolean).join(', ')} />
              <Row k="Loan officer" v={nameOf(application.loanOfficerId)} />
              <Row k="Branch / office" v={branches.find((b) => b.id === application.branchId)?.name} />
              <Row k="Application date" v={formatDate(application.applicationDate || application.createdAt)} />
            </dl>
            {group && application.groupMemberIds.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Members included ({application.groupMemberIds.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.memberships.filter((m) => application.groupMemberIds.includes(m.borrowerId)).map((m) => (
                    <Badge key={m.id} tone={m.borrowerId === borrower.id ? 'violet' : 'slate'}>{m.borrowerName}</Badge>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="2. Loan details" />
            <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Row k="Loan product" v={product.name} />
              <Row k="Requested amount" v={money(application.requestedAmount || application.amount)} />
              {decided && application.amount !== application.requestedAmount && <Row k="Approved amount" v={<b className="text-brand-700">{money(application.amount)}</b>} />}
              <Row k="Purpose" v={application.purpose} />
              <Row k="Repayment period" v={`${application.requestedTerm || application.termInstalments} instalments${decided && application.termInstalments !== application.requestedTerm ? ` (approved ${application.termInstalments})` : ''}`} />
              <Row k="Repayment frequency" v={FREQ[product.repaymentFrequency]} />
              <Row k="Instalment" v={money(instalment)} />
              <Row k="Disbursement method" v={application.disbursementMethod ? DISBURSEMENT_LABEL[application.disbursementMethod] : '—'} />
              <Row k="First repayment date" v={application.firstRepaymentDate ? formatDate(application.firstRepaymentDate) : 'One period after disbursement'} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="3. Financial assessment" />
            <dl className="mb-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Row k="Monthly income" v={money(application.declaredIncome)} />
              <Row k="Other income" v={money(application.otherIncome)} />
              <Row k="Monthly expenses" v={money(application.declaredExpenses)} />
              <Row k="Dependents" v={String(application.dependents)} />
              <Row k="Existing loans elsewhere" v={String(application.existingLoansCount)} />
              <Row k="Existing monthly repayments" v={money(application.existingRepayments)} />
              <Row k="Business income" v={money(application.businessIncome)} />
              <Row k="Business expenses" v={money(application.businessExpenses)} />
            </dl>
            <CapacityPanel figures={application} instalment={instalment} frequency={product.repaymentFrequency} currency={lender.currency} />
          </Card>

          <RiskCard application={application} money={money} />

          <Card>
            <CardHeader title="4. Previous borrowing" subtitle="From the system's records" />
            <BorrowingSummary borrowerId={borrower.id} excludeApplicationId={application.id} />
          </Card>

          <Card>
            <CardHeader
              title="5. Guarantors"
              action={product.securityRequired.includes('guarantors') ? <Badge tone={guarantors.length ? 'green' : 'red'}>Required by product</Badge> : undefined}
            />
            {guarantors.length === 0 && <p className="text-sm text-slate-400">No guarantor attached.</p>}
            <div className="space-y-2">
              {guarantors.map((g) => (
                <div key={g.id} className="grid gap-x-6 gap-y-0.5 rounded-xl border border-slate-200 p-3 text-sm sm:grid-cols-3">
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
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="6. Collateral / security"
              action={product.securityRequired.includes('collateral') ? <Badge tone={collateral.length ? 'green' : 'red'}>Required by product</Badge> : undefined}
            />
            {collateral.length === 0 && <p className="text-sm text-slate-400">No collateral attached.</p>}
            <div className="space-y-2">
              {collateral.map((c) => (
                <div key={c.id} className="grid gap-x-6 gap-y-0.5 rounded-xl border border-slate-200 p-3 text-sm sm:grid-cols-3">
                  <p className="font-semibold text-slate-800 sm:col-span-3">
                    {c.assetType}: {c.description} <Badge className="capitalize">{c.status}</Badge>
                  </p>
                  <Small k="Estimated value" v={money(c.estimatedValue)} />
                  <Small k="Ownership" v={[c.ownerName, c.ownershipDocument].filter(Boolean).join(' · ')} />
                  <Small k="Valuation" v={[c.valuationDate && formatDate(c.valuationDate), c.valuedBy].filter(Boolean).join(' · ')} />
                  <Small k="Existing claims" v={c.existingClaims || 'None declared'} />
                  <Small k="Supporting documents" v={c.documents?.join(', ')} />
                </div>
              ))}
            </div>
            {collateral.length > 0 && (
              <p className="mt-3 text-sm text-slate-600">
                Cover: <b>{money(collateral.reduce((s, c) => s + c.estimatedValue, 0))}</b> for {money(application.amount)} (
                {Math.round((collateral.reduce((s, c) => s + c.estimatedValue, 0) / application.amount) * 100)}%)
              </p>
            )}
          </Card>

          {group && (
            <Card>
              <CardHeader title="7. Group information" />
              <GroupSnapshot group={group} memberIds={application.groupMemberIds} />
            </Card>
          )}

          <Card>
            <CardHeader title={`${group ? 8 : 7}. Documents`} subtitle="Every document is verified by staff" />
            <div className="space-y-2">
              {requiredDocuments({
                product, businessIncome: application.businessIncome, hasGroup: !!group,
                hasGuarantors: guarantors.length > 0, hasCollateral: collateral.length > 0,
              }).map((r) => {
                const docs = application.documents.filter((d) => d.type === r.type)
                return (
                  <div key={r.type} className="rounded-xl border border-slate-200 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {r.type} {r.required && !docs.length && <Badge tone="red">Missing</Badge>}
                        {!r.required && !docs.length && <span className="text-xs text-slate-400">optional</span>}
                      </p>
                      {canEdit && !['declined', 'disbursed'].includes(application.status) && (
                        <label className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          Upload
                          <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addApplicationDocument(application.id, r.type, f.name); e.target.value = '' }} />
                        </label>
                      )}
                    </div>
                    {docs.map((d) => (
                      <div key={d.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <FileText size={14} className="text-brand-600" />
                        <span className="flex-1 text-slate-700">{d.name}</span>
                        <Badge tone={d.status === 'verified' ? 'green' : d.status === 'rejected' ? 'red' : 'amber'} className="capitalize">{d.status}</Badge>
                        {d.verifiedBy && <span className="text-xs text-slate-400">{d.verifiedBy} · {d.verifiedAt ? formatDate(d.verifiedAt) : ''}</span>}
                        {canEdit && d.status !== 'verified' && (
                          <button className="text-xs font-medium text-emerald-700 hover:underline" onClick={() => verifyApplicationDocument(application.id, d.id, 'verified')}>Verify</button>
                        )}
                        {canEdit && d.status !== 'rejected' && (
                          <button className="text-xs font-medium text-red-700 hover:underline" onClick={() => verifyApplicationDocument(application.id, d.id, 'rejected')}>Reject</button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </Card>

          <AssessmentCard application={application} canEdit={canEdit} money={money} nameOf={nameOf} />
          <ApprovalCard application={application} money={money} />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Status" />
            <div className="flex flex-wrap gap-2">
              <Badge tone={application.status === 'declined' ? 'red' : application.status === 'approved' || application.status === 'disbursed' ? 'green' : 'blue'}>
                {APP_STATUS_LABEL[application.status]}
              </Badge>
              {application.assessmentResult && <Badge tone={ASSESSMENT_TONE[application.assessmentResult]}>{ASSESSMENT_LABEL[application.assessmentResult]}</Badge>}
            </div>
            {application.declineReason && <p className="mt-2 text-sm text-red-700">{application.declineReason}</p>}
            <dl className="mt-4 space-y-1 text-sm">
              <Row k="Captured by" v={nameOf(application.createdBy)} />
              <Row k="Assessed by" v={application.assessedById ? nameOf(application.assessedById) : '—'} />
              <Row k="Approver needed" v={STAFF_ROLE_LABELS[application.requiredApproverRole]} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Workflow history" />
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {application.events.length === 0 && <li className="text-sm text-slate-400">No history yet.</li>}
              {application.events.map((e) => (
                <li key={e.id}>
                  <span className={clsx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full', e.stage === 'declined' ? 'bg-red-500' : 'bg-brand-500')} />
                  <p className="text-sm font-medium text-slate-800">{e.label}</p>
                  {e.note && <p className="text-xs text-slate-500">{e.note}</p>}
                  <p className="text-xs text-slate-400">{formatDateTime(e.at)}{e.by ? ` · ${e.by}` : ''}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal open={offerOpen} onClose={() => setOfferOpen(false)} title="Offer letter" wide>
        <div className="space-y-3 text-sm text-slate-700">
          <p className="font-semibold">{lender.name}</p>
          <p className="text-xs text-slate-400">{lender.address} · Licence {lender.licenceNumber}</p>
          <hr className="border-slate-200" />
          <p>Dear {borrower.fullName},</p>
          <p>
            We are pleased to confirm your loan of <strong>{money(application.amount)}</strong> under the {product.name} product, repayable over{' '}
            {application.termInstalments} {product.repaymentFrequency} instalments of about {money(instalment)} at {product.interestRate}%{' '}
            {product.interestMethod} interest per {product.interestPeriod}
            {application.firstRepaymentDate ? `, starting ${formatDate(application.firstRepaymentDate)}` : ''}.
          </p>
          <p>Please visit any branch to sign this agreement before disbursement.</p>
          <p className="text-xs text-slate-400">
            Generated {formatDate(new Date().toISOString())} · Approved by {application.approvals.filter((a) => a.decision === 'approved').at(-1)?.approverName}
          </p>
        </div>
      </Modal>
    </div>
  )
}

function RiskCard({ application, money }: { application: Application; money: (n: number) => string }) {
  const r = application.risk
  return (
    <Card>
      <CardHeader
        title="Automatic checks & risk indicators"
        subtitle="Calculated by the system; the decision stays with authorised staff"
        action={application.needsReview ? <Badge tone="amber">Needs additional review</Badge> : <Badge tone="green">No concerns flagged</Badge>}
      />
      <ul className="grid gap-2 sm:grid-cols-2">
        <CheckRow label="Affordability check" pass={application.affordabilityPass} />
        <CheckRow label="Duplicate borrower check" pass={application.duplicateCheckPass} />
        <CheckRow label="Blacklist check" pass={application.blacklistCheckPass} />
        <CheckRow label="Credit bureau consent recorded" pass={application.creditBureauConsent} />
      </ul>
      {r && r.debtToIncome !== undefined && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ['Score', application.score == null ? '—' : `${application.score}/100`],
            ['Debt-to-income', `${Math.round((r.debtToIncome ?? 0) * 100)}%`, (r.debtToIncome ?? 0) > 0.5],
            ['Loan-to-income', r.loanToIncome == null ? '—' : `${r.loanToIncome}× monthly`, (r.loanToIncome ?? 0) > 6],
            ['Disposable after loan', money(r.disposableAfter ?? 0), (r.disposableAfter ?? 0) < 0],
          ].map(([k, v, bad]) => (
            <div key={k as string} className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-[11px] text-slate-400">{k}</dt>
              <dd className={`font-semibold tabular-nums ${bad ? 'text-accent-600' : 'text-slate-800'}`}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {(r?.flags ?? []).length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {r!.flags!.map((f) => (
            <li key={f} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span aria-hidden>⚠</span>
              {f}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function AssessmentCard({
  application,
  canEdit,
  money,
  nameOf,
}: {
  application: Application
  canEdit: boolean
  money: (n: number) => string
  nameOf: (id: string | null) => string
}) {
  const saveAssessment = useStore((s) => s.saveAssessment)
  const open = application.status === 'submitted' || application.status === 'under_assessment'
  const [result, setResult] = useState<AssessmentResult>(application.assessmentResult || 'recommended')
  const [amount, setAmount] = useState(application.assessedAmount ?? application.requestedAmount ?? application.amount)
  const [term, setTerm] = useState(application.recommendedTerm ?? application.requestedTerm ?? application.termInstalments)
  const [notes, setNotes] = useState(application.assessmentNotes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(forward: boolean) {
    setBusy(true)
    setError(null)
    try {
      await saveAssessment(application.id, { result, assessedAmount: amount, recommendedTerm: term, notes, forward })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the assessment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Loan officer's assessment" subtitle="The officer's recommendation to the approver" />
      {open && canEdit ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['recommended', 'further_review', 'not_recommended'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setResult(r)}
                className={clsx(
                  'rounded-xl border px-3 py-2.5 text-sm font-medium',
                  result === r
                    ? r === 'recommended' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : r === 'further_review' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-red-500 bg-red-50 text-red-800'
                    : 'border-slate-200 text-slate-600',
                )}
              >
                {ASSESSMENT_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assessed amount" hint={`Requested ${money(application.requestedAmount || application.amount)}`}>
              <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </Field>
            <Field label="Recommended repayment period (instalments)">
              <input type="number" className={inputClass} value={term} onChange={(e) => setTerm(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Assessment notes" hint="Site visit, character, cash flow, concerns">
            <textarea rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => save(false)}>Save assessment</Button>
            <Button disabled={busy || result === 'further_review'} onClick={() => save(true)} icon={<Send size={14} />}>
              Save & forward for approval
            </Button>
          </div>
          {result === 'further_review' && <p className="text-xs text-amber-700">An application that requires further review stays with the loan officer until it is resolved.</p>}
        </div>
      ) : application.assessmentResult ? (
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Row k="Result" v={<Badge tone={ASSESSMENT_TONE[application.assessmentResult]}>{ASSESSMENT_LABEL[application.assessmentResult]}</Badge>} />
          <Row k="Assessed amount" v={application.assessedAmount == null ? '—' : money(application.assessedAmount)} />
          <Row k="Recommended period" v={application.recommendedTerm ? `${application.recommendedTerm} instalments` : '—'} />
          <Row k="Officer" v={nameOf(application.assessedById)} />
          <Row k="Assessment date" v={application.assessedAt ? formatDate(application.assessedAt) : '—'} />
          {application.assessmentNotes && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-slate-700 sm:col-span-2">{application.assessmentNotes}</p>}
        </dl>
      ) : (
        <p className="text-sm text-slate-400">
          {application.status === 'draft' ? 'Submit the application to start the assessment.' : 'Not assessed yet.'}
        </p>
      )}
    </Card>
  )
}

function ApprovalCard({ application, money }: { application: Application; money: (n: number) => string }) {
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const decideApplication = useStore((s) => s.decideApplication)
  const [mode, setMode] = useState<'approved' | 'declined' | 'returned' | null>(null)
  const [comment, setComment] = useState('')
  const [amount, setAmount] = useState(application.assessedAmount ?? application.amount)
  const [term, setTerm] = useState(application.recommendedTerm ?? application.termInstalments)
  const [error, setError] = useState<string | null>(null)

  const currentStaff = staff.find((s) => s.id === currentStaffId)
  const isCreator = application.createdBy === currentStaffId
  const isAssessor = application.assessedById === currentStaffId
  const roleMatches = currentStaff?.role === application.requiredApproverRole || currentStaff?.role === 'lender_admin'
  const pending = application.status === 'pending_approval'
  const canDecide = pending && roleMatches && !isCreator && !isAssessor

  return (
    <Card>
      <CardHeader title="Approval" subtitle={`Requires: ${STAFF_ROLE_LABELS[application.requiredApproverRole]}`} />
      {application.approvals.length === 0 && <p className="text-sm text-slate-400">No decisions recorded yet.</p>}
      <ul className="space-y-3">
        {application.approvals.map((a) => (
          <li key={a.id} className="rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800">{a.approverName}</span>
              <Badge tone={a.decision === 'approved' ? 'green' : a.decision === 'declined' ? 'red' : 'amber'}>
                {a.decision === 'returned' ? 'returned for review' : a.decision}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">{STAFF_ROLE_LABELS[a.role]} · {formatDate(a.date)}</p>
            {a.comment && <p className="mt-1 text-slate-600">{a.comment}</p>}
          </li>
        ))}
      </ul>
      {pending && (
        <>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button disabled={!canDecide} onClick={() => setMode('approved')}>Approve</Button>
            <Button variant="secondary" disabled={!canDecide} icon={<Undo2 size={14} />} onClick={() => setMode('returned')}>Return for review</Button>
            <Button variant="danger" disabled={!canDecide} onClick={() => setMode('declined')}>Decline</Button>
          </div>
          {(isCreator || isAssessor) && (
            <p className="mt-2 text-xs text-amber-700">You {isCreator ? 'captured' : 'assessed'} this application, so a different approver must decide it.</p>
          )}
          {!isCreator && !isAssessor && !roleMatches && (
            <p className="mt-2 text-xs text-slate-400">Only a {STAFF_ROLE_LABELS[application.requiredApproverRole]} can decide this amount.</p>
          )}
        </>
      )}
      {!pending && !['approved', 'declined', 'disbursed'].includes(application.status) && (
        <p className="mt-3 text-xs text-slate-400">The approver can decide once the loan officer forwards the assessment.</p>
      )}

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'approved' ? 'Approve application' : mode === 'declined' ? 'Decline application' : 'Return for further review'}
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!mode) return
            setError(null)
            try {
              await decideApplication(application.id, mode, comment, mode === 'approved' ? { approvedAmount: amount, approvedTerm: term } : undefined)
              setMode(null)
              setComment('')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not record the decision')
            }
          }}
        >
          {mode === 'approved' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Approved amount" hint={`Requested ${money(application.requestedAmount)} · assessed ${application.assessedAmount == null ? '—' : money(application.assessedAmount)}`}>
                <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </Field>
              <Field label="Approved period (instalments)">
                <input type="number" className={inputClass} value={term} onChange={(e) => setTerm(Number(e.target.value))} />
              </Field>
            </div>
          )}
          <Field label={mode === 'approved' ? 'Comment' : 'Reason'} hint="Recorded permanently against this application">
            <textarea required={mode !== 'approved'} rows={3} className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <Button type="submit" variant={mode === 'declined' ? 'danger' : 'primary'} className="w-full">
            Confirm {mode === 'returned' ? 'return' : mode === 'approved' ? 'approval' : 'decline'}
          </Button>
        </form>
      </Modal>
    </Card>
  )
}

function Row({ k, v }: { k: string; v?: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
      <dt className="shrink-0 text-slate-500">{k}</dt>
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
