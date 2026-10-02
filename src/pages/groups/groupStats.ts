import type { Application, BorrowerGroup, Loan, Repayment } from '../../types'
import { daysLate } from '../../lib/selectors'

export const GROUP_TYPE_LABELS: Record<string, string> = {
  business: 'Business',
  women: 'Women',
  youth: 'Youth',
  agriculture: 'Agriculture',
  savings: 'Savings',
  general: 'General lending',
}

export type GroupLoanStatus = 'Pending' | 'Approved' | 'Declined' | 'Active' | 'Overdue' | 'Completed' | 'Defaulted'

export interface GroupLoanRow {
  key: string
  borrowerId: string
  reference: string
  purpose: string
  requested: number
  approved: number | null
  outstanding: number
  repaid: number
  overdue: number
  termInstalments: number
  productId: string
  status: GroupLoanStatus
}

/** Group loans = applications/loans tagged with the group. */
export function groupLoans(group: BorrowerGroup, applications: Application[], loans: Loan[], repayments: Repayment[]): GroupLoanRow[] {
  return applications
    .filter((a) => a.groupId === group.id)
    .map((a) => {
      const loan = loans.find((l) => l.applicationId === a.id)
      const repaid = loan ? repayments.filter((r) => r.loanId === loan.id && !r.reversed).reduce((s, r) => s + r.amount, 0) : 0
      let status: GroupLoanStatus
      if (!loan) status = a.status === 'approved' ? 'Approved' : a.status === 'declined' ? 'Declined' : 'Pending'
      else if (loan.status === 'closed') status = 'Completed'
      else if (loan.status === 'written_off') status = 'Defaulted'
      else status = daysLate(loan) > 0 ? 'Overdue' : 'Active'
      return {
        key: a.id,
        borrowerId: a.borrowerId,
        reference: a.reference,
        purpose: a.purpose,
        requested: a.requestedAmount || a.amount,
        approved: loan ? loan.principal : a.status === 'approved' ? a.amount : null,
        outstanding: loan && loan.status !== 'closed' ? loan.outstandingBalance : 0,
        repaid,
        overdue: loan && loan.status === 'active' ? loan.arrearsAmount || 0 : 0,
        termInstalments: a.termInstalments,
        productId: a.productId,
        status,
      }
    })
}

export function groupSummary(group: BorrowerGroup, applications: Application[], loans: Loan[], repayments: Repayment[]) {
  const rows = groupLoans(group, applications, loans, repayments)
  const groupLoanIds = new Set(loans.filter((l) => l.groupId === group.id).map((l) => l.id))
  const memberLoans = loans.filter((l) => groupLoanIds.has(l.id))

  let due = 0
  let paidOnDue = 0
  for (const l of memberLoans) {
    for (const i of l.schedule) {
      if (new Date(i.dueDate) > new Date()) continue
      due += i.totalDue
      paidOnDue += Math.min(i.paidAmount, i.totalDue)
    }
  }
  const activeMembers = group.memberships.filter((m) => m.status === 'active')
  const overdueMembers = new Set(memberLoans.filter((l) => l.status === 'active' && daysLate(l) > 0).map((l) => l.borrowerId))
  const attendanceRows = group.meetings.flatMap((m) => m.attendance)

  return {
    rows,
    activeMembers: activeMembers.length,
    outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
    repaid: rows.reduce((s, r) => s + r.repaid, 0),
    overdue: rows.reduce((s, r) => s + r.overdue, 0),
    activeLoans: rows.filter((r) => r.status === 'Active' || r.status === 'Overdue').length,
    overdueMembers: overdueMembers.size,
    repaymentRate: due > 0 ? (paidOnDue / due) * 100 : null,
    attendanceRate: attendanceRows.length ? (attendanceRows.filter((a) => a.present).length / attendanceRows.length) * 100 : null,
    savings: group.savingsTotal,
    contributions: group.contributionsTotal,
    limitUsed: group.loanLimit > 0 ? (rows.reduce((s, r) => s + r.outstanding, 0) / group.loanLimit) * 100 : null,
  }
}
