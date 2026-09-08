import type { Application, Lender, Loan, Notification, StaffRole } from '../types'
import { isSupervisor } from './permissions'
import { daysLate } from './selectors'

export interface Alert {
  key: string
  tone: 'red' | 'amber' | 'brand'
  title: string
  detail: string
  href: string
}

const DAY = 86_400_000

export function buildAlerts(params: {
  role: StaffRole
  branchId: string | null
  lender: Lender
  applications: Application[]
  loans: Loan[]
  notifications: Notification[]
}): Alert[] {
  const { role, lender, applications, loans, notifications } = params
  const alerts: Alert[] = []

  const failed = notifications.filter((n) => n.status === 'failed')
  for (const n of failed.slice(0, 6)) {
    alerts.push({
      key: `notif:${n.id}`,
      tone: 'red',
      title: 'Message delivery failed',
      detail: `${n.kind.replace(/_/g, ' ')} to ${n.to}${n.error ? ` — ${n.error}` : ''}`,
      href: '/security',
    })
  }

  if (isSupervisor(role) || role === 'credit_committee' || role === 'lender_admin' || role === 'platform_admin') {
    const waiting = applications.filter((a) => a.status === 'submitted' || a.status === 'pending_approval')
    if (waiting.length > 0) {
      alerts.push({
        key: `approvals:${waiting.length}`,
        tone: 'amber',
        title: `${waiting.length} application${waiting.length > 1 ? 's' : ''} awaiting approval`,
        detail: 'Review and record a decision',
        href: '/applications',
      })
    }
  }

  if (role === 'cashier' || role === 'lender_admin' || role === 'platform_admin' || role === 'branch_manager') {
    const toDisburse = applications.filter((a) => a.status === 'approved')
    if (toDisburse.length > 0) {
      alerts.push({
        key: `disburse:${toDisburse.length}`,
        tone: 'brand',
        title: `${toDisburse.length} loan${toDisburse.length > 1 ? 's' : ''} approved, awaiting disbursement`,
        detail: 'Release funds from the disbursement queue',
        href: '/disbursement',
      })
    }
  }

  const overdue = loans.filter((l) => l.status === 'active' && daysLate(l) > 0)
  if (overdue.length > 0 && role !== 'auditor') {
    alerts.push({
      key: `overdue:${overdue.length}`,
      tone: 'red',
      title: `${overdue.length} loan${overdue.length > 1 ? 's' : ''} in arrears`,
      detail: 'Review the at-risk register',
      href: '/reports',
    })
  }

  if (role === 'lender_admin' || role === 'platform_admin') {
    if (lender.smsBalance < 10) {
      alerts.push({
        key: `sms:${lender.smsBalance}`,
        tone: 'amber',
        title: 'SMS balance is low',
        detail: `${lender.smsBalance} credits left — top up to keep borrower messages flowing`,
        href: '/lender-setup',
      })
    }
    if (lender.licenceExpiry) {
      const days = Math.floor((new Date(lender.licenceExpiry).getTime() - Date.now()) / DAY)
      if (days <= 30) {
        alerts.push({
          key: `licence:${lender.licenceExpiry}`,
          tone: days < 0 ? 'red' : 'amber',
          title: days < 0 ? 'Operating licence has expired' : `Operating licence expires in ${days} day${days === 1 ? '' : 's'}`,
          detail: 'Update the licence details under Lender Setup',
          href: '/lender-setup',
        })
      }
    }
  }

  return alerts
}

const SEEN_KEY = 'lms-alerts-seen'

export function getSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function markSeen(keys: string[]): void {
  try {
    const merged = new Set([...getSeen(), ...keys])
    // keep the list bounded
    localStorage.setItem(SEEN_KEY, JSON.stringify([...merged].slice(-200)))
  } catch {
    /* storage unavailable — non-fatal */
  }
}
