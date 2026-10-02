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
  sessionTimeoutMinutes: number
  dualAuthorisationThreshold: number
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

export type GuarantorStatus = 'pending' | 'approved' | 'rejected'

export interface Guarantor {
  id: string
  name: string
  nationalId: string
  phone: string
  relationship: string
  address: string
  occupation: string
  monthlyIncome: number
  guaranteeAmount: number
  status: GuarantorStatus
  consentGiven: boolean
  consentDate: string | null
}

export type GuarantorInput = Omit<Guarantor, 'id' | 'consentDate'> & { id?: string; consentDate?: string | null }

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

export type BorrowerStatus = 'active' | 'inactive' | 'suspended' | 'blacklisted'
export type IncomeSource = '' | 'employed' | 'business' | 'other'

/** Everything the registration wizard collects. */
export interface BorrowerProfile {
  type: BorrowerType
  branchId: string
  officerId: string
  // 1. personal
  fullName: string
  dateOfBirth: string | null
  gender: string
  nationalId: string
  phone: string
  altPhone: string
  email: string
  maritalStatus: string
  // 2. address (residence = physical address)
  region: string
  district: string
  ward: string
  street: string
  residence: string
  postalAddress: string
  // 3. employment / business (sector = business type, yearsTrading = years in business)
  incomeSource: IncomeSource
  occupation: string
  employerName: string
  jobTitle: string
  employmentType: string
  yearsEmployed: number | null
  businessName?: string | null
  registrationNumber?: string | null
  taxId?: string | null
  sector?: string | null
  businessLocation: string
  yearsTrading?: number | null
  // 4. financial
  dependents: number | null
  monthlyIncome: number
  monthlyExpenses: number
  otherIncomeSources: string
  existingLoans: string
  existingLoanPayments: number
  bankName: string
  bankAccount: string
  mobileMoneyProvider: string
  mobileMoneyNumber: string
  // 5. emergency contact
  nextOfKin: string
  emergencyName: string
  emergencyRelationship: string
  emergencyPhone: string
  emergencyAddress: string
}

export interface Borrower extends BorrowerProfile {
  id: string
  customerNumber: string
  status: BorrowerStatus
  verified: boolean
  phoneVerified: boolean
  verifiedBy: string
  verifiedAt: string | null
  guarantors: Guarantor[]
  documents: BorrowerDocument[]
  blacklisted: boolean
  blacklistReason: string | null
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
  | 'under_assessment'
  | 'pending_approval'
  | 'approved'
  | 'declined'
  | 'disbursed'

export interface ApprovalDecision {
  id: string
  approverId: string
  approverName: string
  role: StaffRole
  decision: 'approved' | 'declined' | 'returned'
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
  risk: ApplicationRisk
  needsReview: boolean
  requestedAmount: number
  requestedTerm: number
  loanOfficerId: string | null
  applicationDate: string
  disbursementMethod: DisbursementChannel | ''
  firstRepaymentDate: string | null
  groupMemberIds: string[]
  guarantorIds: string[]
  collateralIds: string[]
  otherIncome: number
  businessIncome: number
  businessExpenses: number
  existingLoansCount: number
  existingRepayments: number
  dependents: number
  capacity: { totalIncome: number; businessNet: number; disposable: number; maxInstalment: number }
  assessmentResult: AssessmentResult | ''
  assessedAmount: number | null
  recommendedTerm: number | null
  assessmentNotes: string
  assessedById: string | null
  assessedAt: string | null
  documents: ApplicationDocument[]
  events: ApplicationEvent[]
}

export type AssessmentResult = 'recommended' | 'further_review' | 'not_recommended'

export interface ApplicationDocument {
  id: string
  type: string
  name: string
  status: 'pending' | 'verified' | 'rejected'
  note: string
  verifiedBy: string
  verifiedAt: string | null
  uploadedBy: string
  uploadedAt: string
}

export interface ApplicationEvent {
  id: string
  stage: ApplicationStatus
  label: string
  note: string
  by: string
  at: string
}

/** Fields captured by the application form (create and edit). */
export interface ApplicationInput {
  borrowerId: string
  productId: string
  branchId?: string
  groupId: string | null
  amount: number
  termInstalments: number
  purpose: string
  declaredIncome: number
  declaredExpenses: number
  creditBureauConsent: boolean
  loanOfficerId: string | null
  disbursementMethod: DisbursementChannel | ''
  firstRepaymentDate: string | null
  groupMemberIds: string[]
  guarantorIds: string[]
  collateralIds: string[]
  otherIncome: number
  businessIncome: number
  businessExpenses: number
  existingLoansCount: number
  existingRepayments: number
  dependents: number
}

export interface ApplicationRisk {
  monthlyIncome?: number
  monthlyExpenses?: number
  existingRepayments?: number
  newInstalment?: number
  disposableAfter?: number
  debtToIncome?: number
  loanToIncome?: number | null
  existingDebt?: number
  previousLoans?: number
  completedLoans?: number
  activeLoans?: number
  lateInstalments?: number
  defaults?: number
  flags?: string[]
}

export type CollateralStatus = 'pledged' | 'active' | 'released' | 'seized'

export interface Collateral {
  id: string
  borrowerId: string
  loanId: string | null
  assetType: string
  description: string
  estimatedValue: number
  ownerName: string
  ownershipDocument: string
  valuationDate: string | null
  valuedBy: string
  existingClaims: string
  documents: string[]
  status: CollateralStatus
  createdBy: string
  createdAt: string
}

export type LoanStatus = 'pending_disbursement' | 'active' | 'closed' | 'written_off' | 'reversed'

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
  wasLate: boolean
}

