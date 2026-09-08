import { create } from 'zustand'
import type {
  Application,
  AuditLogEntry,
  Borrower,
  Branch,
  CollectionActivity,
  CollectionActivityKind,
  CollectionOutcome,
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

export interface CurrentUser {
  id: string
  lenderId: string
  name: string
  email: string
  role: StaffRole
  branchId: string | null
  approvalLimit: number
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

  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => void

  updateLender: (patch: Partial<Lender>) => Promise<void>
  addBranch: (branch: Omit<Branch, 'id' | 'lenderId'>) => Promise<void>
  addStaff: (staff: Omit<Staff, 'id'> & { password: string }) => Promise<void>
  toggleStaffActive: (staffId: string) => Promise<void>
  addHoliday: (holiday: Omit<Holiday, 'id'>) => Promise<void>
  removeHoliday: (id: string) => Promise<void>

  addBorrower: (
    borrower: Omit<
      Borrower,
      'id' | 'guarantors' | 'documents' | 'createdAt' | 'history' | 'blacklisted' | 'blacklistReason'
    > & { guarantors?: { name: string; nationalId: string; phone: string }[] },
  ) => Promise<string>
  updateBorrower: (borrowerId: string, patch: Partial<Borrower>) => Promise<void>
  setBorrowerBlacklist: (borrowerId: string, blacklisted: boolean, reason: string | null) => Promise<void>
  uploadBorrowerDocument: (borrowerId: string, name: string, type: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>

  saveProduct: (product: LoanProduct) => Promise<void>
  toggleProductActive: (productId: string) => Promise<void>

  createApplication: (input: {
    borrowerId: string
    productId: string
    branchId: string
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
    })
    await refreshAudit()
  }

  return {
    status: 'loading',
    ...EMPTY,

    bootstrap: async () => {
      if (!getToken()) {
        set({ status: 'anonymous', ...EMPTY })
        return
      }
      try {
        const me = await api.get<CurrentUser>('/auth/me')
        set({ currentUser: me, currentStaffId: me.id })
        await hydrate()
        set({ status: 'ready' })
      } catch {
        setToken(null)
        set({ status: 'anonymous', ...EMPTY })
      }
    },

    login: async (email, password) => {
      const { accessToken } = await api.post<{ accessToken: string }>('/auth/login', { email, password })
      setToken(accessToken)
      set({ status: 'loading' })
      await get().bootstrap()
    },

    logout: () => {
      setToken(null)
      set({ status: 'anonymous', ...EMPTY })
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
  }
})
