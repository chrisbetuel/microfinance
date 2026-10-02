import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { Users2, MapPin, Crown, UserPlus, CalendarDays, Wallet, FileText, Flag, Check, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Field, inputClass } from '../../components/ui/Field'
import { formatMoney } from '../../lib/format'
import { GROUP_TYPE_LABELS } from './groupStats'
import type { GroupDetails, GroupMemberRole } from '../../types'

const STEPS = [
  { id: 'details', label: 'Group details', icon: Users2 },
  { id: 'location', label: 'Location', icon: MapPin },
  { id: 'leadership', label: 'Leadership', icon: Crown },
  { id: 'members', label: 'Members', icon: UserPlus },
  { id: 'meetings', label: 'Meeting information', icon: CalendarDays },
  { id: 'financial', label: 'Financial information', icon: Wallet },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'status', label: 'Group status', icon: Flag },
] as const
type StepId = (typeof STEPS)[number]['id']

const DOC_TYPES = ['Group constitution', 'Registration certificate', 'Meeting minutes', 'Members list', 'Other']
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const LEADER_ROLES: { role: GroupMemberRole; label: string; hint: string }[] = [
  { role: 'chair', label: 'Chairperson', hint: 'Leads and coordinates the group' },
  { role: 'secretary', label: 'Secretary', hint: 'Keeps records and meeting minutes' },
  { role: 'treasurer', label: 'Treasurer', hint: 'Manages group money and financial records' },
]

