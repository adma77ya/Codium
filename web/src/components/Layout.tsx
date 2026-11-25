import { NavLink, Outlet } from 'react-router-dom'
import { auth, useAuth } from '../api/auth'
import { useTheme } from '../api/hooks'

const themeLabel = { system: 'Auto', light: 'Light', dark: 'Dark' } as const

export function Layout() {
  const { theme, cycle } = useTheme()
  const me = useAuth()
  return (
    <div className="shell">
      <header className="nav">
        <NavLink to="/" className="brand" aria-label="Codium home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="var(--brand)" />
            <path d="M9.5 8 5.5 12l4 4M14.5 8l4 4-4 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Codium</span>
        </NavLink>
        <nav className="nav-links" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Problems
          </NavLink>
          <NavLink to="/leaderboard" className={({ isActive }) => (isActive ? 'active' : '')}>
            Leaderboard
          </NavLink>
        </nav>
        <div className="nav-right">
          {me ? (
            <>
              <span className="who-am-i">{me.username}</span>
              <button className="ghost" onClick={auth.logout}>
                Log out
              </button>
            </>
          ) : (
            <NavLink to="/login" className="ghost">
              Log in
            </NavLink>
          )}
          <button className="ghost" onClick={cycle} aria-label={`Theme: ${themeLabel[theme]}. Click to change.`}>
            {themeLabel[theme]}
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
