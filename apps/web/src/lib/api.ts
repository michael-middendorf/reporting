/** Shared fetch helpers for the reporting SPA. */

const SESSION_KEY = 'amu_reporting_session'

export function getBearer(): string | null {
  return sessionStorage.getItem(SESSION_KEY)
}

export function setBearer(token: string | null) {
  if (token) sessionStorage.setItem(SESSION_KEY, token)
  else sessionStorage.removeItem(SESSION_KEY)
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {})
  const bearer = getBearer()
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(path, { ...init, credentials: 'include', headers })
  return res
}

export type AuthMe = { authenticated: boolean; email?: string }

export async function fetchMe(): Promise<AuthMe> {
  try {
    const res = await apiFetch('/api/auth/me')
    if (!res.ok) return { authenticated: false }
    return (await res.json()) as AuthMe
  } catch {
    return { authenticated: false }
  }
}
