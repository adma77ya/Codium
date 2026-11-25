import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { store } from './store'

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.get)
}

export type ThemeChoice = 'system' | 'light' | 'dark'
const THEME_KEY = 'codium.theme'

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

function apply(t: ThemeChoice) {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme)
  useEffect(() => {
    apply(theme)
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  const cycle = useCallback(() => {
    setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))
  }, [])
  return { theme, cycle }
}

const loadedAt = Date.now()
export const elapsedMinutes = () => Math.floor((Date.now() - loadedAt) / 60000)
