import { create } from 'zustand'
import type {
  Application,
  ApplicationDocument,
  ApplicationInput,
  AssessmentResult,
  AuditLogEntry,
  Borrower,
  BorrowerGroup,
  BorrowerProfile,
  BorrowerStatus,
  Collateral,
  Integrations,
  LedgerData,
  PaymentNetwork,
  PaymentTransaction,
  Guarantor,
  GuarantorInput,
  Branch,
  CollectionActivity,
  CollectionActivityInput,
  CollectionCase,
  CollectionCaseStatus,
  CollectionDashboard,
  CollectionTimelineEvent,
  EligibilityCheck,
  GroupDetails,
  GroupMemberRole,
  GroupMemberStatus,
  Disbursement,
  DisbursementInput,
  DisbursementPreview,
  Holiday,
  Lender,
  Loan,
  LoanProduct,
  Notification,
  Repayment,
  RepaymentChannel,
  RepaymentInput,
  GroupPayment,
  StatementSource,
  ReconciliationData,
  Staff,
  StaffRole,
} from '../types'
import { api, ApiError, getToken, setToken } from '../lib/api'
import { NAV_ACCESS } from '../lib/permissions'
import { toast } from '../lib/toast'
import { cachedTimeoutMinutes, clearActivity, idleMs, markActivity } from '../lib/session'

export interface BulkSmsInput {
  audience: 'all' | 'active_loans' | 'overdue' | 'due_soon' | 'group' | 'custom'
  message: string
  branchId?: string | null
  groupId?: string | null
  borrowerIds?: string[]
  dueWithinDays?: number
  dryRun?: boolean
}

export interface CurrentUser {
  id: string
  lenderId: string
  name: string
  email: string
  role: StaffRole
  branchId: string | null
  approvalLimit: number
  phone: string
}

type LoadStatus = 'loading' | 'anonymous' | 'ready'

// Placeholder used only while the real lender profile is being fetched. The app
// shell does not render until status === 'ready', so screens always see real data.
const EMPTY_LENDER: Lender = {
  id: '',
  name: '',
  licenceNumber: '',
  licenceExpiry: '',
  address: '',
  phone: '',
  email: '',
  logoInitials: '',
  brandColor: '#EE0033',
  currency: 'TZS',
  language: 'sw',
  planLevel: 'starter',
  staffLimit: 0,
  activeLoanLimit: 0,
  smsBalance: 0,
  smsSenderName: '',
  smsSenderApproved: false,
  sessionTimeoutMinutes: 20,
  dualAuthorisationThreshold: 5_000_000,
  mobileMoneyNumber: '0618750312',
  mobileMoneyNetwork: '',
  mobileMoneyAccountName: '',
  collectionStages: ['payment_due', 'reminder', 'overdue', 'contact_attempt', 'promise_to_pay', 'follow_up', 'field_visit', 'escalation', 'resolution'],
}

interface StoreState {
  status: LoadStatus
  currentUser: CurrentUser | null
  currentStaffId: string

  lender: Lender
  branches: Branch[]
  staff: Staff[]
  holidays: Holiday[]
  products: LoanProduct[]
  borrowers: Borrower[]
  applications: Application[]
  loans: Loan[]
  repayments: Repayment[]
  auditLog: AuditLogEntry[]
  notifications: Notification[]
  collectionActivities: CollectionActivity[]
  collectionCases: CollectionCase[]
  groups: BorrowerGroup[]
  collateral: Collateral[]
  payments: PaymentTransaction[]
  disbursements: Disbursement[]
  integrations: Integrations | null

  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => void

  updateProfile: (patch: { name?: string; phone?: string }) => Promise<void>

  updateLender: (patch: Partial<Lender>) => Promise<void>
  addBranch: (branch: Omit<Branch, 'id' | 'lenderId'>) => Promise<void>
  addStaff: (staff: Omit<Staff, 'id'> & { password: string }) => Promise<void>
  updateStaff: (
    staffId: string,
    patch: { name?: string; role?: StaffRole; branchId?: string | null; approvalLimit?: number; phone?: string },
  ) => Promise<void>
  toggleStaffActive: (staffId: string) => Promise<void>
  addHoliday: (holiday: Omit<Holiday, 'id'>) => Promise<void>
  removeHoliday: (id: string) => Promise<void>

