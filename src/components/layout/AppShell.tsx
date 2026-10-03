import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { RouteGuard } from './RouteGuard'
import { CommandPalette } from '../CommandPalette'
import { IdleTimeoutGuard } from './IdleTimeoutGuard'

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <CommandPalette />
      <IdleTimeoutGuard />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-canvas px-4 py-4 sm:px-7 sm:py-6">
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
