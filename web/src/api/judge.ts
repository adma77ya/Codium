import { WS_BASE, call } from './http'
import { auth } from './auth'
import type { JudgeState, Lang, Verdict } from '../data/types'

// Real pipeline: POST /api/submit puts the job on the Redis queue and returns
// 202 + id immediately. The worker judges it in a Docker sandbox and writes the
// verdict to Postgres; here we poll that row until status === 'done'.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const aborted = () => new DOMException('aborted', 'AbortError')

interface ApiProblem {
  id: number
  slug: string
}
interface ApiSubmission {
  status: 'pending' | 'running' | 'done'
  verdict: Verdict | 'Compile Error' | null
  time_ms: number | null
  memory_mb: number | null
  message: string | null
}

// Pipeline stages the browser can genuinely observe (drives the live diagram):
// 0 request sent · 1 got 202 (row INSERTed + id LPUSHed) · 2 worker running it
// 3 verdict stored in Postgres · 4 leaderboard push received over the WebSocket
export type StageFn = (stage: number, detail: string, ok?: boolean) => void

// Listens on the leaderboard socket for a message about *this* user: proof that
// ZADD + PUBLISH ran and Redis Pub/Sub -> hub -> browser delivered it.
function listenForPush(user: string) {
  let got = false
  let wake: () => void = () => {}
  const arrived = new Promise<void>((r) => (wake = r))
  const ws = new WebSocket(WS_BASE + '/ws/leaderboard')
  ws.onmessage = (m) => {
    try {
      if (JSON.parse(m.data).username === user) {
        got = true
        wake()
      }
    } catch {
      /* ignore malformed frames */
    }
  }
  return {
    got: () => got,
    arrived,
    within: (ms: number) => (got ? Promise.resolve(true) : Promise.race([arrived.then(() => true), wait(ms).then(() => false)])),
    close: () => ws.close(),
  }
}

let problemIds: Promise<Map<string, number>> | null = null
function problemId(slug: string): Promise<number> {
  problemIds ??= call<ApiProblem[]>('/api/problems').then((l) => new Map(l.map((p) => [p.slug, p.id])))
  return problemIds.then((m) => {
    const id = m.get(slug)
    if (id === undefined) throw new Error('This problem is not available on the judge yet.')
    return id
  })
}

export async function submit(
  code: string,
  lang: Lang,
  slug: string,
  onUpdate: (s: JudgeState) => void,
  signal: AbortSignal,
  onStage: StageFn = () => {},
): Promise<JudgeState> {
  const token = auth.get()?.token
  if (!token) throw new Error('Log in to submit.')

  onUpdate({ phase: 'queued', tests: [] })
  const push = listenForPush(auth.get()!.username)
  try {
    return await run(push)
  } catch (e) {
    push.close()
    throw e
  }

  async function run(push: ReturnType<typeof listenForPush>): Promise<JudgeState> {
  onStage(0, 'POST /api/submit sent with your JWT')
  const pid = await problemId(slug)
  const { submission_id } = await call<{ submission_id: number }>('/api/submit', {
    method: 'POST',
    token,
    signal,
    body: { problem_id: pid, language: lang, code },
  })
  onStage(1, `202 Accepted, submission #${submission_id}. Row INSERTed as pending, id LPUSHed to judge:queue`)

  let sawRunning = false
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await Promise.race([wait(700), push.arrived]) // a push means the verdict is already stored
    if (signal.aborted) throw aborted()
    const s = await call<ApiSubmission>(`/api/submissions/${submission_id}`, { token, signal })
    if (s.status === 'running' && !sawRunning) {
      sawRunning = true
      onStage(2, 'Worker BRPOPped the id, claimed the row (status=running) and started the sandbox')
    }
    if (s.status === 'done' && s.verdict) {
      if (!sawRunning) onStage(2, 'Worker claimed and ran it between two polls (too fast to catch the running state)')
      onStage(3, `Verdict "${s.verdict}" written to Postgres`)
      void push.within(4000).then((ok) => {
        onStage(
          4,
          ok
            ? 'ZADD + PUBLISH ran; Redis Pub/Sub delivered it to the hub and the hub pushed it to this browser'
            : 'No WebSocket push arrived within 4s',
          ok,
        )
        push.close()
      })
      const done: JudgeState = {
        phase: 'done',
        tests: [],
        verdict: s.verdict as Verdict,
        timeMs: s.time_ms ?? 0,
        memoryMb: s.memory_mb ?? 0,
        message: s.message ?? undefined,
      }
      onUpdate(done)
      return done
    }
    onUpdate({ phase: s.status === 'running' ? 'running' : 'queued', tests: [] })
  }
  throw new Error('The judge did not answer in time. Is the worker running?')
  }
}
