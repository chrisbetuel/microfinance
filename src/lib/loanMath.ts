import type { LoanProduct, ScheduleInstalment } from '../types'

function addPeriod(date: Date, frequency: LoanProduct['repaymentFrequency']): Date {
  const d = new Date(date)
  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + 1)
      return d
    case 'weekly':
      d.setDate(d.getDate() + 7)
      return d
    case 'fortnightly':
      d.setDate(d.getDate() + 14)
      return d
    case 'monthly':
      d.setMonth(d.getMonth() + 1)
      return d
  }
}

// Converts the product's per-period interest rate into a rate that applies once per instalment,
// based on how often interest is quoted (daily/weekly/monthly) vs how often instalments fall due.
function ratePerInstalment(product: LoanProduct): number {
  const periodDays: Record<LoanProduct['interestPeriod'], number> = {
    daily: 1,
    weekly: 7,
    monthly: 30,
  }
  const freqDays: Record<LoanProduct['repaymentFrequency'], number> = {
    daily: 1,
    weekly: 7,
    fortnightly: 14,
    monthly: 30,
  }
  const dailyRate = product.interestRate / 100 / periodDays[product.interestPeriod]
  return dailyRate * freqDays[product.repaymentFrequency]
}

export function totalFeeAmount(product: LoanProduct, principal: number, timing?: 'deducted' | 'added'): number {
  return product.fees
    .filter((f) => (timing ? f.timing === timing : true))
    .reduce((sum, f) => sum + (f.kind === 'percent' ? (principal * f.value) / 100 : f.value), 0)
}

export function generateSchedule(
  product: LoanProduct,
  principal: number,
  termInstalments: number,
  startDate: Date = new Date(),
): ScheduleInstalment[] {
  const rate = ratePerInstalment(product)
  const addedFees = totalFeeAmount(product, principal, 'added')
  const graceOnPrincipal = product.gracePeriodDays > 0 && (product.gracePeriodAppliesTo === 'principal' || product.gracePeriodAppliesTo === 'both')
  const graceOnInterest = product.gracePeriodDays > 0 && (product.gracePeriodAppliesTo === 'interest' || product.gracePeriodAppliesTo === 'both')

  const principalPeriods = graceOnPrincipal ? termInstalments - 1 : termInstalments
  const basePrincipalPortion = principal / Math.max(principalPeriods, 1)

  const schedule: ScheduleInstalment[] = []
  let balance = principal
  let dueDate = new Date(startDate)

  for (let period = 1; period <= termInstalments; period++) {
    dueDate = addPeriod(dueDate, product.repaymentFrequency)
    const isGracePeriod = period === 1 && product.gracePeriodDays > 0

    let interestDue = 0
    if (product.interestMethod === 'reducing') {
      interestDue = isGracePeriod && graceOnInterest ? 0 : balance * rate
    } else {
      const flatInterestPerPeriod = (principal * (product.interestRate / 100)) // per the quoted period, applied evenly
      interestDue = isGracePeriod && graceOnInterest ? 0 : flatInterestPerPeriod
    }

    const principalDue = isGracePeriod && graceOnPrincipal ? 0 : basePrincipalPortion
    const feesDue = period === 1 ? addedFees : 0

    balance = Math.max(balance - principalDue, 0)

    schedule.push({
      period,
      dueDate: dueDate.toISOString(),
      principalDue: round2(principalDue),
      interestDue: round2(interestDue),
      feesDue: round2(feesDue),
      penaltyDue: 0,
      totalDue: round2(principalDue + interestDue + feesDue),
      paidAmount: 0,
      balanceAfter: round2(balance),
      status: 'upcoming',
    })
  }

  return schedule
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calculatePenalty(product: LoanProduct, overdueAmount: number, daysLate: number): number {
  if (daysLate <= 0) return 0
  const raw =
    product.penaltyKind === 'fixed' ? product.penaltyValue * daysLate : overdueAmount * (product.penaltyValue / 100) * daysLate
  return round2(Math.min(raw, product.penaltyCap))
}

export function classifyArrearsBand(daysLate: number): string {
  if (daysLate <= 0) return 'current'
  if (daysLate <= 7) return '1-7'
  if (daysLate <= 30) return '8-30'
  if (daysLate <= 60) return '31-60'
  if (daysLate <= 90) return '61-90'
  return 'over90'
}

export interface AllocationResult {
  schedule: ScheduleInstalment[]
  allocation: { penalty: number; fees: number; interest: number; principal: number }
  remainder: number
}

export function allocatePayment(
  product: LoanProduct,
  schedule: ScheduleInstalment[],
  amount: number,
): AllocationResult {
  const next = schedule.map((s) => ({ ...s }))
  const allocation = { penalty: 0, fees: 0, interest: 0, principal: 0 }
  let remaining = round2(amount)

  for (const inst of next) {
    if (remaining <= 0) break
    const instRemaining = round2(inst.totalDue - inst.paidAmount)
    if (instRemaining <= 0) continue

    const payForInst = round2(Math.min(instRemaining, remaining))
    const bucketDue: Record<'penalty' | 'fee' | 'interest' | 'principal', number> = {
      penalty: inst.penaltyDue,
      fee: inst.feesDue,
      interest: inst.interestDue,
      principal: inst.principalDue,
    }

    // Work out how much of each bucket earlier partial payments on this instalment already covered.
    let alreadyPaid = inst.paidAmount
    const bucketPaidSoFar: Record<string, number> = { penalty: 0, fee: 0, interest: 0, principal: 0 }
    for (const bucket of product.allocationOrder) {
      const take = Math.min(bucketDue[bucket], alreadyPaid)
      bucketPaidSoFar[bucket] = take
      alreadyPaid = round2(alreadyPaid - take)
    }

    let toApply = payForInst
    for (const bucket of product.allocationOrder) {
      if (toApply <= 0) break
      const capacity = round2(bucketDue[bucket] - bucketPaidSoFar[bucket])
      const take = Math.min(capacity, toApply)
      if (take <= 0) continue
      toApply = round2(toApply - take)
      if (bucket === 'fee') allocation.fees += take
      else if (bucket === 'penalty') allocation.penalty += take
      else if (bucket === 'interest') allocation.interest += take
      else allocation.principal += take
    }

    inst.paidAmount = round2(inst.paidAmount + payForInst)
    inst.status = inst.paidAmount >= inst.totalDue - 0.01 ? 'paid' : 'partial'
    remaining = round2(remaining - payForInst)
  }

  return { schedule: next, allocation, remainder: round2(remaining) }
}
