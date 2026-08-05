import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { fetchMe } from '../lib/api'

export function RequireAuth() {
  const location = useLocation()
  const [state, setState] = useState<'loading' | 'ok' | 'no'>('loading')

  useEffect(() => {
    let cancelled = false
    fetchMe().then((me) => {
      if (cancelled) return
      setState(me.authenticated ? 'ok' : 'no')
    })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  if (state === 'loading') {
    return (
      <div className="loading-shell">
        <p>Checking session…</p>
      </div>
    )
  }
  if (state === 'no') {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <Outlet />
}
