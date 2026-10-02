import { useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Landmark, Pencil, Upload } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatDateTime, formatMoney, initials } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import { isSupervisor } from '../../lib/permissions'
import { BorrowerSavings } from './BorrowerSavings'
import { StatusBadge } from './StatusBadge'
import { AlsoGuarantees, CollateralTab, GuaranteesGiven, LoanHistory, TransactionLedger, loanStatusLabel } from './BorrowerExtras'
import type { ApplicationStatus, BorrowerStatus, DisbursementChannel, Loan, Repayment } from '../../types'

const tabs = [
  { id: 'profile', label: 'Profile' },
  { id: 'applications', label: 'Applications' },
  { id: 'loans', label: 'Loans & Disbursements' },
  { id: 'savings', label: 'Savings' },
  { id: 'guarantors', label: 'Guarantors' },
  { id: 'collateral', label: 'Collateral' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'documents', label: 'Documents' },
  { id: 'history', label: 'History' },
]

const statusTone: Record<ApplicationStatus, BadgeTone> = {
  draft: 'slate',
  submitted: 'blue',
  pending_approval: 'amber',
  approved: 'green',
  declined: 'red',
  disbursed: 'violet',
}

const channelLabels: Record<DisbursementChannel, string> = {
  mobile_money: 'Mobile money',
  bank_transfer: 'Bank transfer',
  supplier: 'Direct to supplier',
  cash: 'Cash',
}

