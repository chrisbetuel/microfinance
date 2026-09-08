// Core domain model for the Loan Management System (Phase 1 — sellable core)

export type StaffRole =
  | 'platform_admin'
  | 'lender_admin'
  | 'branch_manager'
  | 'loan_officer'
  | 'credit_committee'
  | 'cashier'
  | 'auditor'

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  platform_admin: 'Platform Administrator',
  lender_admin: 'Lender Administrator',
  branch_manager: 'Branch Manager',
  loan_officer: 'Loan Officer',
  credit_committee: 'Credit Committee / Approver',
  cashier: 'Cashier / Finance Officer',
  auditor: 'Auditor',
}

export interface Lender {
  id: string
  name: string
  licenceNumber: string
  licenceExpiry: string
  address: string
  phone: string
  email: string
  logoInitials: string
  brandColor: string
  currency: string
  language: 'sw' | 'en'
  planLevel: 'starter' | 'growth' | 'enterprise'
  staffLimit: number
  activeLoanLimit: number
  smsBalance: number
  smsSenderName: string
  smsSenderApproved: boolean
}

export interface Branch {
  id: string
  lenderId: string
  name: string
  code: string
  location: string
  openedOn: string
}

export interface Staff {
  id: string
  name: string
  role: StaffRole
  branchId: string | null
  approvalLimit: number
  email: string
  phone: string
  active: boolean
}

export interface Holiday {
  id: string
  date: string
  name: string
}

export type BorrowerType = 'individual' | 'business'

export interface Guarantor {
  id: string
  name: string
  nationalId: string
  phone: string
  consentGiven: boolean
  consentDate: string | null
}

export interface BorrowerDocument {
  id: string
  name: string
  type: string
  uploadedAt: string
}

export interface HistoryEvent {
  id: string
  date: string
  label: string
  detail: string
}

export interface Borrower {
  id: string
  type: BorrowerType
  branchId: string
  fullName: string
  businessName?: string
  registrationNumber?: string
  taxId?: string
  sector?: string
  yearsTrading?: number
  nationalId: string
  phone: string
  residence: string
  occupation: string
  monthlyIncome: number
  nextOfKin: string
  guarantors: Guarantor[]
  documents: BorrowerDocument[]
  blacklisted: boolean
  blacklistReason: string | null
  officerId: string
  createdAt: string
  history: HistoryEvent[]
}

export type InterestMethod = 'reducing' | 'flat'
export type RepaymentFrequency = 'daily' | 'weekly' | 'fortnightly' | 'monthly'
export type FeeTiming = 'deducted' | 'added'

export interface ProductFee {
  id: string
  name: string
  kind: 'fixed' | 'percent'
  value: number
  timing: FeeTiming
}

export interface ApprovalLevel {
  id: string
  minAmount: number
  maxAmount: number | null
  requiredRole: StaffRole
}

export type SecurityType = 'guarantors' | 'collateral' | 'group_guarantee' | 'savings' | 'none'

export interface LoanProduct {
  id: string
  name: string
  code: string
  active: boolean
  interestMethod: InterestMethod
  interestRate: number // percent per period
  interestPeriod: 'daily' | 'weekly' | 'monthly'
  repaymentFrequency: RepaymentFrequency
  minAmount: number
  maxAmount: number
  minTermInstalments: number
  maxTermInstalments: number
  stepUpEnabled: boolean
  fees: ProductFee[]
  gracePeriodDays: number
  gracePeriodAppliesTo: 'principal' | 'interest' | 'both' | 'none'
  penaltyKind: 'fixed' | 'percent'
  penaltyValue: number
  penaltyCap: number
  compulsorySavingsPercent: number
  allocationOrder: Array<'penalty' | 'fee' | 'interest' | 'principal'>
  securityRequired: SecurityType[]
  approvalLevels: ApprovalLevel[]
}

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'declined'
  | 'disbursed'

export interface ApprovalDecision {
  id: string
  approverId: string
  approverName: string
  role: StaffRole
  decision: 'approved' | 'declined'
  date: string
  comment: string
}

