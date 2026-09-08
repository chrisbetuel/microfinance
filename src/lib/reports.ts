import type { Branch, Borrower, Loan, LoanProduct, Repayment, Staff } from '../types'
import { daysLate, isSameMonth } from './selectors'

export interface MonthPoint {
  key: string
  month: string
  disbursed: number
  collected: number
}

export function monthlyCashflow(loans: Loan[], repayments: Repayment[], months = 12): MonthPoint[] {
  const now = new Date()
  const points: MonthPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    points.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      month: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      disbursed: 0,
      collected: 0,
    })
  }
  const byKey = new Map(points.map((p) => [p.key, p]))
  for (const l of loans) {
    if (!l.disbursement) continue
    const d = new Date(l.disbursement.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const pt = byKey.get(key)
    if (pt) pt.disbursed += l.netDisbursed
  }
  for (const r of repayments) {
    if (r.reversed) continue
    const d = new Date(r.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const pt = byKey.get(key)
    if (pt) pt.collected += r.amount
  }
  return points
}

export const CHANNEL_LABELS: Record<string, string> = {
  mobile_money: 'Mobile money',
  bank: 'Bank transfer',
  cash: 'Cash',
  field: 'Field collection',
}

export interface ChannelTotal {
  channel: string
  amount: number
  count: number
}

export function collectionsByChannel(repayments: Repayment[]): ChannelTotal[] {
  const map: Record<string, ChannelTotal> = {}
  for (const r of repayments) {
    if (r.reversed) continue
    const label = CHANNEL_LABELS[r.channel] ?? r.channel
    const cur = map[label] ?? { channel: label, amount: 0, count: 0 }
    cur.amount += r.amount
    cur.count += 1
    map[label] = cur
  }
  return Object.values(map).sort((a, b) => b.amount - a.amount)
}

export interface OfficerPerformance {
  officer: Staff
  borrowers: number
  activeLoans: number
  outstanding: number
  collected: number
  collectedThisMonth: number
  arrearsLoans: number
  par: number
}

export function officerPerformance(
  staff: Staff[],
  borrowers: Borrower[],
  loans: Loan[],
  repayments: Repayment[],
): OfficerPerformance[] {
  const officers = staff.filter((s) => s.role === 'loan_officer')
  const activeLoansByOfficer = new Map<string, Loan[]>()
  const borrowerIdsByOfficer = new Map<string, Set<string>>()
  const loanIdToOfficer = new Map<string, string>()

  for (const b of borrowers) {
    const officerBorrowers = borrowerIdsByOfficer.get(b.officerId) ?? new Set<string>()
    const officerLoans: Loan[] = []
    for (const loan of loans) {
      if (loan.borrowerId !== b.id) continue
      loanIdToOfficer.set(loan.id, b.officerId)
      if (loan.status === 'active') {
        officerLoans.push(loan)
        officerBorrowers.add(b.id)
      }
    }
    if (officerLoans.length > 0) {
      const arr = activeLoansByOfficer.get(b.officerId) ?? []
      arr.push(...officerLoans)
      activeLoansByOfficer.set(b.officerId, arr)
    }
    borrowerIdsByOfficer.set(b.officerId, officerBorrowers)
  }

  return officers.map((officer) => {
    const activeLoans = activeLoansByOfficer.get(officer.id) ?? []
    const outstanding = activeLoans.reduce((s, l) => s + l.outstandingBalance, 0)
    const arrearsLoans = activeLoans.filter((l) => daysLate(l) > 0)
    const atRiskAmount = arrearsLoans.reduce((s, l) => s + l.outstandingBalance, 0)
    const officerRepayments = repayments.filter((r) => !r.reversed && loanIdToOfficer.get(r.loanId) === officer.id)
    const collected = officerRepayments.reduce((s, r) => s + r.amount, 0)
    const collectedThisMonth = officerRepayments.filter((r) => isSameMonth(r.date)).reduce((s, r) => s + r.amount, 0)
    return {
      officer,
      borrowers: borrowerIdsByOfficer.get(officer.id)?.size ?? 0,
      activeLoans: activeLoans.length,
      outstanding,
      collected,
      collectedThisMonth,
      arrearsLoans: arrearsLoans.length,
      par: outstanding > 0 ? (atRiskAmount / outstanding) * 100 : 0,
    }
  })
}

export interface BranchPerformance {
  branch: Branch
  borrowers: number
  activeLoans: number
  outstanding: number
  atRiskAmount: number
  par: number
  collected: number
  collectedThisMonth: number
}

export function branchPerformance(
  branches: Branch[],
  borrowers: Borrower[],
  loans: Loan[],
  repayments: Repayment[],
): BranchPerformance[] {
  const loanIdToBranch = new Map<string, string>()
  const borrowersByBranch = new Map<string, number>()
  for (const b of borrowers) {
    borrowersByBranch.set(b.branchId, (borrowersByBranch.get(b.branchId) ?? 0) + 1)
  }
  for (const l of loans) {
    loanIdToBranch.set(l.id, l.branchId)
  }
  return branches.map((branch) => {
    const branchLoans = loans.filter((l) => l.branchId === branch.id)
    const activeLoans = branchLoans.filter((l) => l.status === 'active')
    const outstanding = activeLoans.reduce((s, l) => s + l.outstandingBalance, 0)
    const atRiskAmount = activeLoans.filter((l) => daysLate(l) > 0).reduce((s, l) => s + l.outstandingBalance, 0)
    const branchRepayments = repayments.filter((r) => !r.reversed && loanIdToBranch.get(r.loanId) === branch.id)
    const collected = branchRepayments.reduce((s, r) => s + r.amount, 0)
    const collectedThisMonth = branchRepayments.filter((r) => isSameMonth(r.date)).reduce((s, r) => s + r.amount, 0)
    return {
      branch,
      borrowers: borrowersByBranch.get(branch.id) ?? 0,
      activeLoans: activeLoans.length,
      outstanding,
      atRiskAmount,
      par: outstanding > 0 ? (atRiskAmount / outstanding) * 100 : 0,
      collected,
      collectedThisMonth,
    }
  })
}

export interface ProductComposition {
  product: LoanProduct
  activeLoans: number
  outstanding: number
  countShare: number
  amountShare: number
}

export function productComposition(products: LoanProduct[], loans: Loan[]): ProductComposition[] {
  const active = loans.filter((l) => l.status === 'active')
  const total = active.reduce((s, l) => s + l.outstandingBalance, 0)
  return products.map((p) => {
    const productLoans = active.filter((l) => l.productId === p.id)
    const outstanding = productLoans.reduce((s, l) => s + l.outstandingBalance, 0)
    return {
      product: p,
      activeLoans: productLoans.length,
      outstanding,
      countShare: active.length > 0 ? (productLoans.length / active.length) * 100 : 0,
      amountShare: total > 0 ? (outstanding / total) * 100 : 0,
    }
  })
}

export interface AtRiskLoan {
  loan: Loan
  daysLate: number
  arrearsAmount: number
  borrowerName: string
  branchName: string
  productName: string
}

export function atRiskLoans(loans: Loan[], borrowers: Borrower[], branches: Branch[], products: LoanProduct[]): AtRiskLoan[] {
  const borrowerName = new Map(borrowers.map((b) => [b.id, b.fullName]))
  const branchName = new Map(branches.map((b) => [b.id, b.name]))
  const productName = new Map(products.map((p) => [p.id, p.name]))
  return loans
    .filter((l) => l.status === 'active' && daysLate(l) > 0)
    .map((loan) => ({
      loan,
      daysLate: daysLate(loan),
      arrearsAmount: loan.arrearsAmount,
      borrowerName: borrowerName.get(loan.borrowerId) ?? '—',
      branchName: branchName.get(loan.branchId) ?? '—',
      productName: productName.get(loan.productId) ?? '—',
    }))
    .sort((a, b) => b.daysLate - a.daysLate)
}

export function portfolioKpis(
  loans: Loan[],
  repayments: Repayment[],
): {
  outstanding: number
  disbursedThisMonth: number
  collectedThisMonth: number
  atRiskAmount: number
  par: number
  activeLoans: number
  closedLoans: number
  writtenOffLoans: number
} {
  const active = loans.filter((l) => l.status === 'active')
  const outstanding = active.reduce((s, l) => s + l.outstandingBalance, 0)
  const atRisk = active.filter((l) => daysLate(l) > 0)
  const atRiskAmount = atRisk.reduce((s, l) => s + l.outstandingBalance, 0)
  const disbursedThisMonth = loans
    .filter((l) => l.disbursement && isSameMonth(l.disbursement.date))
    .reduce((s, l) => s + l.netDisbursed, 0)
  const collectedThisMonth = repayments.filter((r) => !r.reversed && isSameMonth(r.date)).reduce((s, r) => s + r.amount, 0)
  return {
    outstanding,
    disbursedThisMonth,
    collectedThisMonth,
    atRiskAmount,
    par: outstanding > 0 ? (atRiskAmount / outstanding) * 100 : 0,
    activeLoans: active.length,
    closedLoans: loans.filter((l) => l.status === 'closed').length,
    writtenOffLoans: loans.filter((l) => l.status === 'written_off').length,
  }
}