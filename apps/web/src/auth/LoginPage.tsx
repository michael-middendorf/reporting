import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, fetchMe } from '../lib/api'
import './auth.css'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string }>({
    kind: '',
    text: '',
  })
  const [busy, setBusy] = useState(false)
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    fetchMe().then((me) => {
      if (me.authenticated) {
        navigate(params.get('next') || '/', { replace: true })
      }
    })
  }, [navigate, params])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: '', text: 'Sending…' })
    try {
      const res = await apiFetch('/api/auth/request', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setStatus({ kind: 'ok', text: data.message || 'Check your email for a sign-in link.' })
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-card">
      <div className="eyebrow">Ave Maria University</div>
      <h1>AMU Reporting</h1>
      <p className="copy">
        Sign-in links are emailed to approved addresses. Request one below.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="name@avemaria.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Email me a sign-in link
        </button>
      </form>
      <div className={`status ${status.kind}`} aria-live="polite">
        {status.text}
      </div>
      <p className="hint">
        After you open the email link, confirm sign-in on the next page. Sessions last 14 days.
      </p>
      <p className="hint">
        <Link to="/">Back</Link>
      </p>
    </main>
  )
}
