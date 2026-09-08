import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { RouteGuard } from './RouteGuard'

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-slate-50 bg-[radial-gradient(80%_50%_at_100%_0%,rgba(79,70,229,0.06),transparent_60%),radial-gradient(60%_40%_at_0%_0%,rgba(15,23,42,0.035),transparent_55%)] px-6 py-7">
          <RouteGuard>
            <div className="mx-auto max-w-[1400px]">
              <Outlet />
            </div>
          </RouteGuard>
        </main>
      </div>
    </div>
  )
}
