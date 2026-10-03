import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Pencil, XCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import { useCanEdit } from '../../lib/useCanEdit'
import { STAFF_ROLE_LABELS } from '../../types'
import type { Disbursement } from '../../types'
import { Breakdown } from './DisbursementPrepare'
import { CHECK_LABELS, DISB_STATUS_LABEL, DISB_STATUS_TONE, DisbursementPipeline, METHOD_LABEL, NETWORKS } from './disbursementParts'

const FREQ: Record<string, string> = { daily: 'daily', weekly: 'weekly', fortnightly: 'fortnightly', monthly: 'monthly' }
const AUTHORISER_ROLES = ['lender_admin', 'branch_manager', 'credit_committee']

/** Loan information, read from the approved application — never re-entered. */
export function LoanInformation({ applicationId, loanNumber, loanId }: { applicationId: string; loanNumber?: string | null; loanId?: string | null }) {
  const application = useStore((s) => s.applications.find((a) => a.id === applicationId))
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === application?.borrowerId))
  const product = useStore((s) => s.products.find((p) => p.id === application?.productId))
  const group = useStore((s) => s.groups.find((g) => g.id === application?.groupId))
  const staff = useStore((s) => s.staff)
  const currency = useStore((s) => s.lender.currency)
  if (!application || !borrower || !product) return null
  const approval = application.approvals.filter((a) => a.decision === 'approved').at(-1)
  const money = (n: number) => formatMoney(n, currency)
  const feeText = product.fees.length
    ? product.fees.map((f) => `${f.name} ${f.kind === 'percent' ? `${f.value}%` : money(f.value)} (${f.timing})`).join(', ')
    : 'None'
  return (
    <Card>
      <CardHeader title="Loan information" subtitle="From the approved application" />
      <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        <Row k="Loan number" v={loanNumber ? (loanId ? <Link to={`/loans/${loanId}`} className="text-brand-700 hover:underline">{loanNumber}</Link> : loanNumber) : <span className="text-slate-400">Assigned when the transfer is confirmed</span>} />
        <Row k={group ? 'Borrower / group' : 'Borrower'} v={<Link to={`/borrowers/${borrower.id}`} className="text-brand-700 hover:underline">{borrower.fullName}{group ? ` · ${group.name}` : ''}</Link>} />
        <Row k="Customer ID" v={borrower.customerNumber} />
        <Row k="Loan product" v={product.name} />
        <Row k="Approved amount" v={<b>{money(application.amount)}</b>} />
        <Row k="Interest" v={`${product.interestRate}% ${product.interestMethod} per ${product.interestPeriod}`} />
        <Row k="Fees" v={feeText} />
        <Row k="Repayment period" v={`${application.termInstalments} ${FREQ[product.repaymentFrequency]} instalments`} />
        <Row k="Approved date" v={approval ? formatDate(approval.date) : '—'} />
        <Row k="Approval reference" v={<Link to={`/applications/${application.id}`} className="text-brand-700 hover:underline">{application.reference}{approval ? ` · ${approval.approverName}` : ''}</Link>} />
        <Row k="Loan officer" v={staff.find((s) => s.id === application.loanOfficerId)?.name ?? '—'} />
      </dl>
    </Card>
  )
}