export type DisbursementChannel = 'mobile_money' | 'bank_transfer' | 'supplier' | 'cash' | 'wallet'

export type DisbursementStatus =
  | 'pending'
  | 'under_verification'
  | 'approved'
  | 'processing'
  | 'successful'
  | 'failed'
  | 'cancelled'
  | 'reversed'

export interface Disbursement {
  id: string
  number: string
  applicationId: string
  applicationReference: string
  borrowerId: string
  borrowerName: string
  customerNumber: string
  loanId: string | null
  loanNumber: string | null
  status: DisbursementStatus
  approvedAmount: number
  fees: { name: string; amount: number }[]
  feesTotal: number
  insurance: number
  savingsDeducted: number
  otherDeductions: { label: string; amount: number }[]
  netAmount: number
  method: DisbursementChannel
  recipientType: 'borrower' | 'third_party'
  recipientName: string
  recipientProvider: string
  recipientAccount: string
  authorisationNote: string
  destinationVerified: boolean
  warnings: string[]
  requiresDualAuthorisation: boolean
  checks: Record<string, boolean>
  checklist: Record<string, boolean>
  overrideReason: string
  preparedById: string
  preparedAt: string
  verifiedById: string | null
  verifiedAt: string | null
  authorisedById: string | null
  authorisedAt: string | null
  secondAuthorisedById: string | null
  secondAuthorisedAt: string | null
  processedById: string | null
  processedAt: string | null
  confirmedAt: string | null
  reversedAt: string | null
  staffNames: {
    preparedBy: string
    verifiedBy: string
    authorisedBy: string
    secondAuthorisedBy: string
    processedBy: string
    confirmedBy: string
    reversedBy: string
  }
  transactionReference: string
  paymentId: string | null
  paymentStatus: 'pending' | 'success' | 'failed' | null
  failureReason: string
  cancelReason: string
  reversalReason: string
  createdAt: string
  events: { id: string; status: DisbursementStatus; action: string; note: string; changes: Record<string, { from: string; to: string }>; by: string; at: string }[]
}

