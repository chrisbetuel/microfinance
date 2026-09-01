import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { NAV_ACCESS } from '../../lib/permissions'

function sectionFor(pathname: string): string {
  if (pathname === '/') return '/'
  return '/' + pathname.split('/')[1]
}

export function RouteGuard({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const role = useStore((s) => s.currentUser?.role)

  useEffect(() => {
    if (!role) return
    if (!NAV_ACCESS[role].includes(sectionFor(location.pathname))) {
      navigate('/', { replace: true })
    }
  }, [location.pathname, role, navigate])

  return <>{children}</>
}
