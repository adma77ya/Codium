import { Link } from 'react-router-dom'
import { useStore } from '../api/hooks'
import { problems } from '../data/problems'
import { DifficultyPill } from '../components/Pills'
import { store } from '../api/store'

export function Problems() {
  const s = useStore()
  const solvedCount = problems.filter((p) => s.solved[p.slug] !== undefined).length

  return (
    <div className="stack">
      <section className="hero">
        <div>
          <p className="eyebrow">Live contest</p>
          <h1>Problems</h1>
          <p className="lede">
            Solve as many problems as you can. Ranking is by problems solved, then by penalty time. Every wrong
            submission adds 20 minutes.
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat">
            <span className="stat-n">
              {solvedCount}
              <small>/{problems.length}</small>
            </span>
            <span className="stat-l">solved</span>
          </div>
          <Link to="/leaderboard" className="btn secondary">
            View standings
          </Link>
        </div>
      </section>

      <section className="card table-card" aria-label="Problems">
        <table className="problems">
          <thead>
            <tr>
              <th className="c-status">Status</th>
              <th className="c-letter">#</th>
              <th>Title</th>
              <th className="c-tags">Topics</th>
              <th>Difficulty</th>
              <th className="num">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((p) => {
              const solved = s.solved[p.slug] !== undefined
              const tried = !solved && (s.tries[p.slug] ?? 0) > 0
              return (
                <tr key={p.slug}>
                  <td className="c-status">
                    {solved ? (
                      <span className="state state-ok" title="Solved">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="sr">Solved</span>
                      </span>
                    ) : tried ? (
                      <span className="state state-try" title="Attempted">
                        ●<span className="sr">Attempted</span>
                      </span>
                    ) : (
                      <span className="state state-none">
                        <span className="sr">Not attempted</span>
                      </span>
                    )}
                  </td>
                  <td className="c-letter mono">{p.letter}</td>
                  <td>
                    <Link to={`/problems/${p.slug}`} className="title-link">
                      {p.title}
                    </Link>
                  </td>
                  <td className="c-tags">
                    {p.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </td>
                  <td>
                    <DifficultyPill level={p.difficulty} />
                  </td>
                  <td className="num mono">{p.acceptance.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <p className="foot-note">
        Progress is stored in this browser only.{' '}
        <button className="linklike" onClick={() => store.reset()}>
          Reset demo progress
        </button>
      </p>
    </div>
  )
}
