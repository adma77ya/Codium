import { useEffect, useState } from 'react'

// Live system diagram. Every light-up is driven by an event the browser really
// observed (see api/judge.ts): the 202, the status poll, the WebSocket push.

export interface StageEvent {
  stage: number
  detail: string
  ok: boolean
  t: number // ms since the click
}

type NodeId = 'browser' | 'api' | 'pg' | 'queue' | 'worker' | 'docker' | 'zset' | 'hub'

const W = 120
const H = 52
const NODES: Record<NodeId, { x: number; y: number; title: string; sub: string }> = {
  browser: { x: 0, y: 150, title: 'Browser', sub: 'React app' },
  api: { x: 170, y: 150, title: 'Go API', sub: 'stateless, JWT' },
  pg: { x: 340, y: 20, title: 'PostgreSQL', sub: 'source of truth' },
  queue: { x: 340, y: 150, title: 'Redis list', sub: 'judge:queue' },
  worker: { x: 510, y: 150, title: 'Judge worker', sub: 'BRPOP, N goroutines' },
  docker: { x: 510, y: 280, title: 'Docker sandbox', sub: '--network=none' },
  zset: { x: 340, y: 280, title: 'Redis ZSET', sub: 'ranking + Pub/Sub' },
  hub: { x: 170, y: 280, title: 'WebSocket hub', sub: 'fan-out to browsers' },
}

// An edge is idle before `from`, animated while from <= stage < to, done once stage >= to.
interface Edge {
  n: number
  a: [number, number]
  b: [number, number]
  from: number
  to: number
  ends: [NodeId, NodeId]
  label: string
}

const EDGES: Edge[] = [
  { n: 1, a: [120, 164], b: [170, 164], from: 0, to: 1, ends: ['browser', 'api'], label: 'POST /api/submit with JWT' },
  { n: 2, a: [170, 190], b: [120, 190], from: 1, to: 1, ends: ['api', 'browser'], label: '202 Accepted + submission_id' },
  { n: 3, a: [270, 150], b: [340, 62], from: 0, to: 1, ends: ['api', 'pg'], label: 'INSERT submission (status = pending)' },
  { n: 4, a: [290, 176], b: [340, 176], from: 0, to: 1, ends: ['api', 'queue'], label: 'LPUSH the id onto judge:queue' },
  { n: 5, a: [460, 176], b: [510, 176], from: 1, to: 2, ends: ['queue', 'worker'], label: 'Worker BRPOPs the id' },
  { n: 6, a: [525, 150], b: [460, 64], from: 1, to: 2, ends: ['worker', 'pg'], label: "Claim: UPDATE ... WHERE status='pending', load tests" },
  { n: 7, a: [570, 202], b: [570, 280], from: 2, to: 3, ends: ['worker', 'docker'], label: 'docker run with cpu / memory / pids limits, no network' },
  { n: 8, a: [555, 150], b: [460, 36], from: 2, to: 3, ends: ['worker', 'pg'], label: 'UPDATE verdict, status = done' },
  { n: 9, a: [525, 202], b: [460, 294], from: 3, to: 4, ends: ['worker', 'zset'], label: 'ZADD leaderboard + PUBLISH' },
  { n: 10, a: [340, 306], b: [290, 306], from: 3, to: 4, ends: ['zset', 'hub'], label: 'Redis Pub/Sub reaches every API instance' },
  { n: 11, a: [200, 280], b: [100, 202], from: 3, to: 4, ends: ['hub', 'browser'], label: 'WebSocket push to your browser' },
]

const CAPTION = [
  'Press Submit and watch your code travel through the system.',
  'Request sent. The API checks your JWT, then writes to Postgres and the queue.',
  'Accepted (202). The job waits in Redis until a worker pops it.',
  'The worker owns the job and runs it in a locked-down container.',
  'Verdict is saved. The worker now updates the ranking and publishes the change.',
  'Done: Pub/Sub fanned the update out and the hub pushed it to this browser.',
]

type EState = 'idle' | 'active' | 'done' | 'failed'

const DWELL_MS = 2200 // how long slow motion holds each stage

