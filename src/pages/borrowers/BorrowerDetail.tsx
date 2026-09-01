import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ShieldAlert, ShieldCheck, Landmark } from 'lucide-react'
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
import type { ApplicationStatus, DisbursementChannel } from '../../types'

const tabs = [
  { id: 'profile', label: 'Profile' },
  { id: 'applications', label: 'Applications' },
  { id: 'loans', label: 'Loans & Disbursements' },
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
  const canEdit = useCanEdit()
  const [tab, setTab] = useState('profile')
  const [blOpen, setBlOpen] = useState(false)
  const [reason, setReason] = useState('')

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
          canEdit &&
          (borrower.blacklisted ? (
            <Button variant="secondary" icon={<ShieldCheck size={15} />} onClick={() => void setBorrowerBlacklist(borrower.id, false, null)}>
              Remove from blacklist
            </Button>
          ) : (
            <Button variant="danger" icon={<ShieldAlert size={15} />} onClick={() => setBlOpen(true)}>
              Blacklist borrower
            </Button>
          ))
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
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
                        <Link to={`/applications/${app.id}`} className="font-medium text-slate-800 hover:text-indigo-600 hover:underline">
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
                      <Badge tone={loan.status === 'active' ? 'green' : loan.status === 'closed' ? 'slate' : 'amber'}>{loan.status.replace('_', ' ')}</Badge>
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
            <CardHeader title="Documents" />
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

        {tab === 'history' && (
          <Card>
            <CardHeader title="Full history" subtitle="Every stage on this file" />
            <ol className="space-y-4 border-l border-slate-200 pl-4">
              {borrower.history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-indigo-500" />
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
