import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { api } from '../../lib/api'
import { toast } from '../../lib/toast'
import { formatDateTime } from '../../lib/format'
import { whatsappNumber } from '../../lib/statementPdf'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Field, inputClass } from '../../components/ui/Field'
import type { BorrowerGroup } from '../../types'

interface PortalAccount {
  username: string
  active: boolean
  createdBy: string
  createdAt: string
  lastLoginAt: string | null
}

/** Staff create the group's read-only portal login here and share the link. */
export function GroupPortalCard({ group, canEdit, chairPhone }: { group: BorrowerGroup; canEdit: boolean; chairPhone?: string }) {
  const [account, setAccount] = useState<PortalAccount | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState(group.groupNumber.toLowerCase())
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const link = `${window.location.origin}/portal`

  useEffect(() => {
    api.get<{ account: PortalAccount | null }>(`/groups/${group.id}/portal-account`).then((r) => setAccount(r.account)).catch(() => setAccount(null))
  }, [group.id])

  async function save() {
    setBusy(true)
    try {
      const saved = await api.post<PortalAccount>(`/groups/${group.id}/portal-account`, { username, password })
      setAccount(saved)
      setEditing(false)
      toast.success(account ? 'Portal password reset' : 'Group portal login created', `Username: ${saved.username}`)
    } catch (e) {
      toast.error('Could not save the login', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function toggle() {
    if (!account) return
    const saved = await api.patch<PortalAccount>(`/groups/${group.id}/portal-account`, { active: !account.active })
    setAccount(saved)
    toast.success(saved.active ? 'Portal login switched on' : 'Portal login switched off')
  }

  if (account === undefined) return null
  return (
    <Card className="p-5">
      <CardHeader
        title="Group portal"
        subtitle="A read-only login so the group can follow its loans, payments and meetings"
        action={account ? <Badge tone={account.active ? 'green' : 'slate'} dot>{account.active ? 'Active' : 'Off'}</Badge> : undefined}
      />
      {account && !editing && (
        <dl className="mb-3 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Sign-in page</dt><dd className="font-medium text-brand-700">{link}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Username</dt><dd className="font-mono font-medium">{account.username}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Last sign-in</dt><dd>{account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'Never'}</dd></div>
        </dl>
      )}
      {!account && !editing && <p className="mb-3 text-sm text-slate-500">No portal login yet.</p>}
      {editing && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Field label="Username">
            <input className={inputClass} value={username} disabled={!!account} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
          </Field>
          <Field label={account ? 'New password' : 'Password'} hint="At least 6 characters. Give it to the group leaders in person.">
            <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" disabled={busy || password.length < 6 || username.length < 3} onClick={save}>{account ? 'Reset password' : 'Create login'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" icon={<KeyRound size={13} />} onClick={() => { setPassword(''); setEditing(true) }}>{account ? 'Reset password' : 'Create portal login'}</Button>
              {account && <Button size="sm" variant="secondary" onClick={toggle}>{account.active ? 'Switch off' : 'Switch on'}</Button>}
              {account && chairPhone && (
                <a
                  className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://wa.me/${whatsappNumber(chairPhone)}?text=${encodeURIComponent(`${group.name}: follow your group's loans and payments at ${link} — username ${account.username}. Your loan officer will give you the password.`)}`}
                >
                  Send link to chairperson on WhatsApp
                </a>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}
