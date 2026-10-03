import type { BadgeTone } from '../../components/ui/Badge'
import type { CollectionCaseStatus } from '../../types'

export const CASE_STATUS_LABEL: Record<CollectionCaseStatus, string> = {
  pending_follow_up: 'Pending follow-up',
  contacted: 'Contacted',
  promise_to_pay: 'Promise to pay',
  promise_kept: 'Promise kept',
  promise_broken: 'Promise broken',
  field_visit_required: 'Field visit required',
  under_review: 'Under review',
  escalated: 'Escalated',
  resolved: 'Resolved',
  paid: 'Paid',
}

export const CASE_STATUS_TONE: Record<CollectionCaseStatus, BadgeTone> = {
  pending_follow_up: 'amber',
  contacted: 'blue',
  promise_to_pay: 'violet',
  promise_kept: 'green',
  promise_broken: 'red',
  field_visit_required: 'amber',
  under_review: 'slate',
  escalated: 'red',
  resolved: 'green',
  paid: 'green',
}

export const STAGE_LABEL: Record<string, string> = {
  payment_due: 'Payment due',
  reminder: 'Reminder',
  overdue: 'Overdue',
  contact_attempt: 'Contact attempt',
  promise_to_pay: 'Promise to pay',
  follow_up: 'Follow-up',
  field_visit: 'Field visit',
  escalation: 'Escalation',
  resolution: 'Resolution',
}

export const CONTACT_METHODS = [
  { id: 'call', label: 'Phone call' },
  { id: 'message', label: 'SMS / WhatsApp' },
  { id: 'visit', label: 'In person' },
  { id: 'note', label: 'Internal note' },
] as const

export const OUTCOMES = [
  { id: 'reached', label: 'Reached / spoke to borrower' },
  { id: 'no_answer', label: 'No answer / not found' },
  { id: 'promised', label: 'Promised to pay' },
  { id: 'paid', label: 'Paid' },
  { id: 'disputed', label: 'Disputes the amount' },
  { id: 'other', label: 'Other' },
] as const
