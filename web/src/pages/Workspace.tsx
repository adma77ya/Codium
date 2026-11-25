import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { auth } from '../api/auth'
import { useStore } from '../api/hooks'
import { submit } from '../api/judge'
import { store } from '../api/store'
import { CodeEditor } from '../components/CodeEditor'
import { DifficultyPill, VerdictPill } from '../components/Pills'
import { Pipeline, type StageEvent } from '../components/Pipeline'
import { bySlug } from '../data/problems'
import type { JudgePhase, JudgeState, Lang, Problem } from '../data/types'

const langs: { id: Lang; label: string }[] = [
  { id: 'python', label: 'Python 3' },
  { id: 'cpp', label: 'C++17' },
  { id: 'go', label: 'Go' },
]

const steps: { id: JudgePhase; label: string; hint: string }[] = [
  { id: 'queued', label: 'Queued', hint: 'Job pushed to the Redis queue' },
  { id: 'compiling', label: 'Compiling', hint: 'Worker builds your code in a container' },
  { id: 'running', label: 'Running', hint: 'Tests run with time and memory limits' },
  { id: 'done', label: 'Verdict', hint: 'Result is stored and the board updates' },
]

export function Workspace() {
  const { slug = '' } = useParams()
  const problem = bySlug(slug)
  if (!problem) {
    return (
      <div className="card empty">
        <h1>Problem not found</h1>
        <p>
          There is no problem called “{slug}”. <Link to="/">Back to problems</Link>
        </p>
      </div>
    )
  }
  return <Inner key={problem.slug} problem={problem} />
}

