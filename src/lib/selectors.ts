import type { Loan, Repayment } from '../types'
import { classifyArrearsBand } from './loanMath'

export function isSameMonth(iso: string, ref: Date = new Date()): boolean {
  const d = new Date(iso)
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
}

// The daily `age_loans` job maintains loan.daysInArrears; fall back to a
// client-side estimate for a loan that hasn't been aged yet.
export function daysLate(loan: Loan, ref: Date = new Date()): number {
  if (loan.daysInArrears > 0) return loan.daysInArrears
  const firstUnpaidOverdue = loan.schedule.find((i) => i.status !== 'paid' && new Date(i.dueDate) < ref)
  if (!firstUnpaidOverdue) return 0
  return Math.floor((ref.getTime() - new Date(firstUnpaidOverdue.dueDate).getTime()) / 86400000)
}

export function portfolioOutstanding(loans: Loan[]): number {
  return loans.filter((l) => l.status === 'active').reduce((sum, l) => sum + l.outstandingBalance, 0)
}

export function disbursedThisMonth(loans: Loan[]): number {
  return loans
    .filter((l) => l.disbursement && isSameMonth(l.disbursement.date))
    .reduce((sum, l) => sum + l.netDisbursed, 0)
}

export function collectedThisMonth(repayments: Repayment[]): number {
  return repayments.filter((r) => !r.reversed && isSameMonth(r.date)).reduce((sum, r) => sum + r.amount, 0)
}

export function portfolioAtRisk(loans: Loan[]): { par: number; atRiskAmount: number } {
  const active = loans.filter((l) => l.status === 'active')
  const total = active.reduce((sum, l) => sum + l.outstandingBalance, 0)
  const atRisk = active.filter((l) => daysLate(l) > 0).reduce((sum, l) => sum + l.outstandingBalance, 0)
  return { par: total > 0 ? (atRisk / total) * 100 : 0, atRiskAmount: atRisk }
}

export function arrearsAgingBuckets(loans: Loan[]): Record<string, { count: number; amount: number }> {
  const buckets: Record<string, { count: number; amount: number }> = {
    current: { count: 0, amount: 0 },
    '1-7': { count: 0, amount: 0 },
    '8-30': { count: 0, amount: 0 },
    '31-60': { count: 0, amount: 0 },
    '61-90': { count: 0, amount: 0 },
    over90: { count: 0, amount: 0 },
  }
  for (const loan of loans.filter((l) => l.status === 'active')) {
    const band = classifyArrearsBand(daysLate(loan))
    buckets[band].count += 1
    buckets[band].amount += loan.outstandingBalance
  }
  return buckets
}

/** Share of everything that has fallen due so far that has actually been paid. */
export function collectionRate(loans: Loan[], ref: Date = new Date()): number | null {
  let due = 0
  let paid = 0
  for (const l of loans) {
    if (l.status === 'pending_disbursement') continue
    for (const i of l.schedule) {
      if (new Date(i.dueDate) > ref) continue
      due += i.totalDue
      paid += Math.min(i.paidAmount, i.totalDue)
    }
  }
  return due > 0 ? (paid / due) * 100 : null
}

export function portfolioSummary(loans: Loan[], repayments: Repayment[]) {
  const active = loans.filter((l) => l.status === 'active')
  const overdue = active.filter((l) => daysLate(l) > 0)
  return {
    activeLoans: active.length,
    overdueLoans: overdue.length,
    overdueAmount: overdue.reduce((s, l) => s + (l.arrearsAmount || 0), 0),
    defaulted: loans.filter((l) => l.status === 'written_off').length,
    completed: loans.filter((l) => l.status === 'closed').length,
    totalDisbursed: loans.filter((l) => l.disbursement).reduce((s, l) => s + l.principal, 0),
    totalCollected: repayments.filter((r) => !r.reversed).reduce((s, r) => s + r.amount, 0),
  }
}
