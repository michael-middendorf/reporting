import { useSearchParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { apiFetch, setBearer } from '../lib/api'
import './auth.css'

export function MagicPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const navigate = useNavigate()
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string }>({
    kind: '',
    text: '',
  })
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (!token) return
    setBusy(true)
    setStatus({ kind: '', text: '' })
    try {
      const res = await apiFetch('/api/auth/complete', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.session) setBearer(data.session)
      setStatus({ kind: 'ok', text: 'Signed in. Redirecting…' })
      navigate(data.redirect || '/', { replace: true })
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
      setBusy(false)
    }
  }

  return (
    <main className="auth-card">
      <div className="eyebrow">Ave Maria University</div>
      <h1>Complete sign-in</h1>
      <p className="copy">
        This extra click prevents email scanners from consuming the sign-in link before you do.
      </p>
      <button type="button" disabled={!token || busy} onClick={confirm}>
        {busy ? 'Signing in…' : 'Continue to reports'}
      </button>
      {!token && (
        <div className="status err">
          This sign-in link is missing its token. Request a new email from the login page.
        </div>
      )}
      <div className={`status ${status.kind}`} aria-live="polite">
        {status.text}
      </div>
    </main>
  )
}