export default function DisbursementDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const d = useStore((s) => s.disbursements.find((x) => x.id === id))
  const loan = useStore((s) => s.loans.find((l) => l.id === d?.loanId))
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const currency = useStore((s) => s.lender.currency)
  const integrations = useStore((s) => s.integrations)
  const disbursementAction = useStore((s) => s.disbursementAction)
  const simulatePayment = useStore((s) => s.simulatePayment)
  const canEdit = useCanEdit()
  const [modal, setModal] = useState<null | 'verify' | 'confirm' | 'fail' | 'cancel' | 'reverse' | 'release'>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!d) return <p className="text-sm text-slate-500">Disbursement not found. <Link to="/disbursement" className="text-brand-700 underline">Back</Link></p>

  const me = staff.find((s) => s.id === currentStaffId)
  const money = (n: number) => formatMoney(n, currency)
  const isPreparer = d.preparedById === currentStaffId
  const canAuthorise = !!me && AUTHORISER_ROLES.includes(me.role) && !isPreparer
  const awaitingSecond = d.requiresDualAuthorisation && !!d.authorisedById && !d.secondAuthorisedById

  async function act(action: Parameters<typeof disbursementAction>[1], body?: Parameters<typeof disbursementAction>[2]) {
    setBusy(true)
    setError(null)
    try {
      await disbursementAction(d!.id, action, body)
      setModal(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const nextStep = (() => {
    if (!canEdit) return null
    switch (d.status) {
      case 'pending':
        return <Button disabled={busy} onClick={() => act('submit')}>Send for verification</Button>
      case 'under_verification':
        if (!d.verifiedById) return <Button disabled={busy || isPreparer} onClick={() => setModal('verify')}>Verify</Button>
        return (
          <Button disabled={busy || !canAuthorise || (awaitingSecond && d.authorisedById === currentStaffId)} onClick={() => act('authorise')}>
            {awaitingSecond ? 'Give second authorisation' : 'Authorise'}
          </Button>
        )
      case 'approved':
        return <Button disabled={busy} onClick={() => setModal('release')}>Release money</Button>
      case 'processing':
        if (d.method === 'mobile_money') return null
        return (
          <>
            <Button variant="danger" disabled={busy} onClick={() => setModal('fail')}>Mark failed</Button>
            <Button disabled={busy} onClick={() => setModal('confirm')}>Confirm disbursement</Button>
          </>
        )
      default:
        return null
    }
  })()

  const blocker = (() => {
    if (d.status === 'under_verification' && !d.verifiedById && isPreparer) return 'You prepared this disbursement, so someone else must verify it.'
    if (d.status === 'under_verification' && d.verifiedById && !canAuthorise)
      return isPreparer ? 'You prepared this disbursement, so someone else must authorise it.' : 'Authorisation needs a branch manager, credit committee member or administrator.'
    if (awaitingSecond && d.authorisedById === currentStaffId) return 'You gave the first authorisation. A different authoriser must give the second.'
    if (d.status === 'processing' && d.method === 'mobile_money') return 'Waiting for the payment gateway to confirm the transfer.'
    return null
  })()

  return (
    <div>
      <PageHeader
        title={`Disbursement ${d.number}`}
        subtitle={`${d.borrowerName} · ${d.applicationReference} · prepared ${formatDateTime(d.preparedAt)}`}
        action={
          <div className="flex flex-wrap gap-2">
            {canEdit && (d.status === 'pending' || d.status === 'under_verification') && (
              <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => navigate(`/disbursement/${d.id}/edit`)}>Change</Button>
            )}
            {canEdit && ['pending', 'under_verification', 'approved'].includes(d.status) && (
              <Button variant="ghost" onClick={() => setModal('cancel')}>Cancel</Button>
            )}
            {canEdit && d.status === 'successful' && <Button variant="danger" onClick={() => setModal('reverse')}>Reverse</Button>}
            {nextStep}
          </div>
        }
      />

      <Card className="mb-5 p-4">
        <DisbursementPipeline status={d.status} />
        {blocker && <p className="mt-3 text-xs text-amber-700">{blocker}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <LoanInformation applicationId={d.applicationId} loanNumber={d.loanNumber} loanId={d.loanId} />

          <Card>
            <CardHeader title="Payment destination" />
            <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Row k="Method" v={METHOD_LABEL[d.method]} />
              <Row k="Recipient" v={d.recipientType === 'borrower' ? 'The borrower' : 'Authorised third party'} />
              <Row k="Account holder" v={d.recipientName} />
              <Row k={d.method === 'mobile_money' ? 'Network' : 'Bank / provider'} v={NETWORKS[d.recipientProvider] ?? d.recipientProvider} />
              <Row k={d.method === 'mobile_money' ? 'Phone' : 'Account / ID'} v={d.recipientAccount} />
              <Row k="Destination verified" v={d.destinationVerified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Not yet</Badge>} />
              {d.authorisationNote && <Row k="Borrower's authorisation" v={d.authorisationNote} />}
            </dl>
            {d.warnings.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {d.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Verification" subtitle={d.verifiedById ? `Verified by ${d.staffNames.verifiedBy} · ${formatDateTime(d.verifiedAt!)}` : 'Checked by someone other than the preparer'} />
            <ul className="grid gap-2 sm:grid-cols-2">
              {Object.entries(CHECK_LABELS).map(([k, label]) => {
                const ok = (d.verifiedById ? d.checks : d.checklist)[k]
                return (
                  <li key={k} className="flex items-center gap-2 text-sm">
                    {ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <XCircle size={16} className="text-red-500" />}
                    <span className={ok ? 'text-slate-700' : 'text-red-700'}>{label}</span>
                  </li>
                )
              })}
            </ul>
            {d.overrideReason && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Override: {d.overrideReason}</p>}
          </Card>

          {loan && d.status === 'successful' && (
            <Card>
              <CardHeader title="Repayment schedule activated" subtitle={`Disbursed ${formatDate(loan.disbursement?.date ?? d.confirmedAt!)}`} />
              <ol className="grid gap-2 sm:grid-cols-2">
                {loan.schedule.map((i) => (
                  <li key={i.period} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-600">Instalment {i.period} → {formatDate(i.dueDate)}</span>
                    <span className="font-medium tabular-nums text-slate-800">{money(i.totalDue)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Financial breakdown" />
            <Breakdown preview={d} money={money} />
          </Card>

          <Card>
            <CardHeader title="Authorisation" subtitle={d.requiresDualAuthorisation ? 'Large loan: two authorisers required' : undefined} />
            <dl className="space-y-1 text-sm">
              <Person k="Prepared by" name={d.staffNames.preparedBy} at={d.preparedAt} />
              <Person k="Verified by" name={d.staffNames.verifiedBy} at={d.verifiedAt} />
              <Person k="Authorised by" name={d.staffNames.authorisedBy} at={d.authorisedAt} />
              {d.requiresDualAuthorisation && <Person k="Second authoriser" name={d.staffNames.secondAuthorisedBy} at={d.secondAuthorisedAt} />}
              <Person k="Processed by" name={d.staffNames.processedBy} at={d.processedAt} />
              {d.reversedAt && <Person k="Reversed by" name={d.staffNames.reversedBy} at={d.reversedAt} />}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Transaction" />
            <dl className="space-y-1 text-sm">
              <Row k="Disbursement ID" v={d.number} />
              <Row k="Loan" v={d.loanNumber ?? '—'} />
              <Row k="Amount" v={money(d.approvedAmount)} />
              <Row k="Net amount" v={<b>{money(d.netAmount)}</b>} />
              <Row k="Method" v={METHOD_LABEL[d.method]} />
              <Row k="Reference" v={d.transactionReference || '—'} />
              <Row k="Date" v={d.confirmedAt ? formatDateTime(d.confirmedAt) : d.processedAt ? formatDateTime(d.processedAt) : '—'} />
              <Row k="Processed by" v={d.staffNames.processedBy || '—'} />
              <Row k="Status" v={<Badge tone={DISB_STATUS_TONE[d.status]}>{DISB_STATUS_LABEL[d.status]}</Badge>} />
              {d.paymentStatus && <Row k="Gateway" v={d.paymentStatus} />}
            </dl>
            {d.failureReason && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{d.failureReason}</p>}
            {d.cancelReason && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">Cancelled: {d.cancelReason}</p>}
            {d.reversalReason && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Reversed: {d.reversalReason}</p>}
            {d.status === 'processing' && d.method === 'mobile_money' && d.paymentId && integrations?.payments.simulated && canEdit && (
              <div className="mt-3 flex gap-2 rounded-lg bg-slate-50 p-3">
                <span className="flex-1 text-xs text-slate-500">Test gateway: simulate the network's answer</span>
                <Button size="sm" variant="secondary" onClick={() => simulatePayment(d.paymentId!, 'failed')}>Decline</Button>
                <Button size="sm" onClick={() => simulatePayment(d.paymentId!, 'success')}>Approve</Button>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Audit trail" />
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {d.events.map((e) => (
                <li key={e.id}>
                  <span className={clsx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full', ['failed', 'reversed'].includes(e.status) ? 'bg-red-500' : 'bg-brand-500')} />
                  <p className="text-sm font-medium text-slate-800">{e.action}</p>
                  {e.note && <p className="text-xs text-slate-500">{e.note}</p>}
                  {Object.entries(e.changes ?? {}).map(([k, c]) => (
                    <p key={k} className="text-xs text-slate-500">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}: {c.from || '—'} → {c.to || '—'}</p>
                  ))}
                  <p className="text-xs text-slate-400">{formatDateTime(e.at)}{e.by ? ` · ${e.by}` : ''}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <ActionModals d={d} modal={modal} onClose={() => setModal(null)} act={act} busy={busy} me={me ? STAFF_ROLE_LABELS[me.role] : ''} />
    </div>
  )
}

function ActionModals({
  d,
  modal,
  onClose,
  act,
  busy,
  me,
}: {
  d: Disbursement
  modal: null | 'verify' | 'confirm' | 'fail' | 'cancel' | 'reverse' | 'release'
  onClose: () => void
  act: (action: 'verify' | 'confirm' | 'cancel' | 'reverse' | 'release', body?: Record<string, unknown>) => Promise<void>
  busy: boolean
  me: string
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [override, setOverride] = useState('')
  const [reference, setReference] = useState(d.transactionReference)
  const [reason, setReason] = useState('')
  const failing = Object.entries(d.checklist).filter(([k, ok]) => !ok && k !== 'destinationVerified').map(([k]) => CHECK_LABELS[k])
  const titles = {
    verify: 'Verify disbursement',
    confirm: 'Confirm the transaction went through',
    fail: 'Mark the transfer as failed',
    cancel: 'Cancel disbursement',
    reverse: 'Reverse disbursement',
    release: 'Release the money',
  }
  return (
    <Modal open={modal !== null} onClose={onClose} title={modal ? titles[modal] : ''}>
      {modal === 'verify' && (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Check the destination against the borrower's ID and profile: <b>{d.recipientName}</b>, {NETWORKS[d.recipientProvider] ?? d.recipientProvider} {d.recipientAccount}.
          </p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I have confirmed the destination belongs to the borrower or their authorised recipient.
          </label>
          {failing.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
              Not met: {failing.join('; ')}. Resolve these, or record why you are overriding.
            </div>
          )}
          <Field label="Override reason" hint="Only needed if a check isn't met">
            <input className={inputClass} value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
          <Button className="w-full" disabled={busy || !confirmed} onClick={() => act('verify', { destinationConfirmed: confirmed, overrideReason: override })}>
            Record verification
          </Button>
        </div>
      )}
      {modal === 'release' && (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Send <b>{formatMoney(d.netAmount)}</b> to {d.recipientName} by {METHOD_LABEL[d.method].toLowerCase()}.{' '}
            {d.method === 'mobile_money'
              ? 'The payment gateway will confirm the transfer, and the loan opens only then.'
              : 'Record the bank, cash or wallet reference when the transaction completes. The loan opens only then.'}
          </p>
          {d.method !== 'mobile_money' && (
            <Field label="Transaction reference (if you already have it)">
              <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          <p className="text-xs text-slate-400">Released by you ({me}). The approver and the application's creator can't release funds.</p>
          <Button className="w-full" disabled={busy} onClick={() => act('release', { reference })}>Release</Button>
        </div>
      )}
      {modal === 'confirm' && (
        <div className="space-y-4 text-sm">
          <Field label="Transaction reference" hint="Bank reference, cash voucher or wallet receipt">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">Confirming opens the loan, starts its repayment schedule and posts the ledger entries.</p>
          <Button className="w-full" disabled={busy || !reference.trim()} onClick={() => act('confirm', { success: true, reference })}>Confirm disbursement</Button>
        </div>
      )}
      {(modal === 'fail' || modal === 'cancel' || modal === 'reverse') && (
        <div className="space-y-4 text-sm">
          {modal === 'reverse' && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
              Reversing closes loan {d.loanNumber}, posts contra ledger entries and returns the application to approved. Only possible before any repayment.
            </p>
          )}
          <Field label="Reason" hint="Recorded permanently in the audit trail">
            <textarea rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button
            variant="danger"
            className="w-full"
            disabled={busy || !reason.trim()}
            onClick={() => (modal === 'fail' ? act('confirm', { success: false, reason }) : act(modal, { reason }))}
          >
            {modal === 'fail' ? 'Mark failed' : modal === 'cancel' ? 'Cancel disbursement' : 'Reverse disbursement'}
          </Button>
        </div>
      )}
    </Modal>
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

function Person({ k, name, at }: { k: string; name: string; at: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right">
        {name ? <span className="font-medium text-slate-800">{name}</span> : <span className="text-slate-400">—</span>}
        {name && at && <span className="block text-[11px] text-slate-400">{formatDateTime(at)}</span>}
      </dd>
    </div>
  )
}
