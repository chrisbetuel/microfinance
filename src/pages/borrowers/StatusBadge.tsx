import { Badge, type BadgeTone } from '../../components/ui/Badge'
import type { BorrowerStatus } from '../../types'

const tone: Record<BorrowerStatus, BadgeTone> = {
  active: 'green',
  inactive: 'slate',
  suspended: 'amber',
  blacklisted: 'red',
}

export function StatusBadge({ status }: { status: BorrowerStatus }) {
  return (
    <Badge tone={tone[status] ?? 'slate'} dot className="capitalize">
      {status}
    </Badge>
  )
}
