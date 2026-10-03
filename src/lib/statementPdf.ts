import { jsPDF } from 'jspdf'
import type { Borrower, Lender, Loan, Repayment } from '../types'

const BRAND: [number, number, number] = [20, 112, 93]

/** "0712 345 678" / "+255 712…" → "255712345678" for wa.me links (Tanzania default). */
export function whatsappNumber(phone: string): string {
  const d = (phone || '').replace(/\D/g, '')
  if (d.startsWith('255')) return d
  if (d.startsWith('0')) return `255${d.slice(1)}`
  return d.length === 9 ? `255${d}` : d
}

const money = (n: number, cur: string) => `${cur} ${Math.round(n).toLocaleString('en-US')}`
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-')

/** The borrower's details and loan statement as a PDF file. */
export function borrowerStatementPdf(opts: { lender: Lender; borrower: Borrower; loans: Loan[]; repayments: Repayment[] }): Blob {
  const { lender, borrower } = opts
  const cur = lender.currency
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  let y = 0

  const header = () => {
    doc.setFillColor(...BRAND)
    doc.rect(0, 0, W, 24, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold').setFontSize(14).text(lender.name, 14, 11)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).text([lender.address, lender.phone, lender.email].filter(Boolean).join('  ·  '), 14, 17)
    doc.setFontSize(9).text(`Statement · ${fmtDate(new Date().toISOString())}`, W - 14, 11, { align: 'right' })
    doc.setTextColor(17, 17, 17)
    y = 32
  }
  const ensure = (need: number) => {
    if (y + need > H - 18) {
      doc.addPage()
      header()
    }
  }
  const heading = (t: string) => {
    ensure(14)
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...BRAND).text(t, 14, y)
    doc.setDrawColor(...BRAND).line(14, y + 1.5, W - 14, y + 1.5)
    doc.setTextColor(17, 17, 17)
    y += 7
  }
  const pairs = (rows: [string, string][]) => {
    doc.setFontSize(9)
    rows.forEach(([k, v], i) => {
      const x = i % 2 === 0 ? 14 : W / 2 + 2
      if (i % 2 === 0) ensure(6)
      doc.setFont('helvetica', 'normal').setTextColor(110, 110, 110).text(k, x, y)
      doc.setFont('helvetica', 'bold').setTextColor(17, 17, 17).text(String(v || '-').slice(0, 48), x + 34, y)
      if (i % 2 === 1 || i === rows.length - 1) y += 5.5
    })
    y += 2
  }
  const table = (headers: string[], widths: number[], rows: string[][], alignRight: number[] = []) => {
    const draw = (cells: string[], bold: boolean, fill?: [number, number, number]) => {
      ensure(7)
      if (fill) {
        doc.setFillColor(...fill)
        doc.rect(14, y - 4.2, W - 28, 6, 'F')
      }
      doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(8)
      let x = 15
      cells.forEach((c, i) => {
        const right = alignRight.includes(i)
        doc.text(String(c).slice(0, Math.floor(widths[i] / 1.55)), right ? x + widths[i] - 2 : x, y, right ? { align: 'right' } : undefined)
        x += widths[i]
      })
      y += 6
    }
    doc.setTextColor(255, 255, 255)
    draw(headers, true, BRAND)
    doc.setTextColor(17, 17, 17)
    rows.forEach((r, i) => draw(r, false, i % 2 ? [243, 247, 246] : undefined))
    if (!rows.length) {
      doc.setFont('helvetica', 'italic').setFontSize(8).text('None', 15, y)
      y += 6
    }
    y += 3
  }

  header()
  doc.setFont('helvetica', 'bold').setFontSize(16).text(borrower.fullName, 14, y)
  y += 6
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110, 110, 110)
    .text(`Customer ID ${borrower.customerNumber}  ·  ${borrower.status}${borrower.verified ? '  ·  verified' : ''}`, 14, y)
  doc.setTextColor(17, 17, 17)
  y += 8

  heading('Customer details')
  pairs([
    ['Phone', borrower.phone],
    ['National ID', borrower.nationalId],
    ['Address', [borrower.street, borrower.ward, borrower.district, borrower.region].filter(Boolean).join(', ')],
    ['Occupation', borrower.occupation],
    ['Monthly income', money(borrower.monthlyIncome, cur)],
    ['Registered', fmtDate(borrower.createdAt)],
  ])

  const loans = opts.loans.filter((l) => l.status !== 'reversed')
  const paidOn = (l: Loan) => opts.repayments.filter((r) => r.loanId === l.id && !r.reversed).reduce((s, r) => s + r.amount, 0)
  const active = loans.filter((l) => l.status === 'active')
  heading('Summary')
  pairs([
    ['Loans', String(loans.length)],
    ['Active loans', String(active.length)],
    ['Total borrowed', money(loans.reduce((s, l) => s + l.principal, 0), cur)],
    ['Total repaid', money(loans.reduce((s, l) => s + paidOn(l), 0), cur)],
    ['Outstanding', money(active.reduce((s, l) => s + l.outstandingBalance, 0), cur)],
    ['Overdue', money(active.reduce((s, l) => s + (l.daysInArrears > 0 ? l.arrearsAmount : 0), 0), cur)],
  ])

  heading('Loans')
  const status = (l: Loan) =>
    l.status === 'closed' ? 'Completed' : l.status === 'written_off' ? 'Defaulted' : l.daysInArrears > 0 ? `Overdue ${l.daysInArrears}d` : 'Active'
  table(
    ['Loan', 'Disbursed', 'Amount', 'Paid', 'Outstanding', 'Next due', 'Next amount', 'Status'],
    [20, 22, 24, 24, 25, 22, 24, 21],
    loans.map((l) => {
      const next = l.status === 'active' ? l.schedule.find((i) => i.status !== 'paid') : undefined
      return [
        l.loanNumber, fmtDate(l.disbursement?.date), money(l.principal, cur), money(paidOn(l), cur),
        money(l.status === 'active' ? l.outstandingBalance : 0, cur),
        next ? fmtDate(next.dueDate) : '-',
        next ? money(next.totalDue - next.paidAmount, cur) : '-',
        status(l),
      ]
    }),
    [2, 3, 4, 6],
  )

  heading('Recent payments')
  const ids = new Set(loans.map((l) => l.id))
  const pays = opts.repayments
    .filter((r) => ids.has(r.loanId) && !r.reversed)
    .sort((a, b) => (b.paymentDate || b.date).localeCompare(a.paymentDate || a.date))
    .slice(0, 15)
  table(
    ['Date', 'Receipt', 'Loan', 'Method', 'Reference', 'Amount'],
    [26, 28, 26, 32, 36, 34],
    pays.map((r) => [fmtDate(r.paymentDate || r.date), r.receiptNumber, loans.find((l) => l.id === r.loanId)?.loanNumber ?? '', r.channel.replace('_', ' '), r.reference || '-', money(r.amount, cur)]),
    [5],
  )

  if (lender.mobileMoneyNumber) {
    ensure(18)
    doc.setFillColor(233, 245, 241)
    doc.rect(14, y - 4, W - 28, 15, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BRAND)
      .text(`Pay by ${lender.mobileMoneyNetwork ? `${lender.mobileMoneyNetwork} ` : ''}mobile money to ${lender.mobileMoneyNumber}`, 18, y + 1.5)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(17, 17, 17)
      .text(`Account name: ${lender.mobileMoneyAccountName || lender.name}. Use your loan number as the reference and keep the confirmation SMS.`, 18, y + 7)
    y += 16
  }

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(140, 140, 140)
      .text(`${lender.name} · ${borrower.customerNumber} · page ${p} of ${pages} · generated from the loan records`, W / 2, H - 8, { align: 'center' })
  }
  return doc.output('blob')
}

/**
 * Send a PDF to someone on WhatsApp. On phones the share sheet attaches the file
 * directly; elsewhere the PDF downloads and WhatsApp opens on the person's chat,
 * ready for the file to be attached.
 */
export async function shareOnWhatsApp(opts: { blob: Blob; filename: string; phone: string; message: string }): Promise<'shared' | 'downloaded'> {
  const file = new File([opts.blob], opts.filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.filename, text: opts.message })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'
    }
  }
  const url = URL.createObjectURL(opts.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  window.open(`https://wa.me/${whatsappNumber(opts.phone)}?text=${encodeURIComponent(opts.message)}`, '_blank', 'noopener')
  return 'downloaded'
}
