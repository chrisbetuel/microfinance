/**
 * Report builders. Every figure is computed from transaction records — loans,
 * disbursements, repayments (incl. reversals), collection activity, ledger
 * journals and the audit log — never from typed-in totals, so any number can
 * be traced back to the rows that make it up.
 */
import type {
  Application,
  AuditLogEntry,
  Borrower,
  BorrowerGroup,
  Branch,
  CollectionActivity,
  CollectionCase,
  Disbursement,
  LedgerData,
  Loan,
  LoanProduct,
  Repayment,
  Staff,
} from '../../types'
import { groupSummary } from '../groups/groupStats'

export interface Filters {
  from: string
  to: string
  branchId: string
  productId: string
  officerId: string
  borrowerType: '' | 'individual' | 'group'
  loanStatus: '' | LoanState
  paymentMethod: string
  action: string
}

export type FilterKey = Exclude<keyof Filters, 'to'>

export interface ReportData {
  loans: Loan[]
  applications: Application[]
  repayments: Repayment[]
  disbursements: Disbursement[]
  borrowers: Borrower[]
  groups: BorrowerGroup[]
  products: LoanProduct[]
  branches: Branch[]
  staff: Staff[]
  cases: CollectionCase[]
  activities: CollectionActivity[]
  audit: AuditLogEntry[]
  ledger: LedgerData | null
}

export interface Column {
  header: string
  value: (row: never) => string | number
  money?: boolean
  link?: (row: never) => string | null
}

export interface BuiltReport {
  tiles: [string, string | number, ('good' | 'bad')?][]
  columns: Column[]
  rows: unknown[]
  /** extra summary blocks (comparisons, breakdowns) rendered above the table */
  blocks?: { title: string; rows: [string, ...(string | number)[]][]; headers?: string[] }[]
  note?: string
}

export interface ReportDef {
  id: string
  label: string
  description: string
  filters: FilterKey[]
  build: (d: ReportData, f: Filters, money: (n: number) => string) => BuiltReport
}

export type LoanState = 'current' | 'overdue' | 'restructured' | 'defaulted' | 'completed' | 'reversed'

export const LOAN_STATE_LABEL: Record<LoanState, string> = {
  current: 'Current',
  overdue: 'Overdue',
  restructured: 'Restructured',
  defaulted: 'Defaulted',
  completed: 'Completed',
  reversed: 'Reversed',
}

/** Local "YYYY-MM-DD HH:mm" for a stored UTC timestamp. */
const localStamp = (ts: string) => {
  const t = new Date(ts)
  return `${t.toLocaleDateString('en-CA')} ${t.toTimeString().slice(0, 5)}`
}
const r2 = (n: number) => Math.round(n * 100) / 100
const sum = <T,>(xs: T[], f: (x: T) => number) => r2(xs.reduce((s, x) => s + (f(x) || 0), 0))
const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10)
const inRange = (iso: string | null | undefined, f: Filters) => {
  const d = day(iso)
  return !!d && (!f.from || d >= f.from) && (!f.to || d <= f.to)
}

export function loanState(l: Loan): LoanState {
  if (l.status === 'reversed') return 'reversed'
  if (l.status === 'closed') return 'completed'
  if (l.status === 'written_off') return 'defaulted'
  if (l.daysInArrears > 0) return 'overdue'
  if (l.restructureCount > 0) return 'restructured'
  return 'current'
}

function ctx(d: ReportData) {
  const app = new Map(d.applications.map((a) => [a.id, a]))
  const borrower = new Map(d.borrowers.map((b) => [b.id, b]))
  const product = new Map(d.products.map((p) => [p.id, p]))
  const branch = new Map(d.branches.map((b) => [b.id, b]))
  const staff = new Map(d.staff.map((s) => [s.id, s]))
  const group = new Map(d.groups.map((g) => [g.id, g]))
  const live = d.repayments.filter((r) => !r.reversed)
  const paidByLoan = new Map<string, Repayment[]>()
  for (const r of live) paidByLoan.set(r.loanId, [...(paidByLoan.get(r.loanId) ?? []), r])
  const officerOf = (l: Loan) => app.get(l.applicationId)?.loanOfficerId ?? borrower.get(l.borrowerId)?.officerId ?? null
  const caseOf = new Map(d.cases.filter((c) => c.status !== 'resolved' && c.status !== 'paid').map((c) => [c.loanId, c]))
  return {
    app, borrower, product, branch, staff, group, paidByLoan, officerOf, caseOf,
    name: (l: Loan) => borrower.get(l.borrowerId)?.fullName ?? '—',
    who: (l: Loan) => `${borrower.get(l.borrowerId)?.fullName ?? '—'}${l.groupId ? ` (${group.get(l.groupId)?.name ?? 'group'})` : ''}`,
    staffName: (id: string | null | undefined) => (id ? staff.get(id)?.name ?? '—' : '—'),
  }
}

/** The loans the filters select (date range applies to the disbursement date when `byDate`). */
function filterLoans(d: ReportData, f: Filters, c: ReturnType<typeof ctx>, byDate: boolean) {
  return d.loans.filter(
    (l) =>
      (!byDate || inRange(l.disbursement?.date ?? l.createdAt, f)) &&
      (!f.branchId || l.branchId === f.branchId) &&
      (!f.productId || l.productId === f.productId) &&
      (!f.officerId || c.officerOf(l) === f.officerId) &&
      (!f.borrowerType || (f.borrowerType === 'group' ? !!l.groupId : !l.groupId)) &&
      (!f.loanStatus || loanState(l) === f.loanStatus),
  )
}

