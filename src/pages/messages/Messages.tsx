import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { MessageSquare, Send, Users, User, Info } from 'lucide-react'
import { useStore, type BulkSmsInput } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Table } from '../../components/ui/Table'
import { Field, inputClass } from '../../components/ui/Field'
import { formatDateTime } from '../../lib/format'
import { api } from '../../lib/api'
import { useCanEdit } from '../../lib/useCanEdit'

const PLACEHOLDERS = ['{name}', '{first_name}', '{customer_number}', '{amount_due}', '{due_date}', '{outstanding}', '{lender}']

const TEMPLATES: { label: string; body: string }[] = [
  { label: 'Payment reminder', body: 'Habari {first_name}, your payment of {amount_due} is due on {due_date}. Asante — {lender}' },
  { label: 'Overdue notice', body: 'Dear {name}, your loan is overdue. Please pay {amount_due} today to avoid penalties. {lender}' },
  { label: 'Balance update', body: 'Dear {name} ({customer_number}), your outstanding balance is {outstanding}. {lender}' },
  { label: 'Meeting / general', body: 'Dear {first_name}, ' },
]

const AUDIENCES: { id: BulkSmsInput['audience']; label: string; hint: string }[] = [
  { id: 'due_soon', label: 'Payment due soon', hint: 'Borrowers with an instalment due in the next few days' },
  { id: 'overdue', label: 'Overdue', hint: 'Borrowers with a loan in arrears' },
  { id: 'active_loans', label: 'All with active loans', hint: 'Everyone currently repaying' },
  { id: 'group', label: 'A group', hint: 'Active members of one solidarity group' },
  { id: 'all', label: 'All active borrowers', hint: 'Every active customer (blacklisted excluded)' },
  { id: 'custom', label: 'Pick borrowers', hint: 'Choose recipients one by one' },
]

const segmentsOf = (s: string) => (s.length <= 160 ? 1 : Math.ceil(s.length / 153))

interface Preview {
  recipients: number
  segments: number
  creditsAvailable: number
  sample: { borrowerId: string; name: string; phone: string; body: string }[]
}

