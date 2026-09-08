import type { Borrower, Branch, CollectionActivity, Loan, Staff } from '../types'
import { daysLate } from './selectors'

export interface ArrearsRow {
  loan: Loan
  borrower: Borrower | undefined
  branchName: string
  officerName: string
  days: number
  arrears: number
  outstanding: number
  lastActivity: CollectionActivity | undefined
  openPromise: CollectionActivity | undefined
  brokenPromises: number
}

export function buildArrearsBook(
  loans: Loan[],
  borrowers: Borrower[],
  branches: Branch[],
  staff: Staff[],
  activities: CollectionActivity[],
): ArrearsRow[] {
  const byLoan = new Map<string, CollectionActivity[]>()
  for (const a of activities) {
    const list = byLoan.get(a.loanId) ?? []
    list.push(a)
    byLoan.set(a.loanId, list)
  }

  return loans
    .filter((l) => l.status === 'active' && daysLate(l) > 0)
    .map((loan) => {
      const borrower = borrowers.find((b) => b.id === loan.borrowerId)
      const loanActivities = (byLoan.get(loan.id) ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const promises = loanActivities.filter((a) => a.kind === 'promise')
      return {
        loan,
        borrower,
        branchName: branches.find((b) => b.id === loan.branchId)?.name ?? '—',
        officerName: staff.find((s) => s.id === borrower?.officerId)?.name ?? '—',
        days: daysLate(loan),
        arrears: loan.arrearsAmount || 0,
        outstanding: loan.outstandingBalance,
        lastActivity: loanActivities[0],
        openPromise: promises.find((p) => p.promiseStatus === 'pending'),
        brokenPromises: promises.filter((p) => p.promiseStatus === 'broken').length,
      }
    })
    .sort((a, b) => b.days - a.days || b.arrears - a.arrears)
}