export default function GroupForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const groups = useStore((s) => s.groups)
  const borrowers = useStore((s) => s.borrowers)
  const branches = useStore((s) => s.branches)
  const staff = useStore((s) => s.staff)
  const currentStaffId = useStore((s) => s.currentStaffId)
  const createGroup = useStore((s) => s.createGroup)
  const updateGroup = useStore((s) => s.updateGroup)
  const currency = useStore((s) => s.lender.currency)

  const existing = id ? groups.find((g) => g.id === id) : undefined
  const editing = !!existing
  const steps = STEPS.filter((s) => !(editing && (s.id === 'members' || s.id === 'leadership' || s.id === 'documents')))

  const [form, setForm] = useState<GroupDetails>(() =>
    existing
      ? {
          name: existing.name, branchId: existing.branchId, officerId: existing.officerId, groupType: existing.groupType,
          purpose: existing.purpose, region: existing.region, district: existing.district, ward: existing.ward,
          location: existing.location, meetingLocation: existing.meetingLocation, meetingDay: existing.meetingDay,
          meetingFrequency: existing.meetingFrequency, meetingTime: existing.meetingTime, loanLimit: existing.loanLimit,
          formedOn: existing.formedOn, status: existing.status,
        }
      : {
          name: '', branchId: branches[0]?.id ?? '', officerId: currentStaffId, groupType: 'general', purpose: '',
          region: '', district: '', ward: '', location: '', meetingLocation: '', meetingDay: 'Wednesday',
          meetingFrequency: 'weekly', meetingTime: '10:00', loanLimit: 0,
          formedOn: new Date().toISOString().slice(0, 10), status: 'pending',
        },
  )
  const [leaders, setLeaders] = useState<Record<string, string>>({ chair: '', secretary: '', treasurer: '' })
  const [members, setMembers] = useState<string[]>([])
  const [docs, setDocs] = useState<{ type: string; name: string }[]>([])
  const [step, setStep] = useState<StepId>('details')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof GroupDetails>(k: K, v: GroupDetails[K]) => setForm((f) => ({ ...f, [k]: v }))
  const txt = (k: keyof GroupDetails) => ({
    className: inputClass,
    value: String(form[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value as never),
  })

  const eligible = borrowers.filter((b) => b.branchId === form.branchId && b.status !== 'blacklisted')
  const officers = staff.filter((s) => ['loan_officer', 'branch_manager', 'lender_admin'].includes(s.role) && s.active)
  const leaderIds = Object.values(leaders).filter(Boolean)
  const allMemberIds = Array.from(new Set([...leaderIds, ...members]))
  const idx = steps.findIndex((s) => s.id === step)
  const detailsOk = !!(form.name.trim() && form.branchId && form.officerId)
  const canSave = detailsOk && (editing || allMemberIds.length > 0)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (editing && existing) {
        await updateGroup(existing.id, form)
        navigate(`/groups/${existing.id}`)
      } else {
        const roleOf = (bid: string): GroupMemberRole =>
          (Object.entries(leaders).find(([, v]) => v === bid)?.[0] as GroupMemberRole) ?? 'member'
        const newId = await createGroup({
          ...form,
          members: allMemberIds.map((bid) => ({ borrowerId: bid, role: roleOf(bid) })),
          documents: docs,
        })
        navigate(`/groups/${newId}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the group')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${existing?.name}` : 'Register group'}
        subtitle={editing ? `${existing?.groupNumber} · update the group's details` : 'Form a solidarity group step by step'}
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
          {step === 'details' && (
            <Section title="Group details" hint="Required: group name, branch and group officer.">
              <Grid>
                <Field label="Group ID">
                  <input disabled className={`${inputClass} bg-slate-50`} value={existing?.groupNumber ?? 'Assigned on save'} />
                </Field>
                <Field label="Group name *"><input {...txt('name')} /></Field>
                <Field label="Group type">
                  <select {...txt('groupType')}>
                    {Object.entries(GROUP_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Formation date"><input type="date" {...txt('formedOn')} /></Field>
                <Field label="Branch *">
                  <select {...txt('branchId')}>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="Group officer *" hint="Staff member who manages the group">
                  <select {...txt('officerId')}>
                    {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
              </Grid>
              <div className="mt-4">
                <Field label="Purpose" hint="Why the group was formed">
                  <textarea rows={3} {...txt('purpose')} placeholder="e.g. Members trade at the same market and borrow to restock" />
                </Field>
              </div>
            </Section>
          )}

          {step === 'location' && (
            <Section title="Location" hint="Where the group operates.">
              <Grid>
                <Field label="Region"><input {...txt('region')} /></Field>
                <Field label="District"><input {...txt('district')} /></Field>
                <Field label="Ward"><input {...txt('ward')} /></Field>
                <Field label="Location / area"><input {...txt('location')} placeholder="Village, street or market" /></Field>
              </Grid>
            </Section>
          )}

          {step === 'leadership' && (
            <Section title="Group leadership" hint="Pick leaders from borrowers at the group's branch. They are added as members automatically.">
              <div className="space-y-3">
                {LEADER_ROLES.map((r) => (
                  <div key={r.role} className="grid items-center gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[180px_1fr]">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{r.label}</p>
                      <p className="text-xs text-slate-400">{r.hint}</p>
                    </div>
                    <select
                      className={inputClass}
                      value={leaders[r.role]}
                      onChange={(e) => setLeaders((l) => {
                        const next = { ...l }
                        for (const k of Object.keys(next)) if (next[k] === e.target.value) next[k] = ''
                        next[r.role] = e.target.value
                        return next
                      })}
                    >
                      <option value="">Not assigned</option>
                      {eligible.map((b) => <option key={b.id} value={b.id}>{b.fullName} · {b.customerNumber}</option>)}
                    </select>
                  </div>
                ))}
                <div className="grid items-center gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[180px_1fr]">
                  <p className="text-sm font-semibold text-slate-800">Group officer</p>
                  <p className="text-sm text-slate-600">{staff.find((s) => s.id === form.officerId)?.name ?? '—'} (set under Group details)</p>
                </div>
              </div>
            </Section>
          )}

          {step === 'members' && (
            <Section title="Members" hint={`${allMemberIds.length} member(s). Borrowers at ${branches.find((b) => b.id === form.branchId)?.name ?? 'the branch'}.`}>
              <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {eligible.length === 0 && <p className="p-4 text-sm text-slate-400">No borrowers registered at this branch yet.</p>}
                {eligible.map((b) => {
                  const leader = Object.entries(leaders).find(([, v]) => v === b.id)?.[0]
                  const checked = allMemberIds.includes(b.id)
                  return (
                    <label key={b.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        disabled={!!leader}
                        checked={checked}
                        onChange={(e) => setMembers((m) => (e.target.checked ? [...m, b.id] : m.filter((x) => x !== b.id)))}
                      />
                      <span className="flex-1">
                        <span className="font-medium text-slate-800">{b.fullName}</span>{' '}
                        <span className="text-xs text-slate-400">{b.customerNumber} · {b.phone}</span>
                      </span>
                      {leader && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium capitalize text-brand-700">{leader}</span>}
                    </label>
                  )
                })}
              </div>
            </Section>
          )}

          {step === 'meetings' && (
            <Section title="Meeting information">
              <Grid>
                <Field label="Meeting location"><input {...txt('meetingLocation')} placeholder="e.g. Community hall" /></Field>
                <Field label="Meeting frequency">
                  <select {...txt('meetingFrequency')}>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every two weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </Field>
                <Field label="Meeting day">
                  <select {...txt('meetingDay')}>
                    {WEEKDAYS.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Meeting time"><input type="time" {...txt('meetingTime')} /></Field>
              </Grid>
            </Section>
          )}

          {step === 'financial' && (
            <Section title="Financial information" hint="Savings, outstanding loans and repayments are tracked automatically once the group is active.">
              <Grid>
                <Field label="Group loan limit" hint="Maximum the group may borrow under your rules">
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    value={form.loanLimit}
                    onChange={(e) => set('loanLimit', Number(e.target.value))}
                  />
                </Field>
              </Grid>
              {existing && (
                <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
                  Current group savings: <b>{formatMoney(existing.savingsTotal, currency)}</b> · meeting contributions:{' '}
                  <b>{formatMoney(existing.contributionsTotal, currency)}</b>
                </p>
              )}
            </Section>
          )}

          {step === 'documents' && (
            <Section title="Documents" hint="Attach the group's constitution, registration and other papers.">
              <div className="space-y-3">
                {DOC_TYPES.map((type) => {
                  const attached = docs.filter((d) => d.type === type)
                  return (
                    <div key={type} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{type}</p>
                        <p className="text-xs text-slate-400">
                          {attached.length
                            ? attached.map((d, i) => (
                                <span key={i} className="mr-2 inline-flex items-center gap-1">
                                  {d.name}
                                  <button onClick={() => setDocs((all) => all.filter((x) => x !== d))} className="text-slate-400 hover:text-accent-600"><X size={11} /></button>
                                </span>
                              ))
                            : 'Not attached'}
                        </p>
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

          {step === 'status' && (
            <Section title="Group status">
              <div className="grid gap-2 sm:grid-cols-4">
                {(['pending', 'active', 'suspended', 'closed'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => set('status', st)}
                    className={clsx(
                      'rounded-xl border px-3 py-2.5 text-sm font-medium capitalize',
                      form.status === st ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                    )}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <dl className="mt-6 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <Row k="Group name" v={form.name} />
                <Row k="Type" v={GROUP_TYPE_LABELS[form.groupType]} />
                <Row k="Branch" v={branches.find((b) => b.id === form.branchId)?.name} />
                <Row k="Officer" v={staff.find((s) => s.id === form.officerId)?.name} />
                <Row k="Location" v={[form.location, form.ward, form.district, form.region].filter(Boolean).join(', ')} />
                <Row k="Meetings" v={`${form.meetingFrequency}, ${form.meetingDay} ${form.meetingTime}`} />
                {!editing && <Row k="Members" v={String(allMemberIds.length)} />}
                {!editing && <Row k="Leaders" v={LEADER_ROLES.filter((r) => leaders[r.role]).map((r) => r.label).join(', ') || 'None yet'} />}
                <Row k="Loan limit" v={formatMoney(form.loanLimit, currency)} />
                {!editing && <Row k="Documents" v={String(docs.length)} />}
              </dl>
              {!canSave && (
                <p className="mt-5 rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-800">
                  {detailsOk ? 'Add at least one member before saving.' : 'Complete the group details first.'}
                </p>
              )}
              {error && <p className="mt-3 rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-800">{error}</p>}
            </Section>
          )}

          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
            <Button variant="ghost" onClick={() => (idx === 0 ? navigate(-1) : setStep(steps[idx - 1].id))}>
              {idx === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step === 'status' ? (
              <Button disabled={!canSave || busy} onClick={save}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Register group'}
              </Button>
            ) : (
              <Button onClick={() => setStep(steps[idx + 1].id)}>Continue</Button>
            )}
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
