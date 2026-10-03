import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, Banknote, HandCoins, MapPin, MessageSquare, Phone, Send, StickyNote } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDate, formatDateTime, formatMoney } from '../../lib/format'
import { isSupervisor } from '../../lib/permissions'
import { useCanEdit } from '../../lib/useCanEdit'
import type { CollectionActivityInput, CollectionCaseStatus, CollectionTimelineEvent, RepaymentChannel } from '../../types'
import { CHANNEL_LABEL, NEEDS_REFERENCE, RecordPaymentForm } from '../repayments/repaymentParts'
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, CONTACT_METHODS, OUTCOMES, STAGE_LABEL } from './collectionParts'
import { RestructureBlock } from './RestructureBlock'

const EVENT_ICON: Record<string, typeof Phone> = {
  call: Phone, visit: MapPin, message: MessageSquare, sms: MessageSquare, note: StickyNote, promise: HandCoins,
  escalation: AlertTriangle, payment: Banknote,
}
const EVENT_TONE: Record<string, string> = {
  due: 'bg-slate-400', sms: 'bg-blue-500', payment: 'bg-emerald-500', promise_missed: 'bg-red-500', reversal: 'bg-red-500',
  escalation: 'bg-red-500', case: 'bg-slate-300',
}

type Mode = 'contact' | 'promise' | 'visit' | 'escalate' | 'payment' | 'manage' | null