const paid = (c: ReturnType<typeof ctx>, l: Loan) => sum(c.paidByLoan.get(l.id) ?? [], (r) => r.amount)
const outstanding = (l: Loan) => (l.status === 'active' ? l.outstandingBalance : 0)
const overdueAmt = (l: Loan) => (l.status === 'active' && l.daysInArrears > 0 ? l.arrearsAmount : 0)
const interestOf = (l: Loan) => sum(l.schedule, (i) => i.interestDue)
const payable = (l: Loan) => sum(l.schedule, (i) => i.totalDue)

export const BUCKETS: [string, number, number][] = [
  ['1–7 days', 1, 7], ['8–30 days', 8, 30], ['31–60 days', 31, 60], ['61–90 days', 61, 90], ['90+ days', 91, Infinity],
]

const ALL_LOAN_FILTERS: FilterKey[] = ['from', 'branchId', 'productId', 'officerId', 'borrowerType', 'loanStatus']

export const REPORTS: ReportDef[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Headline figures for the whole portfolio. Disbursed and repaid follow the date range.',
    filters: ['from', 'branchId', 'productId', 'officerId', 'borrowerType'],
    build: (d, f, money) => {
      const c = ctx(d)
      const loans = filterLoans(d, { ...f, from: '', to: '' }, c, false)
      const active = loans.filter((l) => l.status === 'active')
      const ids = new Set(loans.map((l) => l.id))
      const disb = d.disbursements.filter((x) => x.status === 'successful' && x.loanId && ids.has(x.loanId) && inRange(x.confirmedAt, f))
      const rep = d.repayments.filter((r) => !r.reversed && ids.has(r.loanId) && inRange(r.paymentDate, f))
      const overdue = active.filter((l) => l.daysInArrears > 0)
      const rows: [string, string | number][] = [
        ['Total borrowers', d.borrowers.length],
        ['Active borrowers', new Set(active.map((l) => l.borrowerId)).size],
        ['Total groups', d.groups.length],
        ['Active loans', active.length],
        ['Total amount disbursed', money(sum(disb, (x) => x.netAmount))],
        ['Total amount repaid', money(sum(rep, (r) => r.amount))],
        ['Outstanding balance', money(sum(active, (l) => l.outstandingBalance))],
        ['Overdue amount', money(sum(overdue, (l) => l.arrearsAmount))],
        ['Overdue loans', overdue.length],
        ['Completed loans', loans.filter((l) => l.status === 'closed').length],
      ]
      return {
        tiles: rows.map(([k, v]) => [k, v, k.startsWith('Overdue') && v !== 0 && v !== money(0) ? 'bad' : undefined]),
        columns: [{ header: 'Measure', value: (r: [string, string]) => r[0] }, { header: 'Value', value: (r: [string, string]) => r[1] }] as Column[],
        rows,
      }
    },
  },
  {
    id: 'loans',
    label: 'Loans',
    description: 'Every loan disbursed in the period.',
    filters: ALL_LOAN_FILTERS,
    build: (d, f, money) => {
      const c = ctx(d)
      const loans = filterLoans(d, f, c, true)
      return {
        tiles: [
          ['Loans', loans.length],
          ['Approved', money(sum(loans, (l) => l.principal))],
          ['Disbursed (net)', money(sum(loans, (l) => l.netDisbursed))],
          ['Total payable', money(sum(loans, payable))],
          ['Paid', money(sum(loans, (l) => paid(c, l))), 'good'],
          ['Outstanding', money(sum(loans, outstanding))],
        ],
        columns: [
          { header: 'Loan number', value: (l: Loan) => l.loanNumber, link: (l: Loan) => `/loans/${l.id}` },
          { header: 'Borrower / group', value: (l: Loan) => c.who(l) },
          { header: 'Product', value: (l: Loan) => c.product.get(l.productId)?.name ?? '—' },
          { header: 'Approved', value: (l: Loan) => l.principal, money: true },
          { header: 'Disbursed', value: (l: Loan) => l.netDisbursed, money: true },
          { header: 'Interest', value: (l: Loan) => interestOf(l), money: true },
          { header: 'Total payable', value: (l: Loan) => payable(l), money: true },
          { header: 'Paid', value: (l: Loan) => paid(c, l), money: true },
          { header: 'Outstanding', value: (l: Loan) => outstanding(l), money: true },
          { header: 'Status', value: (l: Loan) => LOAN_STATE_LABEL[loanState(l)] },
          { header: 'Loan officer', value: (l: Loan) => c.staffName(c.officerOf(l)) },
          { header: 'Disbursed on', value: (l: Loan) => day(l.disbursement?.date) },
        ] as Column[],
        rows: loans,
      }
    },
  },
  {
    id: 'disbursements',
    label: 'Disbursements',
    description: 'Money released to borrowers (confirmed transactions only).',
    filters: ['from', 'branchId', 'productId', 'officerId', 'borrowerType', 'paymentMethod'],
    build: (d, f, money) => {
      const c = ctx(d)
      const loanById = new Map(d.loans.map((l) => [l.id, l]))
      const ok = (x: Disbursement) => {
        const l = x.loanId ? loanById.get(x.loanId) : undefined
        return x.status === 'successful' && !!l &&
          (!f.branchId || l.branchId === f.branchId) && (!f.productId || l.productId === f.productId) &&
          (!f.officerId || c.officerOf(l) === f.officerId) &&
          (!f.borrowerType || (f.borrowerType === 'group' ? !!l.groupId : !l.groupId)) &&
          (!f.paymentMethod || x.method === f.paymentMethod)
      }
      const all = d.disbursements.filter(ok)
      const rows = all.filter((x) => inRange(x.confirmedAt, f))
      const now = new Date()
      const ym = (dt: Date) => dt.toISOString().slice(0, 7)
      const thisM = ym(now), prevM = ym(new Date(now.getFullYear(), now.getMonth() - 1, 15))
      const month = (m: string) => all.filter((x) => (x.confirmedAt ?? '').startsWith(m))
      const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '—')
      const byMethod = Object.entries(rows.reduce<Record<string, Disbursement[]>>((acc, x) => ({ ...acc, [x.method]: [...(acc[x.method] ?? []), x] }), {}))
      return {
        tiles: [
          ['Loans disbursed', rows.length],
          ['Approved amount', money(sum(rows, (x) => x.approvedAmount))],
          ['Net disbursed', money(sum(rows, (x) => x.netAmount))],
          ['Deductions', money(sum(rows, (x) => x.approvedAmount - x.netAmount))],
        ],
        blocks: [
          {
            title: 'This month vs previous month',
            headers: ['', 'This month', 'Previous month', 'Change'],
            rows: [
              ['Loans disbursed', month(thisM).length, month(prevM).length, pct(month(thisM).length, month(prevM).length)],
              ['Net amount', money(sum(month(thisM), (x) => x.netAmount)), money(sum(month(prevM), (x) => x.netAmount)),
                pct(sum(month(thisM), (x) => x.netAmount), sum(month(prevM), (x) => x.netAmount))],
            ],
          },
          { title: 'By payment method', headers: ['Method', 'Loans', 'Net amount'], rows: byMethod.map(([m, xs]) => [m.replace('_', ' '), xs.length, money(sum(xs, (x) => x.netAmount))]) },
        ],
        columns: [
          { header: 'Date', value: (x: Disbursement) => day(x.confirmedAt) },
          { header: 'Disbursement', value: (x: Disbursement) => x.number, link: (x: Disbursement) => `/disbursement/${x.id}` },
          { header: 'Loan', value: (x: Disbursement) => x.loanNumber ?? '—', link: (x: Disbursement) => (x.loanId ? `/loans/${x.loanId}` : null) },
          { header: 'Borrower / group', value: (x: Disbursement) => c.who(loanById.get(x.loanId!)!) },
          { header: 'Product', value: (x: Disbursement) => c.product.get(loanById.get(x.loanId!)!.productId)?.name ?? '—' },
          { header: 'Method', value: (x: Disbursement) => x.method.replace('_', ' ') },
          { header: 'Reference', value: (x: Disbursement) => x.transactionReference },
          { header: 'Approved', value: (x: Disbursement) => x.approvedAmount, money: true },
          { header: 'Net', value: (x: Disbursement) => x.netAmount, money: true },
          { header: 'Processed by', value: (x: Disbursement) => x.staffNames.processedBy },
          { header: 'Loan officer', value: (x: Disbursement) => c.staffName(c.officerOf(loanById.get(x.loanId!)!)) },
        ] as Column[],
        rows,
      }
    },
  },
  {
    id: 'repayments',
    label: 'Repayments',
    description: 'Money collected, split by what it paid off. Reversed payments are listed but not counted.',
    filters: ['from', 'branchId', 'productId', 'officerId', 'borrowerType', 'paymentMethod'],
    build: (d, f, money) => {
      const c = ctx(d)
      const loans = filterLoans(d, { ...f, from: '', to: '', loanStatus: '' }, c, false)
      const ids = new Set(loans.map((l) => l.id))
      const rows = d.repayments.filter((r) => ids.has(r.loanId) && inRange(r.paymentDate, f) && (!f.paymentMethod || r.channel === f.paymentMethod))
      const live = rows.filter((r) => !r.reversed)
      const expected = sum(loans.flatMap((l) => l.schedule.filter((i) => inRange(i.dueDate, f))), (i) => i.totalDue)
      const received = sum(live, (r) => r.amount)
      const loanById = new Map(d.loans.map((l) => [l.id, l]))
      const byMethod = Object.entries(live.reduce<Record<string, Repayment[]>>((acc, r) => ({ ...acc, [r.channel]: [...(acc[r.channel] ?? []), r] }), {}))
      return {
        tiles: [
          ['Total expected (due in period)', money(expected)],
          ['Total received', money(received), 'good'],
          ['Principal collected', money(sum(live, (r) => r.allocation.principal))],
          ['Interest collected', money(sum(live, (r) => r.allocation.interest))],
          ['Fees collected', money(sum(live, (r) => r.allocation.fees))],
          ['Penalties collected', money(sum(live, (r) => r.allocation.penalty))],
          ['Outstanding now', money(sum(loans, outstanding))],
          ['Number of payments', live.length],
        ],
        blocks: [{ title: 'By payment method', headers: ['Method', 'Payments', 'Amount'], rows: byMethod.map(([m, xs]) => [m.replace('_', ' '), xs.length, money(sum(xs, (r) => r.amount))]) }],
        columns: [
          { header: 'Receipt', value: (r: Repayment) => r.receiptNumber },
          { header: 'Date', value: (r: Repayment) => r.paymentDate },
          { header: 'Loan', value: (r: Repayment) => loanById.get(r.loanId)?.loanNumber ?? '—', link: (r: Repayment) => `/loans/${r.loanId}` },
          { header: 'Borrower', value: (r: Repayment) => c.name(loanById.get(r.loanId)!) },
          { header: 'Method', value: (r: Repayment) => r.channel.replace('_', ' ') },
          { header: 'Reference', value: (r: Repayment) => r.reference },
          { header: 'Amount', value: (r: Repayment) => r.amount, money: true },
          { header: 'Principal', value: (r: Repayment) => r.allocation.principal, money: true },
          { header: 'Interest', value: (r: Repayment) => r.allocation.interest, money: true },
          { header: 'Fees', value: (r: Repayment) => r.allocation.fees, money: true },
          { header: 'Penalty', value: (r: Repayment) => r.allocation.penalty, money: true },
          { header: 'Received by', value: (r: Repayment) => r.receivedByName },
          { header: 'Status', value: (r: Repayment) => (r.reversed ? `Reversed: ${r.reversalReason ?? ''}` : r.reconciliationStatus) },
        ] as Column[],
        rows,
      }
    },
  },
  {
    id: 'overdue',
    label: 'Overdue',
    description: 'Loans with instalments past due and unpaid, by age.',
    filters: ['branchId', 'productId', 'officerId', 'borrowerType'],
    build: (d, f, money) => {
      const c = ctx(d)
      const today = new Date().toLocaleDateString('en-CA')
      const loans = filterLoans(d, { ...f, from: '', to: '', loanStatus: 'overdue' }, c, false).sort((a, b) => b.daysInArrears - a.daysInArrears)
      const late = (l: Loan) => l.schedule.filter((i) => i.status !== 'paid' && i.dueDate < today)
      return {
        tiles: [
          ['Overdue loans', loans.length, loans.length ? 'bad' : 'good'],
          ['Overdue amount', money(sum(loans, (l) => l.arrearsAmount)), 'bad'],
          ['Outstanding on them', money(sum(loans, (l) => l.outstandingBalance))],
          ['Penalties charged', money(sum(loans, (l) => sum(l.schedule, (i) => i.penaltyDue)))],
        ],
        blocks: [{
          title: 'By days overdue',
          headers: ['Bucket', 'Loans', 'Overdue amount', 'Outstanding'],
          rows: BUCKETS.map(([label, lo, hi]) => {
            const xs = loans.filter((l) => l.daysInArrears >= lo && l.daysInArrears <= hi)
            return [label, xs.length, money(sum(xs, (l) => l.arrearsAmount)), money(sum(xs, (l) => l.outstandingBalance))]
          }),
        }],
        columns: [
          { header: 'Borrower / group', value: (l: Loan) => c.who(l) },
          { header: 'Loan', value: (l: Loan) => l.loanNumber, link: (l: Loan) => `/loans/${l.id}` },
          { header: 'Due date', value: (l: Loan) => late(l)[0]?.dueDate ?? '—' },
          { header: 'Amount due', value: (l: Loan) => sum(late(l), (i) => i.totalDue), money: true },
          { header: 'Amount paid', value: (l: Loan) => sum(late(l), (i) => i.paidAmount), money: true },
          { header: 'Overdue', value: (l: Loan) => l.arrearsAmount, money: true },
          { header: 'Days overdue', value: (l: Loan) => l.daysInArrears },
          { header: 'Penalty', value: (l: Loan) => sum(l.schedule, (i) => i.penaltyDue), money: true },
          { header: 'Collection officer', value: (l: Loan) => c.caseOf.get(l.id)?.assignedToName || '—' },
          { header: 'Collection status', value: (l: Loan) => c.caseOf.get(l.id)?.status.replace(/_/g, ' ') ?? 'No case' },
        ] as Column[],
        rows: loans,
      }
    },
  },
  {
    id: 'collections',
    label: 'Collections',
    description: 'How overdue money is being followed up. Activity and recoveries follow the date range.',
    filters: ['from', 'branchId', 'officerId'],
    build: (d, f, money) => {
      const cases = d.cases.filter((x) => (!f.branchId || x.branchId === f.branchId) && (!f.officerId || x.assignedToId === f.officerId))
      const caseLoans = new Set(cases.map((x) => x.loanId))
      const acts = d.activities.filter((a) => caseLoans.has(a.loanId) && inRange(a.createdAt, f))
      const promises = acts.filter((a) => a.kind === 'promise')
      const recovered = d.repayments.filter((r) => !r.reversed && caseLoans.has(r.loanId) && inRange(r.paymentDate, f))
      const per = (x: CollectionCase, k: string) => acts.filter((a) => a.loanId === x.loanId && a.kind === k).length
      return {
        tiles: [
          ['Assigned cases', cases.filter((x) => x.assignedToId).length],
          ['Contact attempts', acts.filter((a) => a.kind === 'call' || a.kind === 'message').length],
          ['Field visits', acts.filter((a) => a.kind === 'visit').length],
          ['Promises to pay', promises.length],
          ['Promises fulfilled', promises.filter((p) => p.promiseStatus === 'kept').length, 'good'],
          ['Promises missed', promises.filter((p) => p.promiseStatus === 'broken').length, 'bad'],
          ['Amount recovered', money(sum(recovered, (r) => r.amount)), 'good'],
          ['Outstanding cases', cases.filter((x) => x.status !== 'resolved' && x.status !== 'paid').length],
        ],
        columns: [
          { header: 'Case', value: (x: CollectionCase) => x.number, link: (x: CollectionCase) => `/collections/${x.id}` },
          { header: 'Borrower', value: (x: CollectionCase) => x.borrowerName },
          { header: 'Loan', value: (x: CollectionCase) => x.loanNumber },
          { header: 'Officer', value: (x: CollectionCase) => x.assignedToName || 'Unassigned' },
          { header: 'Status', value: (x: CollectionCase) => x.status.replace(/_/g, ' ') },
          { header: 'Contacts', value: (x: CollectionCase) => per(x, 'call') + per(x, 'message') },
          { header: 'Visits', value: (x: CollectionCase) => per(x, 'visit') },
          { header: 'Promises', value: (x: CollectionCase) => per(x, 'promise') },
          { header: 'Recovered', value: (x: CollectionCase) => sum(recovered.filter((r) => r.loanId === x.loanId), (r) => r.amount), money: true },
          { header: 'Overdue now', value: (x: CollectionCase) => x.overdueAmount, money: true },
        ] as Column[],
        rows: cases,
      }
    },
  },
  {
    id: 'borrowers',
    label: 'Borrowers',
    description: 'The customer portfolio. "New" follows the date range; open a borrower for their full financial history.',
    filters: ['from', 'branchId', 'officerId'],
    build: (d, f) => {
      const c = ctx(d)
      const list = d.borrowers.filter((b) => (!f.branchId || b.branchId === f.branchId) && (!f.officerId || b.officerId === f.officerId))
      const loansOf = (b: Borrower) => d.loans.filter((l) => l.borrowerId === b.id)
      const activeL = (b: Borrower) => loansOf(b).filter((l) => l.status === 'active')
      return {
        tiles: [
          ['Total borrowers', list.length],
          ['New in period', list.filter((b) => inRange(b.createdAt, f)).length],
          ['Active status', list.filter((b) => b.status === 'active').length],
          ['Inactive / suspended', list.filter((b) => b.status === 'inactive' || b.status === 'suspended').length],
          ['Verified', list.filter((b) => b.verified).length],
          ['Unverified', list.filter((b) => !b.verified).length],
          ['With active loans', list.filter((b) => activeL(b).length).length],
          ['With overdue loans', list.filter((b) => activeL(b).some((l) => l.daysInArrears > 0)).length, 'bad'],
        ],
        columns: [
          { header: 'Customer ID', value: (b: Borrower) => b.customerNumber },
          { header: 'Name', value: (b: Borrower) => b.fullName, link: (b: Borrower) => `/borrowers/${b.id}` },
          { header: 'Branch', value: (b: Borrower) => c.branch.get(b.branchId)?.name ?? '—' },
          { header: 'Officer', value: (b: Borrower) => c.staffName(b.officerId) },
          { header: 'Status', value: (b: Borrower) => b.status },
          { header: 'Verified', value: (b: Borrower) => (b.verified ? 'Yes' : 'No') },
          { header: 'Loans', value: (b: Borrower) => loansOf(b).length },
          { header: 'Total borrowed', value: (b: Borrower) => sum(loansOf(b), (l) => l.principal), money: true },
          { header: 'Total repaid', value: (b: Borrower) => sum(loansOf(b), (l) => paid(c, l)), money: true },
          { header: 'Outstanding', value: (b: Borrower) => sum(activeL(b), (l) => l.outstandingBalance), money: true },
          { header: 'Overdue', value: (b: Borrower) => sum(activeL(b), overdueAmt), money: true },
          { header: 'Registered', value: (b: Borrower) => day(b.createdAt) },
        ] as Column[],
        rows: list,
      }
    },
  },
  {
    id: 'groups',
    label: 'Groups',
    description: 'Group lending: members, savings, group loans and repayment performance.',
    filters: ['branchId', 'officerId'],
    build: (d, f, money) => {
      const groups = d.groups.filter((g) => (!f.branchId || g.branchId === f.branchId) && (!f.officerId || g.officerId === f.officerId))
      const rows = groups.map((g) => {
        const s = groupSummary(g, d.applications, d.loans, d.repayments)
        const gl = d.loans.filter((l) => l.groupId === g.id)
        return { g, s, loans: gl.length, disbursed: sum(gl, (l) => l.principal) }
      })
      return {
        tiles: [
          ['Groups', groups.length],
          ['Active groups', groups.filter((g) => g.status === 'active').length],
          ['Total members', sum(rows, (r) => r.s.activeMembers)],
          ['Group loans', sum(rows, (r) => r.loans)],
          ['Group savings', money(sum(rows, (r) => r.s.savings))],
          ['Total disbursed', money(sum(rows, (r) => r.disbursed))],
          ['Total repaid', money(sum(rows, (r) => r.s.repaid)), 'good'],
          ['Outstanding', money(sum(rows, (r) => r.s.outstanding))],
          ['Groups with overdue', rows.filter((r) => r.s.overdue > 0).length, 'bad'],
        ],
        columns: [
          { header: 'Group ID', value: (r: (typeof rows)[number]) => r.g.groupNumber },
          { header: 'Group', value: (r: (typeof rows)[number]) => r.g.name, link: (r: (typeof rows)[number]) => `/groups/${r.g.id}` },
          { header: 'Status', value: (r: (typeof rows)[number]) => r.g.status },
          { header: 'Members', value: (r: (typeof rows)[number]) => r.s.activeMembers },
          { header: 'Loans', value: (r: (typeof rows)[number]) => r.loans },
          { header: 'Savings', value: (r: (typeof rows)[number]) => r.s.savings, money: true },
          { header: 'Disbursed', value: (r: (typeof rows)[number]) => r.disbursed, money: true },
          { header: 'Repaid', value: (r: (typeof rows)[number]) => r.s.repaid, money: true },
          { header: 'Outstanding', value: (r: (typeof rows)[number]) => r.s.outstanding, money: true },
          { header: 'Overdue', value: (r: (typeof rows)[number]) => r.s.overdue, money: true },
          { header: 'Repayment rate', value: (r: (typeof rows)[number]) => (r.s.repaymentRate == null ? '—' : `${r.s.repaymentRate.toFixed(1)}%`) },
        ] as Column[],
        rows,
      }
    },
  },
  {
    id: 'products',
    label: 'Loan products',
    description: 'Each product side by side (alphabetical — not a ranking). Repayments and income follow the date range.',
    filters: ['from', 'branchId', 'officerId', 'borrowerType'],
    build: (d, f, money) => {
      const c = ctx(d)
      const loans = filterLoans(d, { ...f, from: '', to: '', loanStatus: '', productId: '' }, c, false)
      const rows = [...d.products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
        const pl = loans.filter((l) => l.productId === p.id)
        const reps = pl.flatMap((l) => c.paidByLoan.get(l.id) ?? []).filter((r) => inRange(r.paymentDate, f))
        return {
          p, loans: pl.length, disbursed: sum(pl, (l) => l.principal), repaid: sum(reps, (r) => r.amount),
          outstanding: sum(pl, outstanding), overdue: sum(pl, overdueAmt),
          completed: pl.filter((l) => l.status === 'closed').length, active: pl.filter((l) => l.status === 'active').length,
          fees: sum(reps, (r) => r.allocation.fees) + sum(pl.filter((l) => !f.from || inRange(l.disbursement?.date, f)), (l) => l.feesDeducted),
          interest: sum(reps, (r) => r.allocation.interest),
        }
      })
      type Row = (typeof rows)[number]
      return {
        tiles: [['Products', rows.length], ['Loans', sum(rows, (r) => r.loans)], ['Disbursed', money(sum(rows, (r) => r.disbursed))], ['Outstanding', money(sum(rows, (r) => r.outstanding))]],
        columns: [
          { header: 'Product', value: (r: Row) => `${r.p.name} (${r.p.code})`, link: (r: Row) => `/products/${r.p.id}` },
          { header: 'Status', value: (r: Row) => r.p.status ?? (r.p.active ? 'active' : 'inactive') },
          { header: 'Loans', value: (r: Row) => r.loans },
          { header: 'Disbursed', value: (r: Row) => r.disbursed, money: true },
          { header: 'Repayments', value: (r: Row) => r.repaid, money: true },
          { header: 'Outstanding', value: (r: Row) => r.outstanding, money: true },
          { header: 'Overdue', value: (r: Row) => r.overdue, money: true },
          { header: 'Completed', value: (r: Row) => r.completed },
          { header: 'Active', value: (r: Row) => r.active },
          { header: 'Fees collected', value: (r: Row) => r.fees, money: true },
          { header: 'Interest collected', value: (r: Row) => r.interest, money: true },
        ] as Column[],
        rows,
      }
    },
  },
  {
    id: 'officers',
    label: 'Loan officers',
    description: 'Operational activity in the period, shown next to each portfolio so results can be read in context.',
    filters: ['from', 'branchId'],
    build: (d, f, money) => {
      const c = ctx(d)
      const people = d.staff.filter((s) => ['loan_officer', 'branch_manager'].includes(s.role) && (!f.branchId || s.branchId === f.branchId))
      const rows = people.map((s) => {
        const apps = d.applications.filter((a) => (a.loanOfficerId ?? a.createdBy) === s.id && inRange(a.applicationDate || a.createdAt, f))
        const myLoans = d.loans.filter((l) => c.officerOf(l) === s.id)
        const disbursed = myLoans.filter((l) => inRange(l.disbursement?.date, f))
        const active = myLoans.filter((l) => l.status === 'active')
        const payments = d.repayments.filter((r) => !r.reversed && (r.receivedById === s.id || (!r.receivedById && r.recordedBy === s.name)) && inRange(r.paymentDate, f))
        const cases = d.cases.filter((x) => x.assignedToId === s.id)
        const caseLoans = new Set(cases.map((x) => x.loanId))
        const portfolio = sum(active, (l) => l.outstandingBalance)
        const overdue = sum(active, overdueAmt)
        return {
          s, apps: apps.length, approved: apps.filter((a) => ['approved', 'disbursed'].includes(a.status)).length,
          disbursedN: disbursed.length, disbursedAmt: sum(disbursed, (l) => l.netDisbursed), payments: payments.length,
          cases: cases.length,
          collected: sum(d.repayments.filter((r) => !r.reversed && caseLoans.has(r.loanId) && inRange(r.paymentDate, f)), (r) => r.amount),
          overdueCases: cases.filter((x) => x.status !== 'resolved' && x.status !== 'paid').length,
          visits: d.activities.filter((a) => a.kind === 'visit' && a.createdBy === s.name && inRange(a.createdAt, f)).length,
          activeLoans: active.length, portfolio, par: portfolio ? (overdue / portfolio) * 100 : 0,
        }
      })
      type Row = (typeof rows)[number]
      return {
        tiles: [['Officers', rows.length], ['Applications', sum(rows, (r) => r.apps)], ['Disbursed', money(sum(rows, (r) => r.disbursedAmt))], ['Collected on cases', money(sum(rows, (r) => r.collected))]],
        columns: [
          { header: 'Officer', value: (r: Row) => r.s.name },
          { header: 'Branch', value: (r: Row) => c.branch.get(r.s.branchId ?? '')?.name ?? '—' },
          { header: 'Active loans (portfolio)', value: (r: Row) => r.activeLoans },
          { header: 'Portfolio outstanding', value: (r: Row) => r.portfolio, money: true },
          { header: 'Portfolio overdue %', value: (r: Row) => `${r.par.toFixed(1)}%` },
          { header: 'Applications handled', value: (r: Row) => r.apps },
          { header: 'Approved', value: (r: Row) => r.approved },
          { header: 'Loans disbursed', value: (r: Row) => r.disbursedN },
          { header: 'Amount disbursed', value: (r: Row) => r.disbursedAmt, money: true },
          { header: 'Payments recorded', value: (r: Row) => r.payments },
          { header: 'Collection cases', value: (r: Row) => r.cases },
          { header: 'Collected on cases', value: (r: Row) => r.collected, money: true },
          { header: 'Open overdue cases', value: (r: Row) => r.overdueCases },
          { header: 'Field visits', value: (r: Row) => r.visits },
        ] as Column[],
        rows,
        note: 'Officers carry different portfolios (size, products, areas). Compare activity alongside portfolio size and overdue %, not as a league table.',
      }
    },
  },
  {
    id: 'financial',
    label: 'Financial',
    description: 'Straight from the double-entry ledger. Period movements follow the date range; balances are as of today.',
    filters: ['from'],
    build: (d, f, money) => {
      const L = d.ledger
      if (!L) return { tiles: [], columns: [], rows: [], note: 'Loading the ledger…' }
      const entries = L.entries.filter((e) => inRange(e.date, f))
      const by = (acc: string, side: 'debit' | 'credit') => sum(entries.filter((e) => e.account === acc), (e) => e[side])
      const bal = (code: string) => L.accounts.find((a) => a.code === code)?.balance ?? 0
      const disbursed = sum(entries.filter((e) => e.account === 'loan_portfolio' && e.description.includes('disbursed')), (e) => e.debit)
      return {
        tiles: [
          ['Disbursements (principal)', money(disbursed)],
          ['Principal received', money(sum(entries.filter((e) => e.account === 'loan_portfolio' && e.description.startsWith('Repayment')), (e) => e.credit) - sum(entries.filter((e) => e.account === 'loan_portfolio' && e.description.startsWith('Reversal of repayment')), (e) => e.debit))],
          ['Interest received', money(by('interest_income', 'credit') - by('interest_income', 'debit')), 'good'],
          ['Fees', money(by('fee_income', 'credit') - by('fee_income', 'debit')), 'good'],
          ['Penalties', money(by('penalty_income', 'credit') - by('penalty_income', 'debit')), 'good'],
          ['Loans written off', money(by('write_off_expense', 'debit'))],
          ['Outstanding receivables (principal)', money(bal('loan_portfolio'))],
          ['Cash', money(bal('cash'))],
          ['Bank', money(bal('bank'))],
          ['Mobile-money float', money(bal('mobile_money'))],
          ['Journals in period', new Set(entries.map((e) => e.journal)).size],
          ['Transaction total (debits)', money(sum(entries, (e) => e.debit))],
        ],
        blocks: [{ title: 'Account balances (debit + / credit −)', headers: ['Account', 'Balance'], rows: L.accounts.map((a) => [a.name, money(a.balance)]) }],
        columns: [
          { header: 'Journal', value: (e: LedgerData['entries'][number]) => e.journal },
          { header: 'Date', value: (e: LedgerData['entries'][number]) => day(e.date) },
          { header: 'Account', value: (e: LedgerData['entries'][number]) => L.accounts.find((a) => a.code === e.account)?.name ?? e.account },
          { header: 'Description', value: (e: LedgerData['entries'][number]) => e.description },
          { header: 'Loan', value: (e: LedgerData['entries'][number]) => e.loanNumber ?? '', link: (e: LedgerData['entries'][number]) => (e.loanId ? `/loans/${e.loanId}` : null) },
          { header: 'Debit', value: (e: LedgerData['entries'][number]) => e.debit, money: true },
          { header: 'Credit', value: (e: LedgerData['entries'][number]) => e.credit, money: true },
        ] as Column[],
        rows: entries,
        note: 'Operating expenses (rent, salaries…) are not recorded in this system; only loan write-offs appear as an expense.',
      }
    },
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    description: 'The whole book by state, product, branch, officer and age.',
    filters: ['branchId', 'productId', 'officerId', 'borrowerType'],
    build: (d, f, money) => {
      const c = ctx(d)
      const loans = filterLoans(d, { ...f, from: '', to: '', loanStatus: '' }, c, false).filter((l) => l.status !== 'reversed')
      const live = loans.filter((l) => l.status === 'active')
      const total = sum(live, (l) => l.outstandingBalance)
      const line = (dim: string, label: string, xs: Loan[]) => {
        const out = sum(xs.filter((l) => l.status === 'active'), (l) => l.outstandingBalance)
        const od = sum(xs, overdueAmt)
        return { dim, label, loans: xs.length, out, od, share: total ? (out / total) * 100 : 0 }
      }
      const groupBy = (key: (l: Loan) => string) =>
        Object.entries(loans.reduce<Record<string, Loan[]>>((acc, l) => ({ ...acc, [key(l)]: [...(acc[key(l)] ?? []), l] }), {}))
      const today = new Date().toLocaleDateString('en-CA')
      const dueRows = live.flatMap((l) => l.schedule.filter((i) => i.dueDate <= today))
      const onTime = dueRows.length ? (dueRows.filter((i) => i.status === 'paid' && !i.wasLate).length / dueRows.length) * 100 : null
      const rows = [
        ...(['current', 'overdue', 'restructured', 'defaulted', 'completed'] as LoanState[]).map((s) => line('Status', LOAN_STATE_LABEL[s], loans.filter((l) => loanState(l) === s))),
        ...groupBy((l) => c.product.get(l.productId)?.name ?? '—').map(([k, xs]) => line('Product', k, xs)),
        ...groupBy((l) => c.branch.get(l.branchId)?.name ?? '—').map(([k, xs]) => line('Branch', k, xs)),
        ...groupBy((l) => c.staffName(c.officerOf(l))).map(([k, xs]) => line('Loan officer', k, xs)),
        line('Aging', 'Not overdue', live.filter((l) => l.daysInArrears === 0)),
        ...BUCKETS.map(([label, lo, hi]) => line('Aging', label, live.filter((l) => l.daysInArrears >= lo && l.daysInArrears <= hi))),
      ]
      type Row = (typeof rows)[number]
      return {
        tiles: [
          ['Outstanding portfolio', money(total)],
          ['Active loans', live.length],
          ['Portfolio overdue (PAR)', total ? `${((sum(live, overdueAmt) / total) * 100).toFixed(1)}%` : '—', 'bad'],
          ['On-time instalments', onTime == null ? '—' : `${onTime.toFixed(1)}%`],
          ['Restructured', live.filter((l) => l.restructureCount > 0).length],
          ['Defaulted (written off)', loans.filter((l) => l.status === 'written_off').length],
        ],
        columns: [
          { header: 'View', value: (r: Row) => r.dim },
          { header: 'Segment', value: (r: Row) => r.label },
          { header: 'Loans', value: (r: Row) => r.loans },
          { header: 'Outstanding', value: (r: Row) => r.out, money: true },
          { header: 'Overdue', value: (r: Row) => r.od, money: true },
          { header: 'Share of portfolio', value: (r: Row) => `${r.share.toFixed(1)}%` },
        ] as Column[],
        rows,
      }
    },
  },
  {
    id: 'audit',
    label: 'Audit',
    description: 'Every change recorded in the system, with before → after values where a record was edited.',
    filters: ['from', 'officerId', 'action'],
    build: (d, f) => {
      const staff = new Map(d.staff.map((s) => [s.id, s]))
      const action = f.action
      const rows = d.audit.filter((e) => inRange(e.timestamp, f) && (!f.officerId || e.userId === f.officerId) && (!action || auditKind(e) === action))
      const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
      return {
        tiles: (['created', 'updated', 'reversed', 'approval', 'disbursement', 'deleted'] as const).map((k) => [AUDIT_KINDS[k], rows.filter((e) => auditKind(e) === k).length]),
        columns: [
          { header: 'Date', value: (e: AuditLogEntry) => localStamp(e.timestamp) },
          { header: 'User', value: (e: AuditLogEntry) => e.userName || staff.get(e.userId)?.name || '—' },
          { header: 'Action', value: (e: AuditLogEntry) => e.action },
          { header: 'Record', value: (e: AuditLogEntry) => `${e.entity}${e.entityId ? ` ${e.entityId.slice(0, 8)}` : ''}` },
          { header: 'Details', value: (e: AuditLogEntry) => e.details },
          { header: 'Previous → new', value: (e: AuditLogEntry) => Object.entries(e.changes ?? {}).map(([k, v]) => `${k}: ${fmt(v.before)} → ${fmt(v.after)}`).join('; ') },
        ] as Column[],
        rows,
      }
    },
  },
]

export const AUDIT_KINDS = {
  created: 'Created records',
  updated: 'Updated records',
  deleted: 'Deleted / voided',
  reversed: 'Reversals',
  approval: 'Approval actions',
  disbursement: 'Disbursement actions',
} as const

export function auditKind(e: AuditLogEntry): keyof typeof AUDIT_KINDS | 'other' {
  const a = e.action.toLowerCase()
  if (['approved', 'declined', 'returned', 'assessed', 'authorised'].includes(a)) return 'approval'
  if (e.entity === 'disbursement' || a === 'disbursed' || a === 'released') return 'disbursement'
  if (a.includes('revers')) return 'reversed'
  if (['deleted', 'removed', 'cancelled', 'voided', 'written_off'].includes(a)) return 'deleted'
  if (['created', 'registered', 'recorded', 'prepared', 'imported', 'uploaded'].includes(a)) return 'created'
  if (['updated', 'saved', 'changed', 'verified', 'assigned', 'matched', 'ignored', 'unmatched', 'restructured'].includes(a)) return 'updated'
  return 'other'
}