export interface DisbursementInput {
  applicationId: string
  method: DisbursementChannel
  recipientType: 'borrower' | 'third_party'
  recipientName: string
  recipientProvider: string
  recipientAccount: string
  authorisationNote: string
  insurance: number
  otherDeductions: { label: string; amount: number }[]
}

export interface DisbursementPreview {
  approvedAmount: number
  fees: { name: string; amount: number }[]
  feesTotal: number
  insurance: number
  savingsDeducted: number
  otherDeductions: { label: string; amount: number }[]
  netAmount: number
  warnings: string[]
  requiresDualAuthorisation: boolean
  dualAuthorisationThreshold: number
}

export interface LedgerEntry {
  id: string
  journal: string
  date: string
  account: string
  debit: number
  credit: number
  description: string
  reference: string
  loanId: string | null
  loanNumber: string | null
  createdBy: string
}

export interface LedgerData {
  entries: LedgerEntry[]
  accounts: { code: string; name: string; balance: number }[]
  reconciliation: {
    approvedAwaitingDisbursement: number
    disbursedPrincipal: number
    repaidPrincipal: number
    writtenOffPrincipal: number
    outstandingPrincipalLedger: number
    outstandingPrincipalLoans: number
    difference: number
  }
}

export interface Loan {
  id: string
  loanNumber: string
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

export type GroupMemberStatus = 'active' | 'inactive' | 'suspended' | 'left'
export type GroupStatus = 'pending' | 'active' | 'suspended' | 'closed'
export type GroupType = 'business' | 'women' | 'youth' | 'agriculture' | 'savings' | 'general'

export interface GroupMembership {
  id: string
  borrowerId: string
  borrowerName: string
  borrowerPhone: string
  customerNumber: string
  membershipNumber: string
  role: GroupMemberRole
  joinedOn: string
  status: GroupMemberStatus
  leftOn: string | null
  active: boolean
}

export interface GroupMeeting {
  id: string
  date: string
  location: string
  notes: string
  collectionAmount: number
  recordedBy: string
  createdAt: string
  attendance: { id: string; membershipId: string; present: boolean; contribution: number }[]
}

export interface GroupDetails {
  name: string
  branchId: string
  officerId: string
  groupType: GroupType
  purpose: string
  region: string
  district: string
  ward: string
  location: string
  meetingLocation: string
  meetingDay: string
  meetingFrequency: 'weekly' | 'biweekly' | 'monthly'
  meetingTime: string
  loanLimit: number
  formedOn: string
  status: GroupStatus
}

export interface BorrowerGroup extends GroupDetails {
  id: string
  groupNumber: string
  active: boolean
  createdAt: string
  memberships: GroupMembership[]
  documents: { id: string; name: string; type: string; uploadedAt: string }[]
  history: { id: string; date: string; label: string; detail: string; by: string }[]
  meetings: GroupMeeting[]
  savingsTotal: number
  contributionsTotal: number
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
  changes: Record<string, { before: unknown; after: unknown }>
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
  segments: number
  providerRef: string
  sentBy: string
  batch: string
  createdAt: string
  sentAt: string | null
}

export type PaymentNetwork = 'mpesa' | 'tigopesa' | 'airtel' | 'halopesa' | 'bank'

export interface PaymentTransaction {
  id: string
  reference: string
  direction: 'inbound' | 'outbound'
  network: PaymentNetwork
  provider: string
  providerRef: string
  phone: string
  amount: number
  borrowerId: string
  loanId: string | null
  applicationId: string | null
  repaymentId: string | null
  status: 'pending' | 'success' | 'failed'
  failureReason: string
  receipt: string
  initiatedByName: string
  createdAt: string
  completedAt: string | null
}

export interface Integrations {
  sms: { provider: string; simulated: boolean }
  payments: { provider: string; simulated: boolean; networks: Record<PaymentNetwork, string> }
}

export type CollectionActivityKind = 'call' | 'visit' | 'message' | 'note' | 'promise' | 'escalation'
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
