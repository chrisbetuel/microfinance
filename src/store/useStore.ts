import { create } from 'zustand'
import type {
  Application,
  AuditLogEntry,
  Borrower,
  BorrowerGroup,
  BorrowerProfile,
  BorrowerStatus,
  Collateral,
  Integrations,
  PaymentNetwork,
  PaymentTransaction,
  GuarantorInput,
  Branch,
  CollectionActivity,
  CollectionActivityKind,
  CollectionOutcome,
  GroupMemberRole,
  DisbursementChannel,
  Holiday,
  Lender,
  Loan,
  LoanProduct,
  Notification,
  Repayment,
  Staff,
  StaffRole,
} from '../types'
import { api, ApiError, getToken, setToken } from '../lib/api'
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
  groups: BorrowerGroup[]
  collateral: Collateral[]
  payments: PaymentTransaction[]
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
    input: Pick<Collateral, 'assetType' | 'description' | 'estimatedValue' | 'ownerName' | 'ownershipDocument' | 'valuationDate'> & { loanId?: string | null },
  ) => Promise<void>
  sendSms: (input: { borrowerId?: string; to?: string; message: string }) => Promise<Notification>
  sendBulkSms: (input: BulkSmsInput) => Promise<{ batch: string; recipients: number; sent: number; failed: number }>
  refreshPayments: () => Promise<void>
  requestPayment: (input: { loanId: string; phone: string; amount: number; network: PaymentNetwork }) => Promise<PaymentTransaction>
  payout: (input: { applicationId: string; phone: string; network: PaymentNetwork }) => Promise<PaymentTransaction>
  simulatePayment: (id: string, outcome: 'success' | 'failed') => Promise<void>
  updateCollateral: (id: string, patch: Partial<Pick<Collateral, 'status' | 'estimatedValue' | 'valuationDate' | 'loanId'>>) => Promise<void>
  setBorrowerBlacklist: (borrowerId: string, blacklisted: boolean, reason: string | null) => Promise<void>
  uploadBorrowerDocument: (borrowerId: string, name: string, type: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>

  saveProduct: (product: LoanProduct) => Promise<void>
  toggleProductActive: (productId: string) => Promise<void>

  createApplication: (input: {
    borrowerId: string
    productId: string
    branchId: string
    groupId?: string | null
    amount: number
    termInstalments: number
    purpose: string
    declaredIncome: number
    declaredExpenses: number
    creditBureauConsent: boolean
    createdBy?: string
  }) => Promise<string>
  decideApplication: (applicationId: string, decision: 'approved' | 'declined', comment: string) => Promise<void>

  disburseLoan: (applicationId: string, channel: DisbursementChannel, reference: string) => Promise<void>
  disburseBatch: (
    items: { applicationId: string; channel: DisbursementChannel; reference: string }[],
  ) => Promise<{ disbursed: number; skipped: { applicationId: string; reason: string }[] }>

  recordRepayment: (loanId: string, amount: number, channel: Repayment['channel']) => Promise<Repayment>
  reverseRepayment: (repaymentId: string, reason: string) => Promise<void>
  settleLoan: (loanId: string, channel: Repayment['channel']) => Promise<void>
  writeOffLoan: (loanId: string, reason: string) => Promise<void>
  restructureLoan: (
    loanId: string,
    input: { newTerm: number; firstDueDate?: string | null; waivePenalties?: boolean; reason?: string },
  ) => Promise<void>

  logCollectionActivity: (
    loanId: string,
    input: {
      kind: CollectionActivityKind
      outcome?: CollectionOutcome
      note?: string
      promisedAmount?: number | null
      promisedDate?: string | null
    },
  ) => Promise<void>
  sendLoanReminder: (loanId: string) => Promise<void>

  createGroup: (input: {
    name: string
    branchId: string
    officerId: string
    meetingDay?: string
    meetingFrequency?: string
  }) => Promise<string>
  addGroupMember: (groupId: string, borrowerId: string, role: GroupMemberRole) => Promise<void>
  removeGroupMember: (groupId: string, membershipId: string) => Promise<void>
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
  groups: [],
  collateral: [],
  payments: [],
  integrations: null,
}

