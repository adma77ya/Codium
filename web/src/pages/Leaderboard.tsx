import { useEffect, useState } from 'react'
import { PENALTY_PER_TRY, subscribe } from '../api/leaderboard'
import type { Feed } from '../api/leaderboard'
import { problems } from '../data/problems'
import type { Cell } from '../data/types'

const ROW_H = 54

function CellView({ c }: { c: Cell }) {
  if (c.status === 'solved')
    return (
      <span className="cell cell-ok">
        <b>✓</b>
        {c.tries > 0 && <i>+{c.tries}</i>}
      </span>
    )
  if (c.status === 'tried')
    return (
      <span className="cell cell-bad">
        <b>−{c.tries}</b>
      </span>
    )
  return <span className="cell cell-none">·</span>
}

export function Leaderboard() {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [live, setLive] = useState(false)
  useEffect(() => subscribe(setFeed, setLive), [])

  const rows = feed?.standings ?? []

  return (
    <div className="stack">
      <section className="hero">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> {live ? 'Live standings' : 'Reconnecting…'}
          </p>
          <h1>Leaderboard</h1>
          <p className="lede">
            Updates the moment a verdict lands. More solved ranks higher; ties go to the lower penalty ({PENALTY_PER_TRY} points
            for each wrong try before a problem is solved.)
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat">
            <span className="stat-n">{rows.length}</span>
            <span className="stat-l">participants</span>
          </div>
        </div>
      </section>

      <section className="card board" aria-label="Standings">
        <div className="board-scroll">
          <div className="board-inner">
            <div className="board-head board-grid">
              <span>#</span>
              <span>Participant</span>
              <span className="num">Solved</span>
              <span className="num">Penalty</span>
              {problems.map((p) => (
                <span key={p.letter} className="num prob-h" title={p.title}>
                  {p.letter}
                </span>
              ))}
            </div>
            <div className="board-body" style={{ height: rows.length * ROW_H }}>
              {rows.map((r, i) => (
                <div
                  key={r.user}
                  className={`board-row board-grid${r.you ? ' you' : ''}`}
                  style={{ transform: `translateY(${i * ROW_H}px)`, height: ROW_H }}
                >
                  <span className={`rank mono${i < 3 ? ` top top-${i + 1}` : ''}`}>{i + 1}</span>
                  <span className="who">
                    {r.user}
                    {r.you && <em>you</em>}
                  </span>
                  <span className="num mono strong">{r.solved}</span>
                  <span className="num mono">{r.penalty}</span>
                  {problems.map((p) => (
                    <span key={p.letter} className="num">
                      <CellView c={r.cells[p.letter]} />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

    </div>
  )
}
