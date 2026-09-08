import { create } from 'zustand'

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'lms-theme'

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  return choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice
}

export function applyTheme(choice: ThemeChoice): void {
  const resolved = resolveTheme(choice)
  document.documentElement.setAttribute('data-theme', resolved)
}

interface ThemeState {
  choice: ThemeChoice
  setChoice: (c: ThemeChoice) => void
}

export const useTheme = create<ThemeState>((set) => ({
  choice: readChoice(),
  setChoice: (choice) => {
    try {
      localStorage.setItem(KEY, choice)
    } catch {
      /* ignore */
    }
    applyTheme(choice)
    set({ choice })
  },
}))

/** Call once at startup, before React renders, to avoid a flash. */
export function initTheme(): void {
  const choice = readChoice()
  applyTheme(choice)
  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (useTheme.getState().choice === 'system') applyTheme('system')
    })
  }
}
