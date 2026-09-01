import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { CheckCircle2, XCircle, FileText } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { STAFF_ROLE_LABELS } from '../../types'
import { formatDate, formatMoney } from '../../lib/format'
import { NAV_ACCESS } from '../../lib/permissions'

function CheckRow({ label, pass }: { label: string; pass: boolean }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {pass ? <CheckCircle2 size={16} className="text-emerald-600" /> : <XCircle size={16} className="text-red-600" />}
      <span className={pass ? 'text-slate-700' : 'text-red-700'}>{label}</span>
    </li>
  )
}

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const application = useStore((s) => s.applications.find((a) => a.id === id))
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === application?.borrowerId))
  const product = useStore((s) => s.products.find((p) => p.id === application?.productId))
  const lender = useStore((s) => s.lender)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const decideApplication = useStore((s) => s.decideApplication)
  const [decideOpen, setDecideOpen] = useState<'approved' | 'declined' | null>(null)
  const [comment, setComment] = useState('')
  const [offerOpen, setOfferOpen] = useState(false)

  if (!application || !borrower || !product) return <p className="text-sm text-slate-500">Application not found.</p>

  const currentStaff = staff.find((s) => s.id === currentStaffId)
  const isCreator = application.createdBy === currentStaffId
  const roleMatches = currentStaff?.role === application.requiredApproverRole || currentStaff?.role === 'lender_admin'
  const canDecide = application.status === 'pending_approval' || application.status === 'submitted'
  const canTakeDecision = canDecide && roleMatches && !isCreator

  const allChecksPass = application.affordabilityPass && application.duplicateCheckPass && application.blacklistCheckPass
  const canDisburse = currentStaff ? NAV_ACCESS[currentStaff.role].includes('/disbursement') : false

  return (
    <div>
      <PageHeader
        title={application.reference}
        subtitle={`${borrower.fullName} · ${product.name} · Submitted ${formatDate(application.createdAt)}`}
        action={
          <div className="flex gap-2">
            {application.status === 'approved' && (
              <Button variant="secondary" icon={<FileText size={15} />} onClick={() => setOfferOpen(true)}>
                Offer letter
              </Button>
            )}
            {application.status === 'approved' && canDisburse && (
              <Button onClick={() => navigate('/disbursement')}>Go to disbursement</Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Application details" />
            <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-3">
              <Detail label="Amount" value={formatMoney(application.amount, lender.currency)} />
              <Detail label="Term" value={`${application.termInstalments} instalments`} />
              <Detail label="Purpose" value={application.purpose} />
              <Detail label="Declared income" value={formatMoney(application.declaredIncome, lender.currency)} />
              <Detail label="Declared expenses" value={formatMoney(application.declaredExpenses, lender.currency)} />
              <Detail label="Created by" value={staff.find((s) => s.id === application.createdBy)?.name ?? '—'} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Automatic checks" />
            <ul className="space-y-2">
              <CheckRow label="Affordability check" pass={application.affordabilityPass} />
              <CheckRow label="Duplicate borrower check" pass={application.duplicateCheckPass} />
              <CheckRow label="Blacklist check" pass={application.blacklistCheckPass} />
              <CheckRow label="Credit bureau consent recorded" pass={application.creditBureauConsent} />
            </ul>
            {application.score !== null && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">Score: {application.score}/100</span>
                <Badge tone={application.scoreRecommendation === 'recommend' ? 'green' : application.scoreRecommendation === 'caution' ? 'amber' : 'red'}>
                  {application.scoreRecommendation}
                </Badge>
                <span className="text-xs text-slate-400">Recommendation only — approval remains a human decision.</span>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Approval trail" subtitle={`Requires: ${STAFF_ROLE_LABELS[application.requiredApproverRole]}`} />
            {application.approvals.length === 0 && <p className="text-sm text-slate-400">No decisions recorded yet.</p>}
            <ul className="space-y-3">
              {application.approvals.map((a) => (
                <li key={a.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{a.approverName}</span>
                    <Badge tone={a.decision === 'approved' ? 'green' : 'red'}>{a.decision}</Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    {STAFF_ROLE_LABELS[a.role]} · {formatDate(a.date)}
                  </p>
                  {a.comment && <p className="mt-1 text-slate-600">{a.comment}</p>}
                </li>
              ))}
            </ul>

            {canDecide && (
              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
                <Button variant="primary" disabled={!canTakeDecision} onClick={() => setDecideOpen('approved')}>
                  Approve
                </Button>
                <Button variant="danger" disabled={!canTakeDecision} onClick={() => setDecideOpen('declined')}>
                  Decline
                </Button>
              </div>
            )}
            {canDecide && isCreator && <p className="mt-2 text-xs text-amber-700">You created this application — a different approver must decide it.</p>}
            {canDecide && !isCreator && !roleMatches && (
              <p className="mt-2 text-xs text-slate-400">
                Switch to a {STAFF_ROLE_LABELS[application.requiredApproverRole]} account to approve this amount.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Borrower" />
            <Link to={`/borrowers/${borrower.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
              {borrower.fullName}
            </Link>
            <p className="mt-1 text-xs text-slate-400">{borrower.phone}</p>
            <p className="text-xs text-slate-400">{borrower.nationalId}</p>
          </Card>
          <Card>
            <CardHeader title="Status" />
            <Badge tone={allChecksPass ? 'green' : 'red'}>{application.status.replace('_', ' ')}</Badge>
            {application.declineReason && <p className="mt-2 text-sm text-red-700">{application.declineReason}</p>}
          </Card>
        </div>
      </div>

      <Modal open={decideOpen !== null} onClose={() => setDecideOpen(null)} title={decideOpen === 'approved' ? 'Approve application' : 'Decline application'}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!decideOpen) return
            await decideApplication(application.id, decideOpen, comment)
            setDecideOpen(null)
            setComment('')
          }}
        >
          <Field label="Comment" hint="Recorded permanently against this application">
            <textarea required rows={3} className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Button type="submit" variant={decideOpen === 'approved' ? 'primary' : 'danger'} className="w-full">
            Confirm {decideOpen}
          </Button>
        </form>
      </Modal>

      <Modal open={offerOpen} onClose={() => setOfferOpen(false)} title="Offer letter" wide>
        <div className="space-y-3 text-sm text-slate-700">
          <p className="font-semibold">{lender.name}</p>
          <p className="text-xs text-slate-400">{lender.address} · Licence {lender.licenceNumber}</p>
          <hr className="border-slate-200" />
          <p>Dear {borrower.fullName},</p>
          <p>
            We are pleased to confirm your loan of <strong>{formatMoney(application.amount, lender.currency)}</strong> under the{' '}
            {product.name} product, repayable over {application.termInstalments} instalments at {product.interestRate}%{' '}
            {product.interestMethod} interest per {product.interestPeriod}.
          </p>
          <p>Please visit any branch to sign this agreement before disbursement.</p>
          <p className="text-xs text-slate-400">Generated {formatDate(new Date().toISOString())} · Approved by {application.approvals.at(-1)?.approverName}</p>
        </div>
      </Modal>
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