  addBorrower: (borrower: BorrowerProfile & { guarantors?: GuarantorInput[] }) => Promise<string>
  updateBorrower: (
    borrowerId: string,
    patch: Partial<BorrowerProfile> & { guarantors?: GuarantorInput[] },
  ) => Promise<void>
  setBorrowerStatus: (borrowerId: string, status: BorrowerStatus, reason?: string) => Promise<void>
  verifyBorrower: (borrowerId: string, verified: boolean, phoneVerified?: boolean) => Promise<void>
  addCollateral: (
    borrowerId: string,
    input: Pick<Collateral, 'assetType' | 'description' | 'estimatedValue' | 'ownerName' | 'ownershipDocument' | 'valuationDate'> &
      Partial<Pick<Collateral, 'valuedBy' | 'existingClaims' | 'documents'>> & { loanId?: string | null },
  ) => Promise<Collateral>
  addGuarantor: (borrowerId: string, input: GuarantorInput) => Promise<Guarantor>
  sendSms: (input: { borrowerId?: string; to?: string; message: string }) => Promise<Notification>
  sendBulkSms: (input: BulkSmsInput) => Promise<{ batch: string; recipients: number; sent: number; failed: number }>
  refreshPayments: () => Promise<void>
  requestPayment: (input: { loanId: string; phone: string; amount: number; network: PaymentNetwork }) => Promise<PaymentTransaction>
  simulatePayment: (id: string, outcome: 'success' | 'failed') => Promise<void>
  updateCollateral: (id: string, patch: Partial<Pick<Collateral, 'status' | 'estimatedValue' | 'valuationDate' | 'loanId'>>) => Promise<void>
  setBorrowerBlacklist: (borrowerId: string, blacklisted: boolean, reason: string | null) => Promise<void>
  uploadBorrowerDocument: (borrowerId: string, name: string, type: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>

  saveProduct: (product: LoanProduct) => Promise<void>
  toggleProductActive: (productId: string) => Promise<void>

  createApplication: (
    input: Partial<ApplicationInput> &
      Pick<ApplicationInput, 'borrowerId' | 'productId' | 'amount' | 'termInstalments' | 'purpose' | 'declaredIncome' | 'declaredExpenses' | 'creditBureauConsent'> & {
        draft?: boolean
        documents?: { type: string; name: string }[]
        createdBy?: string
      },
  ) => Promise<string>
  updateApplication: (applicationId: string, patch: Partial<ApplicationInput>) => Promise<void>
  submitApplication: (applicationId: string) => Promise<void>
  startAssessment: (applicationId: string) => Promise<void>
  saveAssessment: (
    applicationId: string,
    input: { result: AssessmentResult; assessedAmount: number; recommendedTerm: number; notes: string; forward: boolean },
  ) => Promise<void>
  decideApplication: (
    applicationId: string,
    decision: 'approved' | 'declined' | 'returned',
    comment: string,
    terms?: { approvedAmount?: number; approvedTerm?: number },
  ) => Promise<void>
  addApplicationDocument: (applicationId: string, type: string, name: string) => Promise<void>
  verifyApplicationDocument: (applicationId: string, documentId: string, status: ApplicationDocument['status'], note?: string) => Promise<void>

  refreshDisbursements: () => Promise<void>
  previewDisbursement: (input: DisbursementInput) => Promise<DisbursementPreview>
  prepareDisbursement: (input: DisbursementInput) => Promise<Disbursement>
  updateDisbursement: (id: string, patch: Partial<Omit<DisbursementInput, 'applicationId'>>) => Promise<void>
  disbursementAction: (
    id: string,
    action: 'submit' | 'verify' | 'authorise' | 'release' | 'confirm' | 'cancel' | 'reverse',
    body?: { destinationConfirmed?: boolean; overrideReason?: string; reference?: string; success?: boolean; reason?: string },
  ) => Promise<Disbursement>
  loadLedger: (loanId?: string) => Promise<LedgerData>

  recordRepayment: (input: RepaymentInput) => Promise<Repayment>
  reverseRepayment: (
    repaymentId: string,
    reason: string,
    corrected?: { amount: number; channel?: RepaymentChannel; paymentDate?: string; reference?: string; notes?: string } | null,
  ) => Promise<Repayment | null>
  settleLoan: (loanId: string, channel: RepaymentChannel, reference?: string) => Promise<void>
  recordGroupPayment: (
    groupId: string,
    input: { channel: RepaymentChannel; paymentDate: string; reference: string; collectionPoint: string; notes: string; contributions: { loanId: string; amount: number }[] },
  ) => Promise<GroupPayment>
  loadGroupPayments: (groupId: string) => Promise<GroupPayment[]>
  loadReconciliation: (source: StatementSource) => Promise<ReconciliationData>
  importStatement: (source: StatementSource, lines: { date: string; reference: string; amount: number; description: string }[]) => Promise<{ imported: number; matched: number; duplicates: number }>
  rematchStatement: (source: StatementSource) => Promise<number>
  statementLineAction: (lineId: string, action: 'match' | 'ignore' | 'unmatch', body?: { repaymentId?: string; note?: string }) => Promise<void>
  writeOffLoan: (loanId: string, reason: string) => Promise<void>
  restructureLoan: (
    loanId: string,
    input: { newTerm: number; firstDueDate?: string | null; waivePenalties?: boolean; reason?: string },
  ) => Promise<void>

  logCollectionActivity: (loanId: string, input: CollectionActivityInput) => Promise<void>
  refreshCollectionCases: () => Promise<void>
  loadCollectionDashboard: () => Promise<CollectionDashboard>
  updateCollectionCase: (
    caseId: string,
    patch: { assignedToId?: string | null; status?: CollectionCaseStatus; stage?: string; nextAction?: string; nextFollowUp?: string | null; resolutionNote?: string },
  ) => Promise<void>
  assignCollectionCases: (caseIds: string[], staffId: string) => Promise<void>
  loadCollectionTimeline: (loanId: string) => Promise<CollectionTimelineEvent[]>
  loadAuditPeriod: (from: string, to: string) => Promise<AuditLogEntry[]>
  loadEligibility: (input: { productId: string; borrowerId: string; amount: number; term: number; groupId?: string | null; income?: number }) => Promise<EligibilityCheck[]>
  sendLoanReminder: (loanId: string) => Promise<void>

  createGroup: (
    input: Partial<GroupDetails> & Pick<GroupDetails, 'name' | 'branchId' | 'officerId'> & {
      members?: { borrowerId: string; role: GroupMemberRole }[]
      documents?: { name: string; type: string }[]
    },
  ) => Promise<string>
  updateGroup: (groupId: string, patch: Partial<GroupDetails>) => Promise<void>
  addGroupMember: (groupId: string, borrowerId: string, role: GroupMemberRole) => Promise<void>
  updateGroupMember: (groupId: string, membershipId: string, patch: { role?: GroupMemberRole; status?: GroupMemberStatus }) => Promise<void>
  removeGroupMember: (groupId: string, membershipId: string) => Promise<void>
  recordGroupMeeting: (
    groupId: string,
    input: { date: string; location?: string; notes?: string; attendance: { membershipId: string; present: boolean; contribution: number }[] },
  ) => Promise<void>
  addGroupDocument: (groupId: string, name: string, type: string) => Promise<void>
}

const EMPTY = {
  currentUser: null,
  currentStaffId: '',
  lender: EMPTY_LENDER,
  branches: [],
  staff: [],
  holidays: [],
  products: [],
  borrowers: [],
  applications: [],
  loans: [],
  repayments: [],
  auditLog: [],
  notifications: [],
  collectionActivities: [],
  collectionCases: [],
  groups: [],
  collateral: [],
  payments: [],
  disbursements: [],
  integrations: null,
}

export const useStore = create<StoreState>()((set, get) => {
  // The API returns licenceExpiry as null when unset; the form inputs want a string.
  function normalizeLender(lender: Lender): Lender {
    return {
      ...lender,
      licenceExpiry: lender.licenceExpiry ?? '',
      collectionStages: lender.collectionStages?.length ? lender.collectionStages : EMPTY_LENDER.collectionStages,
    }
  }

  async function refreshAudit() {
    const me = get().staff.find((m) => m.id === get().currentStaffId)
    try {
      // only roles with the Security & Audit page may read the log
      if (me && !NAV_ACCESS[me.role].includes('/security')) throw new ApiError(403, 'forbidden')
      set({ auditLog: await api.get<AuditLogEntry[]>('/audit') })
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 403) throw err
    }
    set({ notifications: await api.get<Notification[]>('/notifications') })
  }

  async function loadDisbursements() {
    const disbursements = await api.get<Disbursement[]>('/disbursements').catch(() => [] as Disbursement[])
    set({ disbursements })
  }

  async function loadCollectionCases() {
    const collectionCases = await api.get<CollectionCase[]>('/collections/cases').catch(() => [] as CollectionCase[])
    set({ collectionCases })
  }

  async function loadPayments() {
    const [payments, integrations] = await Promise.all([
      api.get<PaymentTransaction[]>('/payments').catch(() => [] as PaymentTransaction[]),
      api.get<Integrations>('/integrations').catch(() => null),
    ])
    set({ payments, integrations })
  }

  async function hydrate() {
    const [
      lender,
      branches,
      staff,
      holidays,
      products,
      borrowers,
      applications,
      loans,
      repayments,
      notifications,
      collectionActivities,
      groups,
      collateral,
    ] = await Promise.all([
      api.get<Lender>('/lender'),
      api.get<Branch[]>('/branches'),
      api.get<Staff[]>('/staff'),
      api.get<Holiday[]>('/holidays'),
      api.get<LoanProduct[]>('/products'),
      api.get<Borrower[]>('/borrowers'),
      api.get<Application[]>('/applications'),
      api.get<Loan[]>('/loans'),
      api.get<Repayment[]>('/repayments'),
      api.get<Notification[]>('/notifications'),
      api.get<CollectionActivity[]>('/collection-activities'),
      api.get<BorrowerGroup[]>('/groups'),
      api.get<Collateral[]>('/collateral'),
    ])
    set({
      lender: normalizeLender(lender),
      branches,
      staff,
      holidays,
      products,
      borrowers,
      applications,
      loans,
      repayments,
      notifications,
      collectionActivities,
      groups,
      collateral,
    })
    await Promise.all([refreshAudit(), loadPayments(), loadDisbursements(), loadCollectionCases()])
  }

  return {
    status: 'loading',
    ...EMPTY,

    bootstrap: async () => {
      if (!getToken()) {
        set({ status: 'anonymous', ...EMPTY })
        return
      }
      // Been idle past the timeout since the tab was last open? Don't restore.
      if (idleMs() >= cachedTimeoutMinutes() * 60_000) {
        setToken(null)
        clearActivity()
        set({ status: 'anonymous', ...EMPTY })
        return
      }
      try {
        const me = await api.get<CurrentUser>('/auth/me')
        set({ currentUser: me, currentStaffId: me.id })
        await hydrate()
        markActivity()
        set({ status: 'ready' })
      } catch {
        setToken(null)
        set({ status: 'anonymous', ...EMPTY })
      }
    },

    login: async (email, password) => {
      const { accessToken } = await api.post<{ accessToken: string }>('/auth/login', { email, password })
      setToken(accessToken)
      markActivity()
      set({ status: 'loading' })
      await get().bootstrap()
    },

    logout: () => {
      setToken(null)
      clearActivity()
      set({ status: 'anonymous', ...EMPTY })
    },

    updateProfile: async (patch) => {
      const me = await api.patch<CurrentUser>('/auth/me', patch)
      set((s) => ({
        currentUser: me,
        staff: s.staff.map((m) => (m.id === me.id ? { ...m, name: me.name, phone: me.phone } : m)),
      }))
      toast.success('Profile updated')
    },

    updateLender: async (patch) => {
      const body: Record<string, unknown> = { ...patch }
      if (body.licenceExpiry === '') body.licenceExpiry = null
      const lender = await api.patch<Lender>('/lender', body)
      set({ lender: normalizeLender(lender) })
      toast.success('Lender profile updated')
      await refreshAudit()
    },

    addBranch: async (branch) => {
      const created = await api.post<Branch>('/branches', branch)
      set((s) => ({ branches: [...s.branches, created] }))
      toast.success('Branch added', created.name)
      await refreshAudit()
    },

    addStaff: async (staff) => {
      const created = await api.post<Staff>('/staff', staff)
      set((s) => ({ staff: [...s.staff, created] }))
      toast.success('Staff member added', created.name)
      await refreshAudit()
    },

    updateStaff: async (staffId, patch) => {
      const updated = await api.patch<Staff>(`/staff/${staffId}`, patch)
      set((s) => ({ staff: s.staff.map((m) => (m.id === staffId ? updated : m)) }))
      toast.success('Staff account updated', updated.name)
      await refreshAudit()
    },

    toggleStaffActive: async (staffId) => {
      const current = get().staff.find((s) => s.id === staffId)
      if (!current) return
      const updated = await api.patch<Staff>(`/staff/${staffId}`, { active: !current.active })
      set((s) => ({ staff: s.staff.map((m) => (m.id === staffId ? updated : m)) }))
      await refreshAudit()
    },

    addHoliday: async (holiday) => {
      const created = await api.post<Holiday>('/holidays', holiday)
      set((s) => ({ holidays: [...s.holidays, created] }))
      await refreshAudit()
    },

    removeHoliday: async (id) => {
      await api.del(`/holidays/${id}`)
      set((s) => ({ holidays: s.holidays.filter((h) => h.id !== id) }))
      await refreshAudit()
    },

    addBorrower: async (borrower) => {
      const created = await api.post<Borrower>('/borrowers', borrower)
      set((s) => ({ borrowers: [created, ...s.borrowers] }))
      toast.success('Borrower registered', created.fullName)
      await refreshAudit()
      return created.id
    },

    updateBorrower: async (borrowerId, patch) => {
      const updated = await api.patch<Borrower>(`/borrowers/${borrowerId}`, patch)
      set((s) => ({ borrowers: s.borrowers.map((b) => (b.id === borrowerId ? updated : b)) }))
      toast.success('Borrower updated', updated.fullName)
      await refreshAudit()
    },

    verifyBorrower: async (borrowerId, verified, phoneVerified) => {
      const updated = await api.post<Borrower>('/borrowers/' + borrowerId + '/verify', { verified, phoneVerified })
      set((s) => ({ borrowers: s.borrowers.map((b) => (b.id === borrowerId ? updated : b)) }))
      toast.success(verified ? 'Borrower verified' : 'Verification removed')
      await refreshAudit()
    },

    addCollateral: async (borrowerId, input) => {
      const created = await api.post<Collateral>('/borrowers/' + borrowerId + '/collateral', input)
      const borrower = await api.get<Borrower>('/borrowers/' + borrowerId)
      set((s) => ({
        collateral: [created, ...s.collateral],
        borrowers: s.borrowers.map((b) => (b.id === borrowerId ? borrower : b)),
      }))
      toast.success('Collateral recorded', created.description)
      await refreshAudit()
      return created
    },

    addGuarantor: async (borrowerId, input) => {
      const created = await api.post<Guarantor>('/borrowers/' + borrowerId + '/guarantors', input)
      const borrower = await api.get<Borrower>('/borrowers/' + borrowerId)
      set((s) => ({ borrowers: s.borrowers.map((b) => (b.id === borrowerId ? borrower : b)) }))
      toast.success('Guarantor added', created.name)
      return created
    },

    sendSms: async (input) => {
      const n = await api.post<Notification>('/sms/send', input)
      set((s) => ({ notifications: [n, ...s.notifications] }))
      const lender = await api.get<Lender>('/lender')
      set({ lender: normalizeLender(lender) })
      if (n.status === 'sent') toast.success('SMS sent', n.to)
      else toast.error('SMS not sent', n.error)
      return n
    },

    sendBulkSms: async (input) => {
      const res = await api.post<{ batch: string; recipients: number; sent: number; failed: number }>('/sms/bulk', input)
      const [notifications, lender] = await Promise.all([api.get<Notification[]>('/notifications'), api.get<Lender>('/lender')])
      set({ notifications, lender: normalizeLender(lender) })
      toast.success(`Bulk SMS: ${res.sent} sent`, res.failed ? `${res.failed} failed` : res.batch)
      await refreshAudit()
      return res
    },

    refreshPayments: async () => {
      await loadPayments()
    },

    requestPayment: async (input) => {
      const tx = await api.post<PaymentTransaction>('/payments/collect', input)
      set((s) => ({ payments: [tx, ...s.payments] }))
      if (tx.status === 'failed') toast.error('Payment request failed', tx.failureReason)
      else toast.success('Payment request sent', `${tx.reference} — waiting for the customer to approve`)
      return tx
    },

    simulatePayment: async (id, outcome) => {
      const tx = await api.post<PaymentTransaction>('/payments/' + id + '/simulate', { outcome })
      const [loans, repayments, applications] = await Promise.all([
        api.get<Loan[]>('/loans'),
        api.get<Repayment[]>('/repayments'),
        api.get<Application[]>('/applications'),
      ])
      set((s) => ({ payments: s.payments.map((p) => (p.id === id ? tx : p)), loans, repayments, applications }))
      if (tx.direction === 'outbound') await loadDisbursements()
      if (tx.status === 'success') toast.success(tx.direction === 'inbound' ? 'Payment received' : 'Payout confirmed — loan opened', tx.receipt)
      else toast.error('Payment failed', tx.failureReason)
      await refreshAudit()
    },

    updateCollateral: async (id, patch) => {
      const updated = await api.patch<Collateral>('/collateral/' + id, patch)
      set((s) => ({ collateral: s.collateral.map((c) => (c.id === id ? updated : c)) }))
      toast.success('Collateral updated')
      await refreshAudit()
    },

    setBorrowerStatus: async (borrowerId, status, reason) => {
      const updated = await api.post<Borrower>(`/borrowers/${borrowerId}/status`, { status, reason: reason ?? '' })
      set((s) => ({ borrowers: s.borrowers.map((b) => (b.id === borrowerId ? updated : b)) }))
      toast.success(`Borrower set to ${status}`)
      await refreshAudit()
    },

    setBorrowerBlacklist: async (borrowerId, blacklisted, reason) => {
      const updated = await api.post<Borrower>(`/borrowers/${borrowerId}/blacklist`, { blacklisted, reason })
      set((s) => ({ borrowers: s.borrowers.map((b) => (b.id === borrowerId ? updated : b)) }))
      toast.success(blacklisted ? 'Borrower blacklisted' : 'Borrower removed from blacklist')
      await refreshAudit()
    },

    uploadBorrowerDocument: async (borrowerId, name, type) => {
      await api.post(`/borrowers/${borrowerId}/documents`, { name, type })
      const updated = await api.get<Borrower>(`/borrowers/${borrowerId}`)
      set((s) => ({ borrowers: s.borrowers.map((b) => (b.id === borrowerId ? updated : b)) }))
      toast.success('Document attached', name)
      await refreshAudit()
    },

    changePassword: async (currentPassword, newPassword) => {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      toast.success('Password changed')
    },

    saveProduct: async (product) => {
      const exists = get().products.some((p) => p.id === product.id)
      const saved = exists
        ? await api.put<LoanProduct>(`/products/${product.id}`, product)
        : await api.post<LoanProduct>('/products', product)
      set((s) => ({
        products: s.products.some((p) => p.id === saved.id)
          ? s.products.map((p) => (p.id === saved.id ? saved : p))
          : [...s.products, saved],
      }))
      toast.success(exists ? 'Product updated' : 'Product created', saved.name)
      await refreshAudit()
    },

    toggleProductActive: async (productId) => {
      const current = get().products.find((p) => p.id === productId)
      if (!current) return
      const updated = await api.patch<LoanProduct>(`/products/${productId}`, { active: !current.active })
      set((s) => ({ products: s.products.map((p) => (p.id === productId ? updated : p)) }))
      await refreshAudit()
    },

    createApplication: async (input) => {
      const { createdBy: _createdBy, ...body } = input
      const created = await api.post<Application>('/applications', { ...body, groupId: input.groupId ?? null })
      set((s) => ({ applications: [created, ...s.applications] }))
      toast.success(input.draft ? 'Draft saved' : 'Application submitted', created.reference)
      await refreshAudit()
      return created.id
    },

    updateApplication: async (applicationId, patch) => {
      const updated = await api.patch<Application>(`/applications/${applicationId}`, patch)
      set((s) => ({ applications: s.applications.map((a) => (a.id === applicationId ? updated : a)) }))
      toast.success('Application updated', updated.reference)
      await refreshAudit()
    },

    submitApplication: async (applicationId) => {
      const updated = await api.post<Application>(`/applications/${applicationId}/submit`)
      set((s) => ({ applications: s.applications.map((a) => (a.id === applicationId ? updated : a)) }))
      toast.success('Application submitted', updated.reference)
      await refreshAudit()
    },

    startAssessment: async (applicationId) => {
      const updated = await api.post<Application>(`/applications/${applicationId}/start-assessment`)
      set((s) => ({ applications: s.applications.map((a) => (a.id === applicationId ? updated : a)) }))
      toast.success('Assessment started')
    },

    saveAssessment: async (applicationId, input) => {
      const updated = await api.post<Application>(`/applications/${applicationId}/assessment`, input)
      set((s) => ({ applications: s.applications.map((a) => (a.id === applicationId ? updated : a)) }))
      toast.success(input.forward ? 'Forwarded for approval' : 'Assessment saved')
      await refreshAudit()
    },

    decideApplication: async (applicationId, decision, comment, terms) => {
      const updated = await api.post<Application>(`/applications/${applicationId}/decision`, { decision, comment, ...terms })
      set((s) => ({ applications: s.applications.map((a) => (a.id === applicationId ? updated : a)) }))
      toast.success(
        decision === 'approved' ? 'Application approved' : decision === 'declined' ? 'Application declined' : 'Returned for further review',
      )
      await refreshAudit()
    },

    addApplicationDocument: async (applicationId, type, name) => {
      const updated = await api.post<Application>(`/applications/${applicationId}/documents`, { type, name })
      set((s) => ({ applications: s.applications.map((a) => (a.id === applicationId ? updated : a)) }))
      toast.success('Document attached', name)
    },

    verifyApplicationDocument: async (applicationId, documentId, status, note = '') => {
      const updated = await api.patch<Application>(`/applications/${applicationId}/documents/${documentId}`, { status, note })
      set((s) => ({ applications: s.applications.map((a) => (a.id === applicationId ? updated : a)) }))
      toast.success(status === 'verified' ? 'Document verified' : status === 'rejected' ? 'Document rejected' : 'Document reset')
    },

    refreshDisbursements: loadDisbursements,

    previewDisbursement: (input) => api.post<DisbursementPreview>('/disbursements/preview', input),

    prepareDisbursement: async (input) => {
      const d = await api.post<Disbursement>('/disbursements', input)
      set((st) => ({ disbursements: [d, ...st.disbursements] }))
      toast.success(`${d.number} prepared`, 'Send it for verification when ready')
      await refreshAudit()
      return d
    },

    updateDisbursement: async (id, patch) => {
      const d = await api.patch<Disbursement>(`/disbursements/${id}`, patch)
      set((st) => ({ disbursements: st.disbursements.map((x) => (x.id === id ? d : x)) }))
      toast.success(`${d.number} updated`, 'Verification and authorisation start again')
      await refreshAudit()
    },

    disbursementAction: async (id, action, body = {}) => {
      const d = await api.post<Disbursement>(`/disbursements/${id}/${action}`, body)
      set((st) => ({ disbursements: st.disbursements.map((x) => (x.id === id ? d : x)) }))
      if (['successful', 'reversed', 'failed', 'processing'].includes(d.status)) {
        const [applications, loans, collateral, payments] = await Promise.all([
          api.get<Application[]>('/applications'),
          api.get<Loan[]>('/loans'),
          api.get<Collateral[]>('/collateral'),
          api.get<PaymentTransaction[]>('/payments').catch(() => get().payments),
        ])
        set({ applications, loans, collateral, payments })
      }
      const messages: Record<string, [string, string?]> = {
        submit: ['Sent for verification'],
        verify: ['Verified', 'Ready for authorisation'],
        authorise: d.status === 'approved' ? ['Authorised for release'] : ['First authorisation recorded', 'A second authoriser is required'],
        release: d.status === 'failed' ? ['Transfer rejected', d.failureReason] : ['Money released', d.method === 'mobile_money' ? 'Waiting for the gateway to confirm' : 'Confirm once the transaction goes through'],
        confirm: d.status === 'successful' ? [`Loan ${d.loanNumber} is active`, 'Repayment schedule started'] : ['Marked as failed', d.failureReason],
        cancel: ['Disbursement cancelled'],
        reverse: ['Disbursement reversed', 'The application is back to approved'],
      }
      const [title, detail] = messages[action]
      if (d.status === 'failed') toast.error(title, detail)
      else toast.success(title, detail)
      await refreshAudit()
      return d
    },

    loadLedger: (loanId) => api.get<LedgerData>(loanId ? `/ledger?loanId=${loanId}` : '/ledger'),

    recordRepayment: async (input) => {
      const repayment = await api.post<Repayment>('/repayments', input)
      const loans = await api.get<Loan[]>('/loans')
      set((s) => ({ repayments: [repayment, ...s.repayments], loans }))
      toast.success('Repayment recorded', repayment.receiptNumber)
      await refreshAudit()
      return repayment
    },

    reverseRepayment: async (repaymentId, reason, corrected) => {
      const updated = await api.post<Repayment & { corrected?: Repayment }>(`/repayments/${repaymentId}/reverse`, { reason, corrected: corrected ?? null })
      const [loans, repayments] = await Promise.all([api.get<Loan[]>('/loans'), api.get<Repayment[]>('/repayments')])
      set({ loans, repayments })
      toast.success(updated.corrected ? 'Reversed and corrected' : 'Repayment reversed', updated.corrected?.receiptNumber)
      await refreshAudit()
      return updated.corrected ?? null
    },

    recordGroupPayment: async (groupId, input) => {
      const gp = await api.post<GroupPayment>(`/groups/${groupId}/payments`, input)
      const [loans, repayments] = await Promise.all([api.get<Loan[]>('/loans'), api.get<Repayment[]>('/repayments')])
      set({ loans, repayments })
      toast.success(`Group payment ${gp.number} recorded`, `${input.contributions.filter((c) => c.amount > 0).length} member contribution(s)`)
      await refreshAudit()
      return gp
    },

    loadGroupPayments: (groupId) => api.get<GroupPayment[]>(`/groups/${groupId}/payments`),

    loadReconciliation: (source) => api.get<ReconciliationData>(`/reconciliation?source=${source}`),

    importStatement: async (source, lines) => {
      const res = await api.post<{ imported: number; matched: number; duplicates: number }>('/reconciliation/import', { source, lines })
      set({ repayments: await api.get<Repayment[]>('/repayments') })
      toast.success(`${res.imported} line(s) imported`, `${res.matched} matched automatically${res.duplicates ? `, ${res.duplicates} duplicate(s) skipped` : ''}`)
      await refreshAudit()
      return res
    },

    rematchStatement: async (source) => {
      const res = await api.post<{ matched: number }>('/reconciliation/rematch', { source })
      set({ repayments: await api.get<Repayment[]>('/repayments') })
      toast.success(`${res.matched} more line(s) matched`)
      return res.matched
    },

    statementLineAction: async (lineId, action, body = {}) => {
      await api.post(`/reconciliation/lines/${lineId}/${action}`, body)
      set({ repayments: await api.get<Repayment[]>('/repayments') })
      toast.success(action === 'match' ? 'Matched' : action === 'ignore' ? 'Marked as not a repayment' : 'Match removed')
      await refreshAudit()
    },

    settleLoan: async (loanId, channel, reference = '') => {
      await api.post<Loan>(`/loans/${loanId}/settle`, { channel, reference })
      const [loans, repayments] = await Promise.all([
        api.get<Loan[]>('/loans'),
        api.get<Repayment[]>('/repayments'),
      ])
      set({ loans, repayments })
      toast.success('Loan settled early')
      await refreshAudit()
    },

    writeOffLoan: async (loanId, reason) => {
      await api.post<Loan>(`/loans/${loanId}/write-off`, { reason })
      const [loans, borrowers] = await Promise.all([
        api.get<Loan[]>('/loans'),
        api.get<Borrower[]>('/borrowers'),
      ])
      set({ loans, borrowers })
      toast.success('Loan written off')
      await refreshAudit()
    },

    restructureLoan: async (loanId, input) => {
      await api.post<Loan>(`/loans/${loanId}/restructure`, input)
      const [loans, repayments, borrowers] = await Promise.all([
        api.get<Loan[]>('/loans'),
        api.get<Repayment[]>('/repayments'),
        api.get<Borrower[]>('/borrowers'),
      ])
      set({ loans, repayments, borrowers })
      toast.success('Loan restructured')
      await refreshAudit()
    },

    logCollectionActivity: async (loanId, input) => {
      const created = await api.post<CollectionActivity>(`/loans/${loanId}/collection-activities`, input)
      set((s) => ({ collectionActivities: [created, ...s.collectionActivities] }))
      if (input.payment) {
        const [loans, repayments] = await Promise.all([api.get<Loan[]>('/loans'), api.get<Repayment[]>('/repayments')])
        set({ loans, repayments })
      }
      await loadCollectionCases()
      toast.success(
        input.kind === 'promise' ? 'Promise to pay recorded' : input.kind === 'visit' ? (input.visitStatus === 'scheduled' ? 'Field visit scheduled' : 'Field visit recorded') : input.kind === 'escalation' ? 'Case escalated' : 'Contact logged',
        input.payment ? `Payment of ${input.payment.amount.toLocaleString()} recorded with its own receipt` : undefined,
      )
      await refreshAudit()
    },

    refreshCollectionCases: loadCollectionCases,

    loadCollectionDashboard: () => api.get<CollectionDashboard>('/collections/dashboard'),

    updateCollectionCase: async (caseId, patch) => {
      const updated = await api.patch<CollectionCase>(`/collections/cases/${caseId}`, patch)
      set((s) => ({ collectionCases: s.collectionCases.map((c) => (c.id === caseId ? updated : c)) }))
      toast.success('Case updated', updated.number)
      await refreshAudit()
    },

    assignCollectionCases: async (caseIds, staffId) => {
      await api.post('/collections/cases/assign', { caseIds, staffId })
      await loadCollectionCases()
      toast.success(`${caseIds.length} case(s) assigned`)
      await refreshAudit()
    },

    loadCollectionTimeline: (loanId) => api.get<CollectionTimelineEvent[]>(`/loans/${loanId}/collection-timeline`),

    loadAuditPeriod: (from, to) => {
      const q = new URLSearchParams({ limit: '10000' })
      if (from) q.set('from', from)
      if (to) q.set('to', to)
      return api.get<AuditLogEntry[]>(`/audit?${q}`)
    },

    loadEligibility: ({ productId, borrowerId, amount, term, groupId, income }) => {
      const q = new URLSearchParams({ borrowerId, amount: String(amount), term: String(term) })
      if (groupId) q.set('groupId', groupId)
      if (income != null) q.set('income', String(income))
      return api.get<EligibilityCheck[]>(`/products/${productId}/eligibility?${q}`)
    },

    sendLoanReminder: async (loanId) => {
      await api.post(`/loans/${loanId}/send-reminder`, {})
      const [collectionActivities, notifications] = await Promise.all([
        api.get<CollectionActivity[]>('/collection-activities'),
        api.get<Notification[]>('/notifications'),
      ])
      set({ collectionActivities, notifications })
      toast.success('Arrears reminder sent')
      await refreshAudit()
    },

    createGroup: async (input) => {
      const created = await api.post<BorrowerGroup>('/groups', input)
      set((s) => ({ groups: [...s.groups, created] }))
      toast.success('Group formed', created.name)
      await refreshAudit()
      return created.id
    },

    addGroupMember: async (groupId, borrowerId, role) => {
      const updated = await api.post<BorrowerGroup>(`/groups/${groupId}/members`, { borrowerId, role })
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? updated : g)) }))
      toast.success('Member added')
      await refreshAudit()
    },

    removeGroupMember: async (groupId, membershipId) => {
      const updated = await api.del<BorrowerGroup>(`/groups/${groupId}/members/${membershipId}`)
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? updated : g)) }))
      toast.success('Member marked as left')
      await refreshAudit()
    },

    updateGroup: async (groupId, patch) => {
      const updated = await api.patch<BorrowerGroup>(`/groups/${groupId}`, patch)
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? updated : g)) }))
      toast.success('Group updated', updated.name)
      await refreshAudit()
    },

    updateGroupMember: async (groupId, membershipId, patch) => {
      const updated = await api.patch<BorrowerGroup>(`/groups/${groupId}/members/${membershipId}`, patch)
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? updated : g)) }))
      toast.success('Member updated')
      await refreshAudit()
    },

    recordGroupMeeting: async (groupId, input) => {
      const updated = await api.post<BorrowerGroup>(`/groups/${groupId}/meetings`, input)
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? updated : g)) }))
      toast.success('Meeting recorded')
      await refreshAudit()
    },

    addGroupDocument: async (groupId, name, type) => {
      const updated = await api.post<BorrowerGroup>(`/groups/${groupId}/documents`, { name, type })
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? updated : g)) }))
      toast.success('Document attached', name)
    },
  }
})
