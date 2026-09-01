import { Link } from 'react-router-dom'
import type { Borrower } from '../../types'

export function BorrowerLink({ id, borrowers }: { id: string; borrowers: Borrower[] }) {
  const borrower = borrowers.find((b) => b.id === id)
  if (!borrower) return <span>—</span>
  return (
    <Link to={`/borrowers/${borrower.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand-600 hover:underline">
      {borrower.fullName}
    </Link>
  )
}
