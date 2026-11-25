import { useSyncExternalStore } from 'react'
import { call } from './http'

// The JWT lives in localStorage so a refresh keeps you logged in. The server is
// stateless: it only verifies the token's signature, there is no session table.
const KEY = 'codium.auth'

export interface Auth {
  token: string
  username: string
}

function load(): Auth | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Auth) : null
  } catch {
    return null
  }
}

let current = load()
const listeners = new Set<() => void>()
const set = (a: Auth | null) => {
  current = a
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: stay logged in for this tab only */
  }
  listeners.forEach((l) => l())
}

interface AuthResponse {
  token: string
  user: { id: number; username: string }
}

export const auth = {
  get: () => current,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  async login(username: string, password: string) {
    const r = await call<AuthResponse>('/api/auth/login', { method: 'POST', body: { username, password } })
    set({ token: r.token, username: r.user.username })
  },
  async register(username: string, email: string, password: string) {
    const r = await call<AuthResponse>('/api/auth/register', { method: 'POST', body: { username, email, password } })
    set({ token: r.token, username: r.user.username })
  },
  logout: () => set(null),
}

export const useAuth = () => useSyncExternalStore(auth.subscribe, auth.get)
