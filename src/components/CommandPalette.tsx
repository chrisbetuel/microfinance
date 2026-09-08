import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Users,
  FileCheck2,
  Landmark,
  Wallet,
  SlidersHorizontal,
  Building2,
  ShieldCheck,
  LayoutDashboard,
  BarChart3,
  CornerDownLeft,
} from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '../store/useStore'
import { NAV_ACCESS } from '../lib/permissions'

interface Item {
  id: string
  label: string
  sublabel?: string
  icon: typeof Users
  href: string
  group: string
}

const NAV: { label: string; href: string; icon: typeof Users }[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Lender Setup', href: '/lender-setup', icon: Building2 },
  { label: 'Borrowers', href: '/borrowers', icon: Users },
  { label: 'Loan Products', href: '/products', icon: SlidersHorizontal },
  { label: 'Applications & Approvals', href: '/applications', icon: FileCheck2 },
  { label: 'Disbursement', href: '/disbursement', icon: Landmark },
  { label: 'Repayments', href: '/repayments', icon: Wallet },
  { label: 'Reports & Analytics', href: '/reports', icon: BarChart3 },
  { label: 'Security & Audit', href: '/security', icon: ShieldCheck },
]

export function openCommandPalette() {
  window.dispatchEvent(new Event('open-command-palette'))
}

export function CommandPalette() {
  const navigate = useNavigate()
  const role = useStore((s) => s.currentUser?.role)
  const borrowers = useStore((s) => s.borrowers)
  const applications = useStore((s) => s.applications)
  const products = useStore((s) => s.products)
  const staff = useStore((s) => s.staff)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    function onOpen() {
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const allowed = role ? NAV_ACCESS[role] : []

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const out: Item[] = []

    for (const n of NAV) {
      if (!allowed.includes(n.href)) continue
      if (q && !n.label.toLowerCase().includes(q)) continue
      out.push({ id: `nav:${n.href}`, label: n.label, icon: n.icon, href: n.href, group: 'Go to' })
    }

    if (q.length >= 2 && allowed.includes('/borrowers')) {
      for (const b of borrowers) {
        const hay = `${b.fullName} ${b.businessName ?? ''} ${b.nationalId} ${b.phone}`.toLowerCase()
        if (!hay.includes(q)) continue
        out.push({
          id: `b:${b.id}`,
          label: b.fullName,
          sublabel: `${b.nationalId} · ${b.phone}`,
          icon: Users,
          href: `/borrowers/${b.id}`,
          group: 'Borrowers',
        })
        if (out.length > 40) break
      }
    }

    if (q.length >= 2 && allowed.includes('/applications')) {
      for (const a of applications) {
        const borrower = borrowers.find((b) => b.id === a.borrowerId)
        const hay = `${a.reference} ${borrower?.fullName ?? ''}`.toLowerCase()
        if (!hay.includes(q)) continue
        out.push({
          id: `a:${a.id}`,
          label: a.reference,
          sublabel: `${borrower?.fullName ?? 'Application'} · ${a.status.replace(/_/g, ' ')}`,
          icon: FileCheck2,
          href: `/applications/${a.id}`,
          group: 'Applications',
        })
        if (out.length > 60) break
      }
    }

    if (q.length >= 2 && allowed.includes('/products')) {
      for (const p of products) {
        if (!p.name.toLowerCase().includes(q)) continue
        out.push({ id: `p:${p.id}`, label: p.name, icon: SlidersHorizontal, href: `/products/${p.id}`, group: 'Products' })
      }
    }

    if (q.length >= 2 && allowed.includes('/lender-setup')) {
      for (const m of staff) {
        const hay = `${m.name} ${m.email}`.toLowerCase()
        if (!hay.includes(q)) continue
        out.push({ id: `s:${m.id}`, label: m.name, sublabel: m.email, icon: Users, href: '/lender-setup', group: 'Staff' })
      }
    }

    return out
  }, [query, allowed, borrowers, applications, products, staff])

  useEffect(() => {
    if (active >= items.length) setActive(0)
  }, [items.length, active])

  if (!open) return null

  function choose(item: Item) {
    setOpen(false)
    navigate(item.href)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault()
      choose(items[active])
    }
  }

  let lastGroup = ''

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4">
          <Search size={16} className="text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search borrowers, applications, pages…"
            className="w-full bg-transparent py-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              {query.trim().length < 2 ? 'Type to search…' : 'No matches.'}
            </p>
          )}
          {items.map((item, i) => {
            const showGroup = item.group !== lastGroup
            lastGroup = item.group
            return (
              <div key={item.id}>
                {showGroup && (
                  <p className="px-4 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">{item.group}</p>
                )}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                  className={clsx(
                    'flex w-full items-center gap-3 px-4 py-2 text-left',
                    i === active ? 'bg-brand-50' : 'hover:bg-slate-50',
                  )}
                >
                  <item.icon size={15} className={i === active ? 'text-brand-600' : 'text-slate-400'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{item.label}</span>
                    {item.sublabel && <span className="block truncate text-xs text-slate-400">{item.sublabel}</span>}
                  </span>
                  {i === active && <CornerDownLeft size={13} className="text-slate-300" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
