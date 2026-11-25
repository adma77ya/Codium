import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../api/auth'

export function Login() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await auth.login(username, password)
      else await auth.register(username, email, password)
      nav('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card auth-form" onSubmit={onSubmit}>
      <h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
      </label>
      {mode === 'register' && (
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
      )}
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'register' ? 8 : undefined}
          required
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
      </button>
      <button type="button" className="linklike" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
      </button>
    </form>
  )
}