function Inner({ problem }: { problem: Problem }) {
  const s = useStore()
  const [lang, setLang] = useState<Lang>('python')
  const [code, setCode] = useState<Record<Lang, string>>(problem.starter)
  const [judge, setJudge] = useState<JudgeState | null>(null)
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const nav = useNavigate()
  const [error, setError] = useState('')
  const [events, setEvents] = useState<StageEvent[]>([])
  const [showPipe, setShowPipe] = useState(false)
  const [slow, setSlow] = useState(false)
  const [consoleH, setConsoleH] = useState(230) // px, user-resizable
  const workRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const history = s.submissions.filter((x) => x.slug === problem.slug)
  const solved = s.solved[problem.slug] !== undefined

  async function run() {
    if (!auth.get()) {
      nav('/login')
      return
    }
    setError('')
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setBusy(true)
    setJudge(null)
    setEvents([])
    setShowPipe(true)
    const t0 = performance.now()
    const onStage = (stage: number, detail: string, ok = true) => {
      if (abort.current !== ctl) return
      setEvents((ev) => [...ev.filter((e) => e.stage !== stage), { stage, detail, ok, t: performance.now() - t0 }].sort((a, b) => a.stage - b.stage))
    }
    try {
      const final = await submit(code[lang], lang, problem.slug, setJudge, ctl.signal, onStage)
      store.record(
        {
          id: Math.random().toString(36).slice(2, 8),
          slug: problem.slug,
          lang,
          verdict: final.verdict!,
          timeMs: final.timeMs ?? 0,
          memoryMb: final.memoryMb ?? 0,
          at: Date.now(),
        },
        0,
      )
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : 'Submission failed')
        setJudge(null)
      }
    } finally {
      if (abort.current === ctl) setBusy(false)
    }
  }

  // Drag the bar between editor and console. Console height is clamped so the
  // editor always keeps at least 160px.
  const clampH = (h: number) => {
    const total = workRef.current?.clientHeight ?? 700
    return Math.max(90, Math.min(h, total - 60 - 160))
  }
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = consoleH
    const move = (ev: PointerEvent) => setConsoleH(clampH(startH + (startY - ev.clientY)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onSplitKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') setConsoleH((h) => clampH(h + 30))
    else if (e.key === 'ArrowDown') setConsoleH((h) => clampH(h - 30))
    else return
    e.preventDefault()
  }

  return (
    <div className="workspace">
      {showPipe && (
        <div className="pipe-overlay" role="dialog" aria-modal="true" aria-label="Submission pipeline" onClick={() => setShowPipe(false)}>
          <div className="pipe-card" onClick={(e) => e.stopPropagation()}>
            <div className="pipe-head">
              <h2>How your submission travels</h2>
              {judge?.phase === 'done' && judge.verdict && <VerdictPill verdict={judge.verdict} />}
              <button className="linklike push" onClick={() => setShowPipe(false)}>
                Close
              </button>
            </div>
            <Pipeline events={events} running={busy} slow={slow} onSlow={setSlow} />
          </div>
        </div>
      )}
      <section className="pane statement" aria-label="Problem statement">
        <Link to="/" className="back">
          ← All problems
        </Link>
        <div className="title-row">
          <span className="letter mono">{problem.letter}</span>
          <h1>{problem.title}</h1>
          {solved && <span className="verdict v-ac">Solved</span>}
        </div>
        <div className="meta">
          <DifficultyPill level={problem.difficulty} />
          <span>{problem.timeLimitMs / 1000}s time limit</span>
          <span>{problem.memoryMb} MB</span>
        </div>

        {problem.statement.map((t, i) => (
          <p key={i}>{t}</p>
        ))}

        <h2>Input</h2>
        <p>{problem.input}</p>
        <h2>Output</h2>
        <p>{problem.output}</p>

        <h2>Examples</h2>
        {problem.examples.map((ex, i) => (
          <div key={i} className="example">
            <div className="io">
              <div>
                <span className="io-l">Input</span>
                <pre>{ex.input}</pre>
              </div>
              <div>
                <span className="io-l">Output</span>
                <pre>{ex.output}</pre>
              </div>
            </div>
            {ex.note && <p className="note">{ex.note}</p>}
          </div>
        ))}

        <h2>Constraints</h2>
        <ul className="constraints">
          {problem.constraints.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="pane work" aria-label="Solution" ref={workRef} style={{ ...({ '--console-h': `${consoleH}px` } as React.CSSProperties) }}>
        <div className="toolbar">
          <label className="select">
            <span className="sr">Language</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} disabled={busy}>
              {langs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="linklike"
            disabled={busy}
            onClick={() => setCode((c) => ({ ...c, [lang]: problem.starter[lang] }))}
          >
            Reset code
          </button>
          <button className="linklike push" onClick={() => setShowPipe(true)}>
            Show pipeline
          </button>
          <button className="btn primary" onClick={run} disabled={busy}>
            {busy ? 'Judging…' : 'Submit'}
          </button>
        </div>

        <div className="editor">
          <CodeEditor value={code[lang]} lang={lang} onChange={(v) => setCode((c) => ({ ...c, [lang]: v }))} />
        </div>

        <div
          className="splitter"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor and results"
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={onSplitKey}
          onDoubleClick={() => setConsoleH(230)}
        />

        <div className="console" aria-live="polite">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {judge ? <JudgePanel state={judge} /> : <Idle />}
          {history.length > 0 && (
            <div className="history">
              <h3>Your submissions</h3>
              <table>
                <tbody>
                  {history.slice(0, 5).map((h) => (
                    <tr key={h.id}>
                      <td>
                        <VerdictPill verdict={h.verdict} />
                      </td>
                      <td className="muted">{langs.find((l) => l.id === h.lang)?.label}</td>
                      <td className="mono num">{h.timeMs} ms</td>
                      <td className="mono num">{h.memoryMb} MB</td>
                      <td className="muted num">{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Idle() {
  return (
    <div className="idle">
      <p>
        <strong>Ready when you are.</strong> Submitting sends your code through the judge: queue, compile, then run
        against hidden tests.
      </p>
      <p className="muted small">Tip: leave the starter code untouched to see a Wrong Answer, or write any solution to pass.</p>
    </div>
  )
}

function JudgePanel({ state }: { state: JudgeState }) {
  const order = steps.map((x) => x.id)
  const at = order.indexOf(state.phase)
  const finished = state.phase === 'done'
  return (
    <div className="judge">
      <ol className="steps">
        {steps.map((st, i) => {
          const cls = finished || i < at ? 'done' : i === at ? 'active' : ''
          return (
            <li key={st.id} className={cls} title={st.hint}>
              <span className="dot" />
              {st.label}
            </li>
          )
        })}
      </ol>

      <div className="tests" role="list" aria-label="Test results">
        {state.tests.map((t) => (
          <div key={t.n} role="listitem" className={`test t-${t.status}`} title={t.timeMs ? `${t.timeMs} ms` : 'Pending'}>
            <span className="mono">{t.n}</span>
          </div>
        ))}
      </div>

      {finished && state.verdict && (
        <div className={`result ${state.verdict === 'Accepted' ? 'r-ac' : state.verdict === 'Time Limit Exceeded' ? 'r-tle' : 'r-wa'}`}>
          <strong>{state.verdict}</strong>
          <span className="mono">
            {state.timeMs} ms · {state.memoryMb} MB
          </span>
        </div>
      )}
      {finished && state.message && (
        <div className="errlog">
          <span className="errlog-h">{state.verdict === 'Compile Error' ? 'Compiler output' : 'Details'}</span>
          <pre>{state.message}</pre>
        </div>
      )}
    </div>
  )
}
