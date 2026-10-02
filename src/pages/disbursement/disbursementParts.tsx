import clsx from 'clsx'
import { Check, X } from 'lucide-react'
import type { BadgeTone } from '../../components/ui/Badge'
import type { DisbursementChannel, DisbursementStatus } from '../../types'

export const DISB_STATUS_LABEL: Record<DisbursementStatus, string> = {
  pending: 'Pending',
  under_verification: 'Under verification',
  approved: 'Approved',
  processing: 'Processing',
  successful: 'Successful',
  failed: 'Failed',
  cancelled: 'Cancelled',
  reversed: 'Reversed',
}

export const DISB_STATUS_TONE: Record<DisbursementStatus, BadgeTone> = {
  pending: 'slate',
  under_verification: 'amber',
  approved: 'blue',
  processing: 'violet',
  successful: 'green',
  failed: 'red',
  cancelled: 'slate',
  reversed: 'red',
}

export const METHOD_LABEL: Record<DisbursementChannel, string> = {
  bank_transfer: 'Bank transfer',
  mobile_money: 'Mobile money',
  cash: 'Cash',
  wallet: 'Internal wallet / savings account',
  supplier: 'Pay supplier directly',
}

export const METHOD_HINT: Record<DisbursementChannel, string> = {
  bank_transfer: 'Bank name, account holder and account number',
  mobile_money: 'Network and the registered phone number. Sent through the payment gateway',
  cash: 'Paid at the branch till against the borrower’s ID; record the voucher number',
  wallet: 'Credited to the borrower’s savings wallet with us',
  supplier: 'Paid to a supplier on the borrower’s written instruction',
}

export const NETWORKS: Record<string, string> = {
  mpesa: 'M-Pesa',
  tigopesa: 'Tigo Pesa',
  airtel: 'Airtel Money',
  halopesa: 'HaloPesa',
}

export const CHECK_LABELS: Record<string, string> = {
  loanApproved: 'Loan approved',
  borrowerVerified: 'Borrower verified',
  documentsComplete: 'Documents complete (ID & income evidence verified)',
  destinationVerified: 'Destination verified',
  netAmountPositive: 'Net amount is positive',
}

const FLOW: { id: DisbursementStatus; label: string }[] = [
  { id: 'pending', label: 'Prepared' },
  { id: 'under_verification', label: 'Verification' },
  { id: 'approved', label: 'Authorised' },
  { id: 'processing', label: 'Money released' },
  { id: 'successful', label: 'Transaction confirmed' },
]

export function DisbursementPipeline({ status }: { status: DisbursementStatus }) {
  const terminal = status === 'failed' || status === 'cancelled' || status === 'reversed'
  const reached: Record<DisbursementStatus, number> = {
    pending: 0, under_verification: 1, approved: 2, processing: 3, successful: 4,
    failed: 3, cancelled: 1, reversed: 5,
  }
  const at = reached[status]
  const steps = status === 'reversed' ? [...FLOW, { id: 'reversed' as const, label: 'Reversed' }] : FLOW
  return (
    <ol className="flex flex-wrap items-center gap-y-2">
      <li className="flex items-center">
        <span className="flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700">
          <Check size={12} /> Loan approved
        </span>
        <span className="mx-1 h-px w-5 bg-brand-300" />
      </li>
      {steps.map((s, i) => {
        const done = i < at || (status === 'successful' && i === at)
        const current = i === at && status !== 'successful'
        const bad = current && terminal
        return (
          <li key={s.id} className="flex items-center">
            <span
              className={clsx(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold',
                bad && 'bg-red-600 text-white',
                current && !bad && 'bg-brand-600 text-white',
                done && 'bg-brand-50 text-brand-700',
                !done && !current && 'bg-slate-100 text-slate-400',
              )}
            >
              {done ? <Check size={12} /> : bad ? <X size={12} /> : <span className="w-3 text-center">{i + 1}</span>}
              {bad ? DISB_STATUS_LABEL[status] : s.label}
            </span>
            {i < steps.length - 1 && <span className={clsx('mx-1 h-px w-5', done ? 'bg-brand-300' : 'bg-slate-200')} />}
          </li>
        )
      })}
    </ol>
  )
}