export const useStore = create<StoreState>()((set, get) => {
  // The API returns licenceExpiry as null when unset; the form inputs want a string.
  function normalizeLender(lender: Lender): Lender {
    return { ...lender, licenceExpiry: lender.licenceExpiry ?? '' }
  }

  async function refreshAudit() {
    try {
      set({ auditLog: await api.get<AuditLogEntry[]>('/audit') })
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 403) throw err
    }
    set({ notifications: await api.get<Notification[]>('/notifications') })
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
    await Promise.all([refreshAudit(), loadPayments()])
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

    payout: async (input) => {
      const tx = await api.post<PaymentTransaction>('/payments/payout', input)
      set((s) => ({ payments: [tx, ...s.payments] }))
      if (tx.status === 'failed') toast.error('Payout failed', tx.failureReason)
      else toast.success('Payout sent to gateway', `${tx.reference} — the loan opens once the transfer is confirmed`)
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
      const created = await api.post<Application>('/applications', {
        borrowerId: input.borrowerId,
        productId: input.productId,
        branchId: input.branchId,
        groupId: input.groupId ?? null,
        amount: input.amount,
        termInstalments: input.termInstalments,
        purpose: input.purpose,
        declaredIncome: input.declaredIncome,
        declaredExpenses: input.declaredExpenses,
        creditBureauConsent: input.creditBureauConsent,
      })
      set((s) => ({ applications: [created, ...s.applications] }))
      toast.success('Application submitted')
      await refreshAudit()
      return created.id
    },

    decideApplication: async (applicationId, decision, comment) => {
      const updated = await api.post<Application>(`/applications/${applicationId}/decision`, { decision, comment })
      set((s) => ({ applications: s.applications.map((a) => (a.id === applicationId ? updated : a)) }))
      toast.success(decision === 'approved' ? 'Application approved' : 'Application declined')
      await refreshAudit()
    },

    disburseLoan: async (applicationId, channel, reference) => {
      await api.post<Loan>(`/applications/${applicationId}/disburse`, { channel, reference })
      const [applications, loans] = await Promise.all([
        api.get<Application[]>('/applications'),
        api.get<Loan[]>('/loans'),
      ])
      set({ applications, loans })
      toast.success('Loan disbursed')
      await refreshAudit()
    },

    disburseBatch: async (items) => {
      const res = await api.post<{ disbursed: unknown[]; skipped: { applicationId: string; reason: string }[] }>(
        '/disbursement/batch',
        { items },
      )
      const [applications, loans] = await Promise.all([
        api.get<Application[]>('/applications'),
        api.get<Loan[]>('/loans'),
      ])
      set({ applications, loans })
      const disbursed = res.disbursed.length
      if (disbursed > 0) toast.success(`${disbursed} loan${disbursed > 1 ? 's' : ''} disbursed`)
      if (res.skipped.length > 0)
        toast.error(`${res.skipped.length} skipped`, res.skipped.map((s) => s.reason)[0])
      await refreshAudit()
      return { disbursed, skipped: res.skipped }
    },

    recordRepayment: async (loanId, amount, channel) => {
      const repayment = await api.post<Repayment>('/repayments', { loanId, amount, channel })
      const loans = await api.get<Loan[]>('/loans')
      set((s) => ({ repayments: [repayment, ...s.repayments], loans }))
      toast.success('Repayment recorded', repayment.receiptNumber)
      await refreshAudit()
      return repayment
    },

    reverseRepayment: async (repaymentId, reason) => {
      const updated = await api.post<Repayment>(`/repayments/${repaymentId}/reverse`, { reason })
      const loans = await api.get<Loan[]>('/loans')
      set((s) => ({ repayments: s.repayments.map((r) => (r.id === repaymentId ? updated : r)), loans }))
      toast.success('Repayment reversed')
      await refreshAudit()
    },

    settleLoan: async (loanId, channel) => {
      await api.post<Loan>(`/loans/${loanId}/settle`, { channel })
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
      toast.success(input.kind === 'promise' ? 'Promise to pay recorded' : 'Contact logged')
      await refreshAudit()
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
      toast.success('Member removed')
      await refreshAudit()
    },
  }
})