export default function Messages() {
  const borrowers = useStore((s) => s.borrowers)
  const branches = useStore((s) => s.branches)
  const groups = useStore((s) => s.groups)
  const notifications = useStore((s) => s.notifications)
  const lender = useStore((s) => s.lender)
  const integrations = useStore((s) => s.integrations)
  const sendSms = useStore((s) => s.sendSms)
  const sendBulkSms = useStore((s) => s.sendBulkSms)
  const canEdit = useCanEdit()

  const linkedGroup = new URLSearchParams(window.location.search).get('group')
  const [mode, setMode] = useState<'single' | 'bulk'>(linkedGroup ? 'bulk' : 'single')
  const [message, setMessage] = useState(TEMPLATES[0].body)
  const [busy, setBusy] = useState(false)

  // single
  const [borrowerId, setBorrowerId] = useState(() => new URLSearchParams(window.location.search).get('borrower') ?? '')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')

  // bulk
  const [audience, setAudience] = useState<BulkSmsInput['audience']>(linkedGroup ? 'group' : 'due_soon')
  const [branchId, setBranchId] = useState('')
  const [groupId, setGroupId] = useState(linkedGroup ?? groups[0]?.id ?? '')
  const [dueWithin, setDueWithin] = useState(3)
  const [picked, setPicked] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)

  const bulkInput: BulkSmsInput = {
    audience,
    message,
    branchId: branchId || null,
    groupId: audience === 'group' ? groupId || null : null,
    borrowerIds: audience === 'custom' ? picked : [],
    dueWithinDays: dueWithin,
  }

  useEffect(() => {
    if (mode !== 'bulk' || !message.trim()) return
    let cancelled = false
    const t = setTimeout(() => {
      api
        .post<Preview>('/sms/bulk', { ...bulkInput, dryRun: true })
        .then((p) => !cancelled && setPreview(p))
        .catch(() => !cancelled && setPreview(null))
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, message, audience, branchId, groupId, dueWithin, picked.join(',')])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return borrowers
      .filter((b) => `${b.fullName} ${b.phone} ${b.customerNumber}`.toLowerCase().includes(q))
      .slice(0, 6)
  }, [borrowers, search])

  const selected = borrowers.find((b) => b.id === borrowerId)
  const history = notifications.filter((n) => n.kind === 'manual' || n.kind === 'bulk')

  async function send() {
    setBusy(true)
    try {
      if (mode === 'single') {
        await sendSms({ borrowerId: borrowerId || undefined, to: borrowerId ? undefined : to, message })
      } else {
        await sendBulkSms(bulkInput)
        setPreview(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const canSend =
    !!message.trim() &&
    (mode === 'single' ? !!(borrowerId || to.trim()) : !!preview && preview.recipients > 0 && preview.segments <= preview.creditsAvailable)

  return (
    <div>
      <PageHeader title="Messages" subtitle="Send SMS reminders and notices to one customer or many at once" />

      {integrations?.sms.simulated && (
        <div className="mb-5 flex items-start gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <Info size={16} className="mt-0.5 shrink-0" />
          SMS gateway: <b className="mx-1">{integrations.sms.provider}</b> (test mode — messages are logged, not delivered). Connect a
          real SMS API by setting <code className="mx-1 rounded bg-white px-1">LMS_SMS_PROVIDER</code> on the server.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <div className="mb-5 flex gap-2">
            {(['single', 'bulk'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx(
                  'flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium',
                  mode === m ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {m === 'single' ? <User size={14} /> : <Users size={14} />}
                {m === 'single' ? 'Single SMS' : 'Bulk SMS'}
              </button>
            ))}
          </div>

          {mode === 'single' ? (
            <div className="space-y-4">
              {selected ? (
                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{selected.fullName}</p>
                    <p className="text-xs text-slate-400">
                      {selected.customerNumber} · {selected.phone}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setBorrowerId('')}>Change</Button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Borrower" hint="Placeholders are filled from their loan">
                    <div className="relative">
                      <input className={inputClass} placeholder="Search name, phone, CUS-…" value={search} onChange={(e) => setSearch(e.target.value)} />
                      {matches.length > 0 && (
                        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[var(--shadow-pop)]">
                          {matches.map((b) => (
                            <li key={b.id}>
                              <button
                                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                                onClick={() => {
                                  setBorrowerId(b.id)
                                  setSearch('')
                                }}
                              >
                                {b.fullName} <span className="text-xs text-slate-400">· {b.phone}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Field>
                  <Field label="…or any phone number">
                    <input className={inputClass} placeholder="+255 7…" value={to} onChange={(e) => setTo(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-3">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAudience(a.id)}
                    className={clsx(
                      'rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                      audience === a.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <p className="font-semibold">{a.label}</p>
                    <p className="text-xs text-slate-500">{a.hint}</p>
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Branch">
                  <select className={inputClass} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">All branches</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </Field>
                {audience === 'due_soon' && (
                  <Field label="Due within (days)">
                    <input type="number" min={0} max={60} className={inputClass} value={dueWithin} onChange={(e) => setDueWithin(Number(e.target.value))} />
                  </Field>
                )}
                {audience === 'group' && (
                  <Field label="Group">
                    <select className={inputClass} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
              {audience === 'custom' && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {borrowers
                    .filter((b) => b.status !== 'blacklisted')
                    .map((b) => (
                      <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={picked.includes(b.id)}
                          onChange={(e) => setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))}
                        />
                        {b.fullName} <span className="text-xs text-slate-400">{b.phone}</span>
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-5">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button key={t.label} onClick={() => setMessage(t.body)} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200">
                  {t.label}
                </button>
              ))}
            </div>
            <textarea rows={4} className={inputClass} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <div className="flex flex-wrap gap-1">
                {PLACEHOLDERS.map((p) => (
                  <button key={p} onClick={() => setMessage((m) => m + p)} className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-slate-500 hover:bg-slate-100">
                    {p}
                  </button>
                ))}
              </div>
              <span>
                {message.length} chars · {segmentsOf(message)} SMS per recipient
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-500">
              Credits: <b className="text-slate-800">{lender.smsBalance.toLocaleString()}</b>
              {mode === 'bulk' && preview && (
                <>
                  {' · '}This send: <b className="text-slate-800">{preview.recipients}</b> recipients,{' '}
                  <b className={preview.segments > preview.creditsAvailable ? 'text-accent-600' : 'text-slate-800'}>{preview.segments}</b> credits
                </>
              )}
            </p>
            <Button icon={<Send size={14} />} disabled={!canEdit || !canSend || busy} onClick={send}>
              {busy ? 'Sending…' : mode === 'bulk' ? `Send to ${preview?.recipients ?? 0}` : 'Send SMS'}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Preview" subtitle={mode === 'bulk' ? 'First recipients, personalised' : 'How it will read'} />
          {mode === 'bulk' ? (
            preview && preview.sample.length ? (
              <ul className="space-y-3">
                {preview.sample.map((s) => (
                  <li key={s.borrowerId}>
                    <p className="text-xs text-slate-400">{s.name} · {s.phone}</p>
                    <p className="mt-1 rounded-2xl rounded-tl-sm bg-brand-50 px-3 py-2 text-sm text-slate-800">{s.body}</p>
                  </li>
                ))}
                {preview.recipients > preview.sample.length && (
                  <li className="text-xs text-slate-400">…and {preview.recipients - preview.sample.length} more</li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No borrowers match this audience.</p>
            )
          ) : (
            <p className="rounded-2xl rounded-tl-sm bg-brand-50 px-3 py-2 text-sm text-slate-800">
              {selected
                ? message.replace('{name}', selected.fullName).replace('{first_name}', selected.fullName.split(' ')[0]).replace('{customer_number}', selected.customerNumber).replace('{lender}', lender.name)
                : message}
            </p>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <MessageSquare size={15} /> Sent messages
        </h3>
        <Table
          rowKey={(n) => n.id}
          rows={history}
          pageSize={15}
          emptyMessage="No manual or bulk messages sent yet."
          filterPlaceholder="Filter by phone, text or batch"
          filterAccessor={(n) => `${n.to} ${n.body} ${n.batch} ${n.sentBy}`}
          columns={[
            { header: 'Time', cell: (n) => formatDateTime(n.createdAt), sort: (n) => n.createdAt },
            { header: 'To', cell: (n) => borrowers.find((b) => b.id === n.borrowerId)?.fullName ?? n.to },
            { header: 'Message', cell: (n) => <span className="text-slate-500">{n.body}</span> },
            { header: 'Type', cell: (n) => (n.batch ? <Badge tone="blue">{n.batch}</Badge> : <Badge tone="slate">Single</Badge>) },
            { header: 'By', cell: (n) => n.sentBy },
            {
              header: 'Status',
              cell: (n) => <Badge tone={n.status === 'sent' || n.status === 'delivered' ? 'green' : n.status === 'failed' ? 'red' : 'amber'}>{n.status === 'failed' ? n.error || 'failed' : n.status}</Badge>,
            },
          ]}
        />
      </div>
    </div>
  )
}
