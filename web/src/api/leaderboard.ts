import { problems } from '../data/problems'
import type { Cell, Standing } from '../data/types'
import { auth } from './auth'
import { WS_BASE, call } from './http'

// Real feed. GET /api/leaderboard reads the Redis sorted set (ZREVRANGE) for the
// ranking. A WebSocket stays open; the worker publishes to Redis Pub/Sub, the
// Go hub forwards it here, and each message tells us to refetch the snapshot.

export const PENALTY_PER_TRY = 20

interface ApiStanding {
  username: string
  solved: number
  penalty: number
  cells?: Record<string, { solved: boolean; tries: number }>
}

export interface Feed {
  standings: Standing[]
}

function toStanding(r: ApiStanding): Standing {
  const cells: Record<string, Cell> = {}
  for (const p of problems) {
    const c = r.cells?.[p.slug]
    cells[p.letter] = !c
      ? { status: 'none', tries: 0 }
      : c.solved
        ? { status: 'solved', tries: c.tries }
        : { status: 'tried', tries: c.tries }
  }
  return { user: r.username, you: r.username === auth.get()?.username, solved: r.solved, penalty: r.penalty, cells }
}

export function subscribe(onFeed: (f: Feed) => void, onStatus: (live: boolean) => void): () => void {
  let closed = false
  let ws: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | undefined

  const load = async () => {
    try {
      const rows = await call<ApiStanding[]>('/api/leaderboard')
      if (!closed) onFeed({ standings: rows.map(toStanding) })
    } catch {
      /* keep showing the last snapshot */
    }
  }

  const connect = () => {
    ws = new WebSocket(WS_BASE + '/ws/leaderboard')
    ws.onopen = () => {
      onStatus(true)
      void load() // catch anything published while we were disconnected
    }
    ws.onmessage = () => void load()
    ws.onclose = () => {
      onStatus(false)
      if (!closed) retry = setTimeout(connect, 2000)
    }
  }

  void load()
  connect()
  return () => {
    closed = true
    clearTimeout(retry)
    ws?.close()
  }
}
