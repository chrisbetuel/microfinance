import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ShieldAlert, ShieldCheck, Landmark, Pencil, Upload } from 'lucide-react'
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
import type { ApplicationStatus, DisbursementChannel, Loan, Repayment } from '../../types'

const tabs = [
  { id: 'profile', label: 'Profile' },
  { id: 'applications', label: 'Applications' },
  { id: 'loans', label: 'Loans & Disbursements' },
  { id: 'savings', label: 'Savings' },
  { id: 'guarantors', label: 'Guarantors' },
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
  const setBorrowerBlacklist = useStore((s) => s.setBorrowerBlacklist)
  const updateBorrower = useStore((s) => s.updateBorrower)
  const uploadBorrowerDocument = useStore((s) => s.uploadBorrowerDocument)
  const settleLoan = useStore((s) => s.settleLoan)
  const writeOffLoan = useStore((s) => s.writeOffLoan)
  const role = useStore((s) => s.currentUser?.role)
  const canEdit = useCanEdit()
  const canWriteOff = !!role && isSupervisor(role)
  const [tab, setTab] = useState('profile')
  const [blOpen, setBlOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [settleFor, setSettleFor] = useState<Loan | null>(null)
  const [settleChannel, setSettleChannel] = useState<Repayment['channel']>('mobile_money')
  const [writeOffFor, setWriteOffFor] = useState<Loan | null>(null)
  const [woReason, setWoReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    fullName: '',
    phone: '',
    residence: '',
    occupation: '',
    monthlyIncome: 0,
    nextOfKin: '',
    businessName: '',
    registrationNumber: '',
    taxId: '',
    sector: '',
    yearsTrading: 0,
  })
  const [docOpen, setDocOpen] = useState(false)
  const [docName, setDocName] = useState('')
  const [docType, setDocType] = useState('National ID')

  if (!borrower) return <p className="text-sm text-slate-500">Borrower not found.</p>

  const branch = branches.find((b) => b.id === borrower.branchId)
  const officer = staff.find((s) => s.id === borrower.officerId)
  const totalExposure = loans.filter((l) => l.status === 'active').reduce((s, l) => s + l.outstandingBalance, 0)

  return (
    <div>
      <PageHeader
        title={borrower.fullName}
        subtitle={`${branch?.name ?? ''} · Registered ${formatDate(borrower.createdAt)} · Officer: ${officer?.name ?? '—'}`}
        action={
          canEdit && (
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Pencil size={15} />} onClick={() => {
                setEditForm({
                  fullName: borrower.fullName,
                  phone: borrower.phone,
                  residence: borrower.residence,
                  occupation: borrower.occupation,
                  monthlyIncome: borrower.monthlyIncome,
                  nextOfKin: borrower.nextOfKin,
                  businessName: borrower.businessName ?? '',
                  registrationNumber: borrower.registrationNumber ?? '',
                  taxId: borrower.taxId ?? '',
                  sector: borrower.sector ?? '',
                  yearsTrading: borrower.yearsTrading ?? 0,
                })
                setEditOpen(true)
              }}>
                Edit
              </Button>
              {borrower.blacklisted ? (
                <Button variant="secondary" icon={<ShieldCheck size={15} />} onClick={() => void setBorrowerBlacklist(borrower.id, false, null)}>
                  Remove from blacklist
                </Button>
              ) : (
                <Button variant="danger" icon={<ShieldAlert size={15} />} onClick={() => setBlOpen(true)}>
                  Blacklist borrower
                </Button>
              )}
            </div>
          )
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {initials(borrower.fullName)}
        </span>
        <Badge tone={borrower.blacklisted ? 'red' : 'green'}>{borrower.blacklisted ? 'Blacklisted' : 'Good standing'}</Badge>
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
          <Card className="max-w-2xl">
            <CardHeader title="Personal & contact details" />
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Detail label="National ID" value={borrower.nationalId} />
              <Detail label="Phone" value={borrower.phone} />
              <Detail label="Residence" value={borrower.residence} />
              <Detail label="Occupation" value={borrower.occupation} />
              <Detail label="Monthly income" value={formatMoney(borrower.monthlyIncome)} />
              <Detail label="Next of kin" value={borrower.nextOfKin} />
              {borrower.businessName && <Detail label="Business name" value={borrower.businessName} />}
              {borrower.registrationNumber && <Detail label="Registration number" value={borrower.registrationNumber} />}
              {borrower.taxId && <Detail label="Tax ID" value={borrower.taxId} />}
              {borrower.sector && <Detail label="Sector" value={borrower.sector} />}
            </dl>
          </Card>
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
                        {loan.status.replace('_', ' ')}
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
                <li key={g.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">{g.name}</p>
                    <p className="text-xs text-slate-400">{g.nationalId} · {g.phone}</p>
                  </div>
                  <Badge tone={g.consentGiven ? 'green' : 'amber'}>{g.consentGiven ? `Consent given ${g.consentDate ? formatDate(g.consentDate) : ''}` : 'Consent pending'}</Badge>
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

      <Modal open={blOpen} onClose={() => setBlOpen(false)} title="Blacklist borrower">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            await setBorrowerBlacklist(borrower.id, true, reason)
            setBlOpen(false)
            setReason('')
          }}
        >
          <Field label="Reason" hint="Recorded permanently on the borrower's file">
            <textarea required rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button type="submit" variant="danger" className="w-full">
            Confirm blacklist
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

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit borrower profile" wide>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await updateBorrower(borrower.id, {
                fullName: editForm.fullName,
                phone: editForm.phone,
                residence: editForm.residence,
                occupation: editForm.occupation,
                monthlyIncome: editForm.monthlyIncome,
                nextOfKin: editForm.nextOfKin,
                businessName: editForm.businessName || undefined,
                registrationNumber: editForm.registrationNumber || undefined,
                taxId: editForm.taxId || undefined,
                sector: editForm.sector || undefined,
                yearsTrading: editForm.yearsTrading || undefined,
              })
              setEditOpen(false)
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input required className={inputClass} value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input required className={inputClass} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </Field>
            <Field label="Residence">
              <input className={inputClass} value={editForm.residence} onChange={(e) => setEditForm({ ...editForm, residence: e.target.value })} />
            </Field>
            <Field label="Occupation">
              <input className={inputClass} value={editForm.occupation} onChange={(e) => setEditForm({ ...editForm, occupation: e.target.value })} />
            </Field>
            <Field label="Monthly income">
              <input type="number" className={inputClass} value={editForm.monthlyIncome} onChange={(e) => setEditForm({ ...editForm, monthlyIncome: Number(e.target.value) })} />
            </Field>
            <Field label="Next of kin">
              <input className={inputClass} value={editForm.nextOfKin} onChange={(e) => setEditForm({ ...editForm, nextOfKin: e.target.value })} />
            </Field>
            <Field label="Business name">
              <input className={inputClass} value={editForm.businessName} onChange={(e) => setEditForm({ ...editForm, businessName: e.target.value })} />
            </Field>
            <Field label="Registration number">
              <input className={inputClass} value={editForm.registrationNumber} onChange={(e) => setEditForm({ ...editForm, registrationNumber: e.target.value })} />
            </Field>
            <Field label="Tax ID">
              <input className={inputClass} value={editForm.taxId} onChange={(e) => setEditForm({ ...editForm, taxId: e.target.value })} />
            </Field>
            <Field label="Sector">
              <input className={inputClass} value={editForm.sector} onChange={(e) => setEditForm({ ...editForm, sector: e.target.value })} />
            </Field>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  )
}