export function Pipeline({
  events,
  running,
  slow,
  onSlow,
}: {
  events: StageEvent[]
  running: boolean
  slow: boolean
  onSlow: (v: boolean) => void
}) {
  const reached = events.filter((e) => e.ok)
  const target = reached.length ? Math.max(...reached.map((e) => e.stage)) : -1

  // In slow motion (or a replay) the diagram walks through the real recorded
  // stages one at a time instead of jumping straight to the latest one.
  const [shown, setShown] = useState(target)
  const [replay, setReplay] = useState(false)
  const [manual, setManual] = useState(false) // Prev/Next stepping: the user drives
  useEffect(() => {
    if (events.length === 0) {
      setShown(-1)
      setReplay(false)
      setManual(false)
    } else if (manual) {
      // user is stepping by hand; do not auto-advance
    } else if (!(slow || replay)) {
      setShown(target)
    } else if (shown < target) {
      const t = setTimeout(() => setShown(shown + 1), shown < 0 ? 250 : DWELL_MS)
      return () => clearTimeout(t)
    } else if (shown > target) {
      setShown(target)
    }
  }, [events, target, slow, replay, manual, shown])

  const cur = shown
  const walking = !manual && (slow || replay) && shown < target
  const step = (d: number) => {
    setManual(true)
    setShown(Math.max(-1, Math.min(target, shown + d)))
  }
  const pushFailed = events.some((e) => e.stage === 4 && !e.ok) && shown >= 3 && !walking

  const edgeState = (e: Edge): EState => {
    if (cur < 0 && !running) return 'idle'
    if (cur >= e.to) return 'done'
    if (pushFailed && e.from >= 3) return 'failed'
    // before the first event we are mid-flight on stage 0
    const s = Math.max(cur, running && cur < 0 ? 0 : cur)
    return s >= e.from && s < e.to ? 'active' : 'idle'
  }
  const states = EDGES.map(edgeState)

  const nodeState = (id: NodeId): EState => {
    const mine = EDGES.map((e, i) => ({ e, s: states[i] })).filter(({ e }) => e.ends.includes(id))
    if (mine.some((m) => m.s === 'active')) return 'active'
    if (mine.some((m) => m.s === 'failed')) return 'failed'
    if (mine.some((m) => m.s === 'done')) return 'done'
    return 'idle'
  }

  const stageAt = (stage: number) => events.find((e) => e.stage === stage && e.stage <= cur)
  const seen = events.filter((e) => e.stage <= cur || (e.stage === 4 && !e.ok && !walking))
  const fmt = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`)
  const caption = pushFailed ? 'Verdict saved, but no live push reached this browser.' : CAPTION[Math.min(cur + 1, 5)]

  return (
    <div className="pipe" aria-label="Live pipeline diagram">
      <div className="pipe-controls">
        <label className="pipe-slow">
          <input type="checkbox" checked={slow} onChange={(e) => { setManual(false); onSlow(e.target.checked) }} /> Slow motion
        </label>
        <button className="linklike" disabled={events.length === 0 || cur < 0} onClick={() => step(-1)}>
          ◀ Prev
        </button>
        <button className="linklike" disabled={events.length === 0 || cur >= target} onClick={() => step(1)}>
          Next ▶
        </button>
        <button
          className="linklike"
          disabled={running || events.length === 0 || walking}
          onClick={() => {
            setManual(false)
            setReplay(true)
            setShown(-1)
          }}
        >
          Replay slowly
        </button>
      </div>
      <p className="pipe-cap" aria-live="polite">
        {caption}
      </p>
      <svg viewBox="0 0 640 340" role="img" aria-label="Browser to API to Postgres and Redis, worker, Docker sandbox, leaderboard, WebSocket hub">
        <defs>
          {(['idle', 'active', 'done', 'failed'] as EState[]).map((s) => (
            <marker key={s} id={`arrow-${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className={`m-${s}`} />
            </marker>
          ))}
        </defs>

        {EDGES.map((e, i) => {
          const st = states[i]
          const mx = (e.a[0] + e.b[0]) / 2
          const my = (e.a[1] + e.b[1]) / 2
          return (
            <g key={e.n} className={`edge e-${st}`}>
              <title>{`${e.n}. ${e.label}`}</title>
              <line x1={e.a[0]} y1={e.a[1]} x2={e.b[0]} y2={e.b[1]} markerEnd={`url(#arrow-${st})`} />
              <circle cx={mx} cy={my} r="8" />
              <text x={mx} y={my + 3.5} textAnchor="middle">
                {e.n}
              </text>
            </g>
          )
        })}

        {(Object.keys(NODES) as NodeId[]).map((id) => {
          const n = NODES[id]
          return (
            <g key={id} className={`node n-${nodeState(id)}`}>
              <rect x={n.x} y={n.y} width={W} height={H} rx="6" />
              <text x={n.x + W / 2} y={n.y + 22} textAnchor="middle" className="n-title">
                {n.title}
              </text>
              <text x={n.x + W / 2} y={n.y + 38} textAnchor="middle" className="n-sub">
                {n.sub}
              </text>
            </g>
          )
        })}
      </svg>

      <ol className="pipe-steps">
        {EDGES.map((e, i) => {
          const ev = stageAt(e.to)
          return (
            <li key={e.n} className={`s-${states[i]}`}>
              <span className="num">{e.n}</span>
              <span className="txt">{e.label}</span>
              {states[i] === 'done' && ev && <span className="mono ms">+{fmt(ev.t)}</span>}
            </li>
          )
        })}
      </ol>

      {seen.length > 0 && (
        <ul className="pipe-log">
          {seen.map((e) => (
            <li key={e.stage} className={e.ok ? '' : 'bad'}>
              <span className="mono">+{fmt(e.t)}</span> {e.detail}
            </li>
          ))}
          <li className="muted small">Status is polled every 700 ms, so the "running" and "verdict" times are accurate to about that.</li>
        </ul>
      )}
    </div>
  )
}
