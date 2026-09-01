import clsx from 'clsx'

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="border-b border-slate-200">
      <nav className="-mb-px flex gap-5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition-colors',
              active === tab.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