export default function CaseDetail() {
  const { id } = useParams()
  const c = useStore((s) => s.collectionCases.find((x) => x.id === id))
  const loan = useStore((s) => s.loans.find((l) => l.id === c?.loanId))
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === loan?.borrowerId))
  const activities = useStore((s) => s.collectionActivities)
  const repayments = useStore((s) => s.repayments)
  const me = useStore((s) => s.currentUser)
  const currency = useStore((s) => s.lender.currency)
  const loadCollectionTimeline = useStore((s) => s.loadCollectionTimeline)
  const sendLoanReminder = useStore((s) => s.sendLoanReminder)
  const refreshCollectionCases = useStore((s) => s.refreshCollectionCases)
  const canEdit = useCanEdit()
  const [timeline, setTimeline] = useState<CollectionTimelineEvent[]>([])
  const [mode, setMode] = useState<Mode>(null)
  const money = (n: number) => formatMoney(n, currency)

  const reload = useCallback(() => {
    if (c) loadCollectionTimeline(c.loanId).then(setTimeline).catch(() => setTimeline([]))
  }, [c, loadCollectionTimeline])
  useEffect(reload, [reload, activities, repayments])
  useEffect(() => {
    if (!c) refreshCollectionCases()
  }, [c, refreshCollectionCases])

  if (!c || !loan || !borrower) return <p className="text-sm text-slate-500">Loading case…</p>
  const closed = c.status === 'resolved' || c.status === 'paid'
  const supervisor = me ? isSupervisor(me.role) : false

  return (
    <div>
      <PageHeader
        title={`${c.number} · ${borrower.fullName}`}
        subtitle={`${c.loanNumber}${c.groupName ? ` · ${c.groupName}` : ''} · opened ${formatDate(c.openedAt)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link to={`/loans/${loan.id}`}><Button variant="secondary">Open loan</Button></Link>
            {canEdit && !closed && (
              <Button variant="secondary" icon={<Send size={14} />} disabled={loan.daysInArrears <= 0} onClick={() => sendLoanReminder(loan.id)}>
                SMS reminder
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={CASE_STATUS_TONE[c.status]} dot>{CASE_STATUS_LABEL[c.status]}</Badge>
        <Badge>{STAGE_LABEL[c.stage] ?? c.stage}</Badge>
        <Badge tone="blue">Officer: {c.assignedToName || 'Unassigned'}</Badge>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile k="Outstanding" v={money(c.outstanding)} />
        <Tile k="Overdue" v={money(c.overdueAmount)} bad={c.overdueAmount > 0} />
        <Tile k="Days overdue" v={String(c.daysOverdue)} bad={c.daysOverdue > 0} />
        <Tile k="Missed payments" v={String(c.missedInstalments)} />
        <Tile k="Last payment" v={c.lastPaymentDate ? `${money(c.lastPaymentAmount ?? 0)} · ${formatDate(c.lastPaymentDate)}` : 'None'} />
        <Tile k="Next follow-up" v={c.nextFollowUp ? formatDate(c.nextFollowUp) : '—'} bad={!!c.nextFollowUp && c.nextFollowUp <= new Date().toLocaleDateString('en-CA')} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {canEdit && !closed && (
            <Card>
              <CardHeader title="Record a follow-up" subtitle={c.nextAction ? `Next action: ${c.nextAction}` : undefined} />
              <div className="flex flex-wrap gap-2">
                <Button icon={<Phone size={14} />} onClick={() => setMode('contact')}>Contact attempt</Button>
                <Button variant="secondary" icon={<HandCoins size={14} />} onClick={() => setMode('promise')}>Promise to pay</Button>
                <Button variant="secondary" icon={<MapPin size={14} />} onClick={() => setMode('visit')}>Field visit</Button>
                <Button variant="secondary" icon={<Banknote size={14} />} onClick={() => setMode('payment')}>Record payment</Button>
                <Button variant="secondary" icon={<AlertTriangle size={14} />} onClick={() => setMode('escalate')}>Escalate</Button>
                {supervisor && <Button variant="ghost" onClick={() => setMode('manage')}>Assign / status</Button>}
              </div>
              {c.openPromise && (
                <p className="mt-4 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">
                  Open promise: {money(c.openPromise.amount)} by {formatDate(c.openPromise.date)}
                </p>
              )}
            </Card>
          )}
          {closed && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Case {CASE_STATUS_LABEL[c.status].toLowerCase()} {c.closedAt ? `on ${formatDate(c.closedAt)}` : ''}{c.resolutionNote ? ` — ${c.resolutionNote}` : ''}.
            </p>
          )}

          <Card>
            <CardHeader title="Collection history" subtitle="Every due date, reminder, contact, promise, visit and payment" />
            <ol className="relative space-y-4 border-l border-slate-200 pl-6">
              {timeline.length === 0 && <li className="text-sm text-slate-400">Nothing yet.</li>}
              {[...timeline].reverse().map((e, i) => {
                const Icon = EVENT_ICON[e.kind]
                return (
                  <li key={i}>
                    <span className={clsx('absolute -left-[7px] mt-1 flex h-3.5 w-3.5 items-center justify-center rounded-full', EVENT_TONE[e.kind] ?? 'bg-brand-500')} />
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                      {Icon && <Icon size={13} className="text-slate-400" />}
                      {e.label}
                      {e.outcome && <span className="text-xs font-normal text-slate-500">· {e.outcome.replace('_', ' ')}</span>}
                    </p>
                    {e.note && <p className="text-xs text-slate-500">{e.note}</p>}
                    <p className="text-[11px] text-slate-400">{formatDateTime(e.at)}{e.by ? ` · ${e.by}` : ''}</p>
                  </li>
                )
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Borrower" />
            <dl className="space-y-1 text-sm">
              <Row k="Name" v={<Link to={`/borrowers/${borrower.id}`} className="text-brand-700 hover:underline">{borrower.fullName}</Link>} />
              <Row k="Customer ID" v={borrower.customerNumber} />
              <Row k="Phone" v={borrower.phone} />
              <Row k="Area" v={[borrower.street, borrower.ward, borrower.district].filter(Boolean).join(', ')} />
              {c.groupId && <Row k="Group" v={<Link to={`/groups/${c.groupId}`} className="text-brand-700 hover:underline">{c.groupName}</Link>} />}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Case" />
            <dl className="space-y-1 text-sm">
              <Row k="Assigned to" v={c.assignedToName || 'Unassigned'} />
              <Row k="Assigned by" v={c.assignedBy ? `${c.assignedBy}${c.assignedAt ? ` · ${formatDate(c.assignedAt)}` : ''}` : '—'} />
              <Row k="Last contact" v={c.lastContactAt ? formatDateTime(c.lastContactAt) : '—'} />
              <Row k="Broken promises" v={String(c.brokenPromises)} />
            </dl>
          </Card>
          {supervisor && loan.status === 'active' && <RestructureBlock loanId={loan.id} />}
        </div>
      </div>

      <Modal open={mode === 'payment'} onClose={() => setMode(null)} title="Payment during collection" wide>
        <p className="mb-3 text-xs text-slate-500">The payment is a separate repayment record, linked to this case's latest contact.</p>
        <RecordPaymentForm loan={loan} collectionActivityId={activities.filter((a) => a.loanId === loan.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? null} />
      </Modal>
      <ActivityModal mode={mode} onClose={() => setMode(null)} loanId={loan.id} outstanding={loan.outstandingBalance} />
      <ManageModal open={mode === 'manage'} onClose={() => setMode(null)} caseId={c.id} />
    </div>
  )
}

function ActivityModal({ mode, onClose, loanId, outstanding }: { mode: Mode; onClose: () => void; loanId: string; outstanding: number }) {
  const logCollectionActivity = useStore((s) => s.logCollectionActivity)
  const currency = useStore((s) => s.lender.currency)
  const today = new Date().toLocaleDateString('en-CA')
  const blank: CollectionActivityInput = { kind: 'call', outcome: 'reached', note: '', nextFollowUp: null, nextAction: '' }
  const [f, setF] = useState<CollectionActivityInput>(blank)
  const [withPayment, setWithPayment] = useState(false)
  const [pay, setPay] = useState<{ amount: number; channel: RepaymentChannel; reference: string }>({ amount: 0, channel: 'cash', reference: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [primedFor, setPrimedFor] = useState<Mode>(null)
  if (mode !== primedFor) {
    setPrimedFor(mode)
    setWithPayment(false)
    setError(null)
    if (mode === 'promise') setF({ ...blank, kind: 'promise', outcome: 'promised', promisedAmount: 0, promisedDate: today, reason: '' })
    else if (mode === 'visit') setF({ ...blank, kind: 'visit', outcome: '', visitStatus: 'completed', visitDate: today, location: '', purpose: 'Recover overdue amount', amountCollected: 0 })
    else if (mode === 'escalate') setF({ ...blank, kind: 'escalation', outcome: 'other', nextAction: 'Manager review' })
    else setF(blank)
  }
  const open = mode === 'contact' || mode === 'promise' || mode === 'visit' || mode === 'escalate'
  const set = (patch: Partial<CollectionActivityInput>) => setF((x) => ({ ...x, ...patch }))
  const title = { contact: 'Contact attempt', promise: 'Promise to pay', visit: 'Field visit', escalate: 'Escalate case' }[mode as string] ?? ''

  return (
    <Modal open={open} onClose={onClose} title={title} wide={mode === 'visit'}>
      <div className="space-y-4 text-sm">
        {mode === 'contact' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact method">
              <select className={inputClass} value={f.kind} onChange={(e) => set({ kind: e.target.value as CollectionActivityInput['kind'] })}>
                {CONTACT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Result">
              <select className={inputClass} value={f.outcome} onChange={(e) => set({ outcome: e.target.value as CollectionActivityInput['outcome'] })}>
                {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
          </div>
        )}
        {mode === 'promise' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Promised amount">
              <input type="number" min={0} className={inputClass} value={f.promisedAmount ?? 0} onChange={(e) => set({ promisedAmount: Number(e.target.value) })} />
            </Field>
            <Field label="Promise date">
              <input type="date" min={today} className={inputClass} value={f.promisedDate ?? ''} onChange={(e) => set({ promisedDate: e.target.value })} />
            </Field>
            <Field label="Reason given" hint="Why the payment was late">
              <input className={inputClass} value={f.reason ?? ''} onChange={(e) => set({ reason: e.target.value })} />
            </Field>
          </div>
        )}
        {mode === 'visit' && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:w-80">
              {(['completed', 'scheduled'] as const).map((s) => (
                <button key={s} onClick={() => set({ visitStatus: s })} className={clsx('rounded-xl border px-3 py-2 font-medium', f.visitStatus === s ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600')}>
                  {s === 'completed' ? 'Visit done' : 'Schedule visit'}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Visit date">
                <input type="date" className={inputClass} value={f.visitDate ?? ''} onChange={(e) => set({ visitDate: e.target.value })} />
              </Field>
              <Field label="Location / meeting point" hint="Only what operations need, e.g. the shop or market stall">
                <input className={inputClass} value={f.location ?? ''} onChange={(e) => set({ location: e.target.value })} />
              </Field>
              <Field label="Purpose">
                <input className={inputClass} value={f.purpose ?? ''} onChange={(e) => set({ purpose: e.target.value })} />
              </Field>
              {f.visitStatus === 'completed' && (
                <Field label="Result">
                  <select className={inputClass} value={f.outcome} onChange={(e) => set({ outcome: e.target.value as CollectionActivityInput['outcome'] })}>
                    <option value="">Select…</option>
                    {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </Field>
              )}
            </div>
            {f.visitStatus === 'completed' && (
              <div className="rounded-xl border border-slate-200 p-3">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={withPayment} onChange={(e) => setWithPayment(e.target.checked)} />
                  Payment received during the visit
                </label>
                {withPayment && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field label="Amount" error={pay.amount > outstanding ? 'More than outstanding' : undefined}>
                      <input type="number" min={0} className={inputClass} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} />
                    </Field>
                    <Field label="Method">
                      <select className={inputClass} value={pay.channel} onChange={(e) => setPay({ ...pay, channel: e.target.value as RepaymentChannel })}>
                        {Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label={`Reference${NEEDS_REFERENCE.has(pay.channel) ? ' *' : ''}`}>
                      <input className={inputClass} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
                    </Field>
                    <p className="text-xs text-slate-500 sm:col-span-3">Recorded as a separate repayment with its own receipt, linked to this visit.</p>
                  </div>
                )}
              </div>
            )}
            <Field label="Supporting document / photo" hint="Optional. Avoid photos of people unless your policy requires them.">
              <input
                type="file"
                className="text-xs"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) set({ attachments: [...(f.attachments ?? []), file.name] })
                  e.target.value = ''
                }}
              />
              {(f.attachments ?? []).length > 0 && <p className="mt-1 text-xs text-slate-500">{f.attachments!.join(', ')}</p>}
            </Field>
          </>
        )}
        <Field label="Notes">
          <textarea rows={3} className={inputClass} value={f.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Next action">
            <input className={inputClass} value={f.nextAction ?? ''} onChange={(e) => set({ nextAction: e.target.value })} />
          </Field>
          <Field label="Next follow-up date">
            <input type="date" className={inputClass} value={f.nextFollowUp ?? ''} onChange={(e) => set({ nextFollowUp: e.target.value || null })} />
          </Field>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{error}</p>}
        <Button
          className="w-full"
          disabled={
            busy ||
            (mode === 'promise' && (!f.promisedAmount || !f.promisedDate)) ||
            (mode === 'escalate' && !f.note.trim()) ||
            (withPayment && (pay.amount <= 0 || pay.amount > outstanding || (NEEDS_REFERENCE.has(pay.channel) && !pay.reference.trim())))
          }
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await logCollectionActivity(loanId, {
                ...f,
                amountCollected: withPayment ? pay.amount : f.amountCollected ?? null,
                payment: withPayment ? pay : null,
              })
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not save')
            } finally {
              setBusy(false)
            }
          }}
        >
          Save {currency && mode === 'visit' && withPayment ? `visit and ${formatMoney(pay.amount, currency)} payment` : title.toLowerCase()}
        </Button>
      </div>
    </Modal>
  )
}

function ManageModal({ open, onClose, caseId }: { open: boolean; onClose: () => void; caseId: string }) {
  const c = useStore((s) => s.collectionCases.find((x) => x.id === caseId))
  const staff = useStore((s) => s.staff)
  const stages = useStore((s) => s.lender.collectionStages)
  const updateCollectionCase = useStore((s) => s.updateCollectionCase)
  const [assignedToId, setAssigned] = useState(c?.assignedToId ?? '')
  const [status, setStatus] = useState<CollectionCaseStatus>(c?.status ?? 'pending_follow_up')
  const [stage, setStage] = useState(c?.stage ?? '')
  const [note, setNote] = useState(c?.resolutionNote ?? '')
  const [busy, setBusy] = useState(false)
  if (!c) return null
  return (
    <Modal open={open} onClose={onClose} title="Assign / change status">
      <div className="space-y-4">
        <Field label="Collection officer">
          <select className={inputClass} value={assignedToId} onChange={(e) => setAssigned(e.target.value)}>
            <option value="">Unassigned</option>
            {staff.filter((s) => s.active && ['loan_officer', 'branch_manager', 'lender_admin'].includes(s.role)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as CollectionCaseStatus)}>
            {Object.entries(CASE_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Stage">
          <select className={inputClass} value={stage} onChange={(e) => setStage(e.target.value)}>
            {stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s] ?? s}</option>)}
          </select>
        </Field>
        {(status === 'resolved' || status === 'paid' || status === 'under_review') && (
          <Field label="Note">
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        <Button
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await updateCollectionCase(c.id, { assignedToId: assignedToId || null, status, stage, resolutionNote: note })
              onClose()
            } finally {
              setBusy(false)
            }
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  )
}

function Tile({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
      <p className={clsx('mt-1 font-bold tabular-nums', bad ? 'text-accent-600' : 'text-slate-900')}>{v}</p>
    </div>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-800">{v || '—'}</dd>
    </div>
  )
}
