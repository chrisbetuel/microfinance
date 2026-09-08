import { useState } from 'react'
import { useStore } from '../store/useStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader } from '../components/ui/Card'
import { Field, inputClass } from '../components/ui/Field'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { initials } from '../lib/format'
import { STAFF_ROLE_LABELS } from '../types'
import { toast } from '../lib/toast'

export default function Profile() {
  const currentUser = useStore((s) => s.currentUser)
  const branches = useStore((s) => s.branches)
  const updateProfile = useStore((s) => s.updateProfile)
  const changePassword = useStore((s) => s.changePassword)

  const [name, setName] = useState(currentUser?.name ?? '')
  const [phone, setPhone] = useState(currentUser?.phone ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  if (!currentUser) return null
  const branchName = branches.find((b) => b.id === currentUser.branchId)?.name ?? 'All branches'
  const dirty = name.trim() !== currentUser.name || phone.trim() !== currentUser.phone

  async function saveProfile() {
    setSavingProfile(true)
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim() })
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword() {
    if (next !== confirm) {
      toast.error('Passwords do not match')
      return
    }
    setSavingPw(true)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (e) {
      toast.error('Could not change password', e instanceof Error ? e.message : undefined)
    } finally {
      setSavingPw(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="My profile" subtitle="Your account details and password" />

      <div className="mb-6 flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white">
          {initials(currentUser.name)}
        </span>
        <div>
          <p className="text-lg font-bold text-slate-900">{currentUser.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge tone="violet">{STAFF_ROLE_LABELS[currentUser.role]}</Badge>
            <span>{branchName}</span>
            <span>·</span>
            <span>{currentUser.email}</span>
          </div>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader title="Personal details" subtitle="Your role, branch and approval limit are set by an administrator" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email" hint="Contact an administrator to change your sign-in email">
            <input disabled className={`${inputClass} bg-slate-50`} value={currentUser.email} />
          </Field>
          <Field label="Role">
            <input disabled className={`${inputClass} bg-slate-50`} value={STAFF_ROLE_LABELS[currentUser.role]} />
          </Field>
        </div>
        <div className="mt-4">
          <Button disabled={!dirty || savingProfile || !name.trim()} onClick={saveProfile}>
            {savingProfile ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Change password" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Current password">
            <input type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" hint="At least 6 characters">
            <input type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password">
            <input type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4">
          <Button
            variant="secondary"
            disabled={savingPw || !current || next.length < 6 || !confirm}
            onClick={savePassword}
          >
            {savingPw ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
