import type { Submission } from '../data/types'

// Per-browser state for the demo. The real app keeps this in Postgres,
// keyed by the logged-in user.
const KEY = 'codium.demo.v1'

interface State {
  solved: Record<string, number> // slug -> contest minute of first accepted
  tries: Record<string, number> // slug -> wrong attempts before solving
  submissions: Submission[]
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    /* storage unavailable: fall through */
  }
  return { solved: {}, tries: {}, submissions: [] }
}

let state = load()
const listeners = new Set<() => void>()

function commit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  state = { ...state }
  listeners.forEach((l) => l())
}

export const store = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  record(sub: Submission, contestMinute: number) {
    const accepted = sub.verdict === 'Accepted'
    const already = state.solved[sub.slug] !== undefined
    state.submissions = [sub, ...state.submissions].slice(0, 50)
    if (!already) {
      if (accepted) state.solved = { ...state.solved, [sub.slug]: contestMinute }
      else state.tries = { ...state.tries, [sub.slug]: (state.tries[sub.slug] ?? 0) + 1 }
    }
    commit()
  },
  reset() {
    state = { solved: {}, tries: {}, submissions: [] }
    commit()
  },
}
