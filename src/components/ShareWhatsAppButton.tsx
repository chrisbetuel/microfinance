import { useState } from 'react'
import { useStore } from '../store/useStore'
import { Button } from './ui/Button'
import { toast } from '../lib/toast'
import { borrowerStatementPdf, shareOnWhatsApp } from '../lib/statementPdf'

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm5.8 14.13c-.24.68-1.42 1.3-1.95 1.34-.5.05-1.13.07-1.82-.11a16.7 16.7 0 0 1-1.65-.61c-2.9-1.25-4.79-4.17-4.94-4.36-.14-.2-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.27-.29.58-.36.78-.36h.56c.18 0 .42-.07.66.5.24.58.83 2 .9 2.15.07.14.12.32.02.51-.1.2-.14.32-.29.49l-.43.5c-.14.14-.29.3-.12.6.17.29.75 1.24 1.61 2.01 1.11.99 2.04 1.3 2.33 1.44.29.15.46.12.63-.07.17-.2.73-.85.92-1.14.2-.29.39-.24.66-.15.27.1 1.7.8 1.99.95.29.14.49.22.56.34.07.12.07.7-.17 1.38Z" />
    </svg>
  )
}

/** Builds the borrower's statement PDF and sends it to them on WhatsApp. */
export function ShareWhatsAppButton({ borrowerId }: { borrowerId: string }) {
  const borrower = useStore((s) => s.borrowers.find((b) => b.id === borrowerId))
  const lender = useStore((s) => s.lender)
  const loans = useStore((s) => s.loans)
  const repayments = useStore((s) => s.repayments)
  const [busy, setBusy] = useState(false)
  if (!borrower) return null

  return (
    <Button
      variant="secondary"
      icon={<WhatsAppIcon />}
      disabled={busy || !borrower.phone}
      onClick={async () => {
        setBusy(true)
        try {
          const blob = borrowerStatementPdf({ lender, borrower, loans: loans.filter((l) => l.borrowerId === borrower.id), repayments })
          const filename = `${borrower.customerNumber}-statement-${new Date().toLocaleDateString('en-CA')}.pdf`
          const message =
            `Habari ${borrower.fullName.split(' ')[0]}, this is your loan statement from ${lender.name}.` +
            (lender.mobileMoneyNumber ? ` To repay by mobile money, send to ${lender.mobileMoneyNumber} and use your loan number as the reference.` : '')
          const how = await shareOnWhatsApp({ blob, filename, phone: borrower.phone, message })
          if (how === 'downloaded') toast.success('Statement downloaded', `Attach ${filename} in the WhatsApp chat that just opened`)
        } catch (e) {
          toast.error('Could not create the statement', e instanceof Error ? e.message : undefined)
        } finally {
          setBusy(false)
        }
      }}
    >
      Share via WhatsApp
    </Button>
  )
}