export interface Application {
  id: string
  reference: string
  borrowerId: string
  productId: string
  branchId: string
  groupId: string | null
  amount: number
  termInstalments: number
  purpose: string
  status: ApplicationStatus
  declaredIncome: number
  declaredExpenses: number
  affordabilityPass: boolean
  duplicateCheckPass: boolean
  blacklistCheckPass: boolean
  creditBureauConsent: boolean
  score: number | null
  scoreRecommendation: 'recommend' | 'caution' | 'decline' | null
  approvals: ApprovalDecision[]
  requiredApproverRole: StaffRole
  createdBy: string
  createdAt: string
  declineReason: string | null
}

export type LoanStatus = 'pending_disbursement' | 'active' | 'closed' | 'written_off'

export interface ScheduleInstalment {
  period: number
  dueDate: string
  principalDue: number
  interestDue: number
  feesDue: number
  penaltyDue: number
  totalDue: number
  paidAmount: number
  balanceAfter: number
  status: 'upcoming' | 'due' | 'overdue' | 'paid' | 'partial'
}

export type DisbursementChannel = 'mobile_money' | 'bank_transfer' | 'supplier' | 'cash'

export interface Loan {
  id: string
  applicationId: string
  borrowerId: string
  productId: string
  branchId: string
  groupId: string | null
  principal: number
  netDisbursed: number
  feesDeducted: number
  status: LoanStatus
  schedule: ScheduleInstalment[]
  disbursement: {
    channel: DisbursementChannel
    date: string
    reference: string
    approvedBy: string
    disbursedBy: string
  } | null
  savingsDeducted: number
  outstandingBalance: number
  daysInArrears: number
  arrearsAmount: number
  restructureCount: number
  restructuredAt: string | null
  closedAt: string | null
  closureReason: string
  createdAt: string
}

export type GroupMemberRole = 'member' | 'chair' | 'secretary' | 'treasurer'

export interface GroupMembership {
  id: string
  borrowerId: string
  borrowerName: string
  role: GroupMemberRole
  joinedOn: string
  active: boolean
}

export interface BorrowerGroup {
  id: string
  branchId: string
  officerId: string
  name: string
  meetingDay: string
  meetingFrequency: string
  formedOn: string
  active: boolean
  createdAt: string
  memberships: GroupMembership[]
}

export type SavingsTransactionKind = 'deposit' | 'withdrawal' | 'loan_deduction' | 'release'

export interface SavingsTransaction {
  id: string
  kind: SavingsTransactionKind
  amount: number
  balanceAfter: number
  note: string
  createdBy: string
  createdAt: string
}

export interface SavingsAccount {
  id: string
  borrowerId: string
  borrowerName: string
  balance: number
  createdAt: string
  transactions: SavingsTransaction[]
}

export interface RestructurePreview {
  remainingPrincipal: number
  carriedArrears: number
  penaltyWaived: number
  newPrincipal: number
}

export interface Repayment {
  id: string
  loanId: string
  amount: number
  date: string
  channel: 'mobile_money' | 'bank' | 'cash' | 'field'
  receiptNumber: string
  allocation: {
    penalty: number
    fees: number
    interest: number
    principal: number
    remainder: number
  }
  recordedBy: string
  reversed: boolean
  reversalReason: string | null
}

export interface AuditLogEntry {
  id: string
  timestamp: string
  userId: string
  userName: string
  action: string
  entity: string
  entityId: string
  details: string
}

export interface Notification {
  id: string
  borrowerId: string | null
  channel: 'sms' | 'email'
  to: string
  kind: string
  body: string
  status: 'queued' | 'sent' | 'failed'
  error: string
  createdAt: string
  sentAt: string | null
}

export type CollectionActivityKind = 'call' | 'visit' | 'message' | 'note' | 'promise'
export type CollectionOutcome = '' | 'reached' | 'no_answer' | 'promised' | 'disputed' | 'paid' | 'other'

export interface CollectionActivity {
  id: string
  loanId: string
  borrowerId: string
  kind: CollectionActivityKind
  outcome: CollectionOutcome
  note: string
  promisedAmount: number | null
  promisedDate: string | null
  promiseStatus: 'kept' | 'broken' | 'pending' | null
  createdBy: string
  createdAt: string
}