export default function BorrowerDetail() {
  const { id } = useParams()
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === id))
  const branches = useStore((s) => s.branches)
  const staff = useStore((s) => s.staff)
  const allLoans = useStore((s) => s.loans)
  const loans = useMemo(() => allLoans.filter((l) => l.borrowerId === id), [allLoans, id])
  const allApplications = useStore((s) => s.applications)
  const applications = useMemo(
    () => [...allApplications].filter((a) => a.borrowerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allApplications, id],
  )
  const products = useStore((s) => s.products)
  const setBorrowerStatus = useStore((s) => s.setBorrowerStatus)
  const verifyBorrower = useStore((s) => s.verifyBorrower)
  const allRepayments = useStore((s) => s.repayments)
  const navigate = useNavigate()
  const uploadBorrowerDocument = useStore((s) => s.uploadBorrowerDocument)
  const settleLoan = useStore((s) => s.settleLoan)
  const writeOffLoan = useStore((s) => s.writeOffLoan)
  const role = useStore((s) => s.currentUser?.role)
  const canEdit = useCanEdit()
  const canWriteOff = !!role && isSupervisor(role)
  const [tab, setTab] = useState('profile')
  const [statusTo, setStatusTo] = useState<BorrowerStatus | null>(null)
  const [reason, setReason] = useState('')
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [checks, setChecks] = useState({ nida: false, phone: false, docs: false })
  const [settleFor, setSettleFor] = useState<Loan | null>(null)
  const [settleChannel, setSettleChannel] = useState<Repayment['channel']>('mobile_money')
  const [writeOffFor, setWriteOffFor] = useState<Loan | null>(null)
  const [woReason, setWoReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [docOpen, setDocOpen] = useState(false)
  const [docName, setDocName] = useState('')
  const [docType, setDocType] = useState('National ID')

  if (!borrower) return <p className="text-sm text-slate-500">Borrower not found.</p>

  const branch = branches.find((b) => b.id === borrower.branchId)
  const officer = staff.find((s) => s.id === borrower.officerId)
  const totalExposure = loans.filter((l) => l.status === 'active').reduce((s, l) => s + l.outstandingBalance, 0)
  const loanIds = new Set(loans.map((l) => l.id))
  const paidTotal = allRepayments.filter((r) => loanIds.has(r.loanId) && !r.reversed).reduce((s, r) => s + r.amount, 0)
  const instalments = loans.flatMap((l) => l.schedule)
  const overdueCount = instalments.filter((i) => i.status === 'overdue').length
  const dueSoFar = instalments.filter((i) => new Date(i.dueDate) <= new Date())
  const onTimeRate = dueSoFar.length ? Math.round((dueSoFar.filter((i) => i.status === 'paid').length / dueSoFar.length) * 100) : null

  return (
    <div>
      <PageHeader
        title={borrower.fullName}
        subtitle={`${branch?.name ?? ''} · Registered ${formatDate(borrower.createdAt)} · Officer: ${officer?.name ?? '—'}`}
        action={
          canEdit && (
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Pencil size={15} />} onClick={() => navigate(`/borrowers/${borrower.id}/edit`)}>
                Edit profile
              </Button>
              {borrower.verified ? (
                <Button variant="secondary" onClick={() => void verifyBorrower(borrower.id, false, false)}>Remove verification</Button>
              ) : (
                <Button
                  onClick={() => {
                    setChecks({ nida: false, phone: false, docs: false })
                    setVerifyOpen(true)
                  }}
                >
                  Verify profile
                </Button>
              )}
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                value={borrower.status}
                onChange={(e) => {
                  const next = e.target.value as BorrowerStatus
                  if (next === borrower.status) return
                  setReason('')
                  setStatusTo(next)
                }}
                aria-label="Borrower status"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
                <option value="blacklisted">Blacklisted</option>
              </select>
            </div>
          )
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {initials(borrower.fullName)}
        </span>
        <span className="font-mono text-sm text-slate-500">{borrower.customerNumber}</span>
        <StatusBadge status={borrower.status} />
        {borrower.verified ? (
          <Badge tone="green">
            ✓ Verified by {borrower.verifiedBy}{borrower.verifiedAt ? ` · ${formatDate(borrower.verifiedAt)}` : ''}
          </Badge>
        ) : (
          <Badge tone="amber">Unverified</Badge>
        )}
        {borrower.phoneVerified && <Badge tone="slate">Phone verified</Badge>}
        <Badge tone="slate">Total exposure: {formatMoney(totalExposure)}</Badge>
        <Badge tone="slate" className="capitalize">
          {borrower.type}
        </Badge>
      </div>

      {borrower.blacklisted && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Blacklist reason:</strong> {borrower.blacklistReason}
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-6">
        {tab === 'profile' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <Stat label="Loans" value={String(loans.length)} />
              <Stat label="Payments" value={formatMoney(paidTotal)} />
              <Stat label="Outstanding" value={formatMoney(totalExposure)} />
              <Stat label="Overdue instalments" value={String(overdueCount)} warn={overdueCount > 0} />
              <Stat label="Guarantors" value={String(borrower.guarantors.length)} />
              <Stat label="Documents" value={String(borrower.documents.length)} />
              <Stat label="On-time repayment" value={onTimeRate === null ? '—' : `${onTimeRate}%`} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <ProfileCard title="Personal information" items={[
                ['Customer number', borrower.customerNumber],
                ['Date of birth', borrower.dateOfBirth ? formatDate(borrower.dateOfBirth) : ''],
                ['Gender', cap(borrower.gender)],
                ['Marital status', cap(borrower.maritalStatus)],
                ['NIDA / National ID', borrower.nationalId],
                ['Phone', borrower.phone],
                ['Alternative phone', borrower.altPhone],
                ['Email', borrower.email],
              ]} />
              <ProfileCard title="Address" items={[
                ['Region', borrower.region],
                ['District', borrower.district],
                ['Ward', borrower.ward],
                ['Street / village', borrower.street],
                ['Physical address', borrower.residence],
                ['Postal address', borrower.postalAddress],
              ]} />
              <ProfileCard title="Employment / business" items={
                borrower.incomeSource === 'employed'
                  ? [
                      ['Income source', 'Employed'],
                      ['Employer', borrower.employerName],
                      ['Job title', borrower.jobTitle],
                      ['Employment type', cap(borrower.employmentType.replace('_', ' '))],
                      ['Years employed', borrower.yearsEmployed?.toString() ?? ''],
                    ]
                  : [
                      ['Income source', borrower.incomeSource === 'business' ? 'Business owner' : cap(borrower.incomeSource) || borrower.occupation],
                      ['Business name', borrower.businessName ?? ''],
                      ['Business type', borrower.sector ?? ''],
                      ['Business location', borrower.businessLocation],
                      ['Years in business', borrower.yearsTrading?.toString() ?? ''],
                      ['Registration / TIN', [borrower.registrationNumber, borrower.taxId].filter(Boolean).join(' · ')],
                    ]
              } />
              <ProfileCard title="Financial information" items={[
                ['Monthly income', formatMoney(borrower.monthlyIncome)],
                ['Monthly expenses', formatMoney(borrower.monthlyExpenses)],
                ['Dependents', borrower.dependents?.toString() ?? ''],
                ['Existing loan payments', formatMoney(borrower.existingLoanPayments)],
                ['Disposable income', formatMoney(borrower.monthlyIncome - borrower.monthlyExpenses - borrower.existingLoanPayments)],
                ['Other income', borrower.otherIncomeSources],
                ['Existing loans', borrower.existingLoans],
                ['Bank', [borrower.bankName, borrower.bankAccount].filter(Boolean).join(' · ')],
                ['Mobile money', [borrower.mobileMoneyProvider, borrower.mobileMoneyNumber].filter(Boolean).join(' · ')],
              ]} />
              <GuaranteesGiven borrower={borrower} />
              <ProfileCard title="Emergency contact" items={[
                ['Name', borrower.emergencyName || borrower.nextOfKin],
                ['Relationship', borrower.emergencyRelationship],
                ['Phone', borrower.emergencyPhone],
                ['Address', borrower.emergencyAddress],
              ]} />
            </div>
            <LoanHistory loans={loans} />
          </div>
        )}

        {tab === 'applications' && (
          <Card padded={false}>
            {applications.length === 0 ? (
              <p className="p-5 text-sm text-slate-400">No applications yet for this borrower.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {applications.map((app) => {
                  const product = products.find((p) => p.id === app.productId)
                  return (
                    <li key={app.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <div>
                        <Link to={`/applications/${app.id}`} className="font-medium text-slate-800 hover:text-brand-600 hover:underline">
                          {app.reference}
                        </Link>
                        <p className="text-xs text-slate-400">
                          {product?.name} · Submitted {formatDate(app.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-600">{formatMoney(app.amount)}</span>
                        <Badge tone={statusTone[app.status]}>{app.status.replace('_', ' ')}</Badge>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        )}

        {tab === 'loans' && (
          <div className="space-y-3">
            {loans.length === 0 && <p className="text-sm text-slate-400">No loans disbursed yet for this borrower.</p>}
            {loans.map((loan) => {
              const product = products.find((p) => p.id === loan.productId)
              const paidCount = loan.schedule.filter((i) => i.status === 'paid').length
              const nextDue = loan.schedule.find((i) => i.status !== 'paid')
              return (
                <Card key={loan.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-800">{product?.name}</p>
                      <p className="text-xs text-slate-400">
                        Principal {formatMoney(loan.principal)} · {paidCount}/{loan.schedule.length} instalments paid
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {loan.daysInArrears > 0 && (
                        <Badge tone={loan.daysInArrears > 30 ? 'red' : 'amber'} dot>
                          {loan.daysInArrears}d overdue · {formatMoney(loan.arrearsAmount)}
                        </Badge>
                      )}
                      <Badge tone={loan.status === 'active' ? 'green' : loan.status === 'closed' ? 'slate' : loan.status === 'written_off' ? 'red' : 'amber'}>
                        {loanStatusLabel[loan.status]}
                      </Badge>
                      <span className="text-sm font-medium text-slate-700">{formatMoney(loan.outstandingBalance)} outstanding</span>
                    </div>
                  </div>

                  {loan.disbursement ? (
                    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5 font-medium text-slate-600">
                        <Landmark size={13} /> {formatMoney(loan.netDisbursed)} disbursed
                      </span>
                      <span>{channelLabels[loan.disbursement.channel]}</span>
                      <span>Ref: {loan.disbursement.reference}</span>
                      <span>{formatDateTime(loan.disbursement.date)}</span>
                      <span>
                        Approved by {loan.disbursement.approvedBy} · Disbursed by {loan.disbursement.disbursedBy}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-amber-700">Approved — awaiting disbursement.</p>
                  )}

                  {loan.status === 'active' && nextDue && (
                    <p className="mt-2 text-xs text-slate-400">
                      Next due: {formatMoney(nextDue.totalDue)} on {formatDate(nextDue.dueDate)}
                    </p>
                  )}

                  {loan.status === 'closed' && loan.closureReason && (
                    <p className="mt-2 text-xs text-slate-400">{loan.closureReason}</p>
                  )}

                  {loan.status === 'active' && canEdit && (
                    <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSettleFor(loan)
                          setSettleChannel('mobile_money')
                        }}
                      >
                        Settle early — {formatMoney(loan.outstandingBalance)}
                      </Button>
                      {canWriteOff && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setWriteOffFor(loan)
                            setWoReason('')
                          }}
                        >
                          Write off
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}

        {tab === 'guarantors' && (
          <Card>
            <CardHeader title="Guarantors" subtitle="Own identification and recorded consent" />
            {borrower.guarantors.length === 0 && <p className="text-sm text-slate-400">No guarantors recorded.</p>}
            <ul className="divide-y divide-slate-100">
              {borrower.guarantors.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">
                      {g.name} {g.relationship && <span className="font-normal text-slate-400">· {g.relationship}</span>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {[g.nationalId, g.phone, g.address, g.occupation].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Income {formatMoney(g.monthlyIncome)} · Guarantees <b>{formatMoney(g.guaranteeAmount)}</b>
                    </p>
                    <AlsoGuarantees nationalId={g.nationalId} selfId={borrower.id} />
                  </div>
                  <div className="flex gap-2">
                    <Badge tone={g.status === 'approved' ? 'green' : g.status === 'rejected' ? 'red' : 'amber'} className="capitalize">
                      {g.status}
                    </Badge>
                    <Badge tone={g.consentGiven ? 'green' : 'slate'}>{g.consentGiven ? 'Consent given' : 'No consent yet'}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {tab === 'documents' && (
          <Card>
            <CardHeader
              title="Documents"
              action={
                canEdit && (
                  <Button size="sm" icon={<Upload size={14} />} onClick={() => setDocOpen(true)}>
                    Upload document
                  </Button>
                )
              }
            />
            {borrower.documents.length === 0 && <p className="text-sm text-slate-400">No documents uploaded.</p>}
            <ul className="divide-y divide-slate-100">
              {borrower.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-slate-800">{d.name}</span>
                  <span className="text-xs text-slate-400">{d.type} · uploaded {formatDate(d.uploadedAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {tab === 'savings' && <BorrowerSavings borrowerId={borrower.id} canEdit={canEdit} />}

        {tab === 'collateral' && <CollateralTab borrower={borrower} loans={loans} canEdit={canEdit} />}

        {tab === 'transactions' && <TransactionLedger loans={loans} />}

        {tab === 'history' && (
          <Card>
            <CardHeader title="Full history" subtitle="Every stage on this file" />
            <ol className="space-y-4 border-l border-slate-200 pl-4">
              {borrower.history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <p className="text-sm font-medium text-slate-800">{h.label}</p>
                  <p className="text-xs text-slate-400">{formatDate(h.date)}</p>
                  <p className="mt-0.5 text-sm text-slate-600">{h.detail}</p>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>

      <Modal open={verifyOpen} onClose={() => setVerifyOpen(false)} title="Verify borrower profile">
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Confirm each check before marking {borrower.fullName} as verified. Your name and the time are recorded.</p>
          {[
            ['nida', `NIDA number ${borrower.nationalId} matches the ID card`],
            ['phone', `Phone ${borrower.phone} answered / confirmed`],
            ['docs', `Supporting documents reviewed (${borrower.documents.length} on file)`],
          ].map(([k, label]) => (
            <label key={k} className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checks[k as keyof typeof checks]}
                onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <Button
            className="w-full"
            disabled={!checks.nida || !checks.docs}
            onClick={async () => {
              await verifyBorrower(borrower.id, true, checks.phone)
              setVerifyOpen(false)
            }}
          >
            Mark as verified
          </Button>
        </div>
      </Modal>

      <Modal open={statusTo !== null} onClose={() => setStatusTo(null)} title={`Set status to ${statusTo ?? ''}`}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!statusTo) return
            await setBorrowerStatus(borrower.id, statusTo, reason)
            setStatusTo(null)
          }}
        >
          <p className="text-sm text-slate-600">
            {statusTo === 'blacklisted' && 'A blacklisted borrower cannot apply for new loans. The reason is kept on file.'}
            {statusTo === 'suspended' && 'A suspended borrower cannot apply for new loans until reactivated.'}
            {statusTo === 'inactive' && 'Marks the borrower as dormant. They can still be reactivated at any time.'}
            {statusTo === 'active' && 'Restores the borrower to good standing.'}
          </p>
          <Field label={statusTo === 'blacklisted' ? 'Reason (required)' : 'Reason (optional)'} hint="Recorded on the borrower's history">
            <textarea rows={3} required={statusTo === 'blacklisted'} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button type="submit" variant={statusTo === 'blacklisted' || statusTo === 'suspended' ? 'danger' : 'primary'} className="w-full">
            Confirm
          </Button>
        </form>
      </Modal>

      <Modal open={settleFor !== null} onClose={() => setSettleFor(null)} title="Settle loan early">
        {settleFor && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await settleLoan(settleFor.id, settleChannel)
                setSettleFor(null)
              } finally {
                setBusy(false)
              }
            }}
          >
            <p className="text-sm text-slate-600">
              Record a single payment of <strong>{formatMoney(settleFor.outstandingBalance)}</strong> to clear the
              full balance and close this loan.
            </p>
            <Field label="Payment channel">
              <select className={inputClass} value={settleChannel} onChange={(e) => setSettleChannel(e.target.value as Repayment['channel'])}>
                <option value="mobile_money">Mobile money</option>
                <option value="bank">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="field">Field collection</option>
              </select>
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Processing…' : 'Confirm settlement'}
            </Button>
          </form>
        )}
      </Modal>

      <Modal open={writeOffFor !== null} onClose={() => setWriteOffFor(null)} title="Write off loan">
        {writeOffFor && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await writeOffLoan(writeOffFor.id, woReason)
                setWriteOffFor(null)
              } finally {
                setBusy(false)
              }
            }}
          >
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Writing off removes {formatMoney(writeOffFor.outstandingBalance)} from the performing book and blacklists
              this borrower. This cannot be undone.
            </div>
            <Field label="Reason" hint="Recorded permanently on the loan and the borrower's file">
              <textarea required rows={3} className={inputClass} value={woReason} onChange={(e) => setWoReason(e.target.value)} />
            </Field>
            <Button type="submit" variant="danger" className="w-full" disabled={busy}>
              {busy ? 'Processing…' : 'Confirm write-off'}
            </Button>
          </form>
        )}
      </Modal>


      <Modal open={docOpen} onClose={() => setDocOpen(false)} title="Upload document">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!docName.trim()) return
            setBusy(true)
            try {
              await uploadBorrowerDocument(borrower.id, docName, docType)
              setDocOpen(false)
              setDocName('')
              setDocType('National ID')
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label="Document name">
            <input required className={inputClass} value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="e.g. National ID copy, Payslip" />
          </Field>
          <Field label="Document type">
            <select className={inputClass} value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="National ID">National ID</option>
              <option value="Payslip">Payslip</option>
              <option value="Business licence">Business licence</option>
              <option value="Collateral photo">Collateral photo</option>
              <option value="Guarantor ID">Guarantor ID</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload document'}
          </Button>
        </form>
      </Modal>

      <p className="mt-8 text-xs text-slate-400">
        <Link to="/borrowers" className="hover:underline">
          ← Back to borrower list
        </Link>
      </p>
    </div>
  )
}

const cap = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : v)

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-bold tabular-nums ${warn ? 'text-accent-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

function ProfileCard({ title, items }: { title: string; items: [string, string | null | undefined][] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-400">{k}</dt>
            <dd className="font-medium text-slate-800">{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

