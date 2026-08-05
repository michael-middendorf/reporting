/** Client fetch helpers for AMU Reporting. */

const SESSION_KEY = "amu_reporting_session";

export function getBearer(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SESSION_KEY);
}

export function setBearer(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) sessionStorage.setItem(SESSION_KEY, token);
  else sessionStorage.removeItem(SESSION_KEY);
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const bearer = getBearer();
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...init, credentials: "include", headers });
}

export type AuthMe = { authenticated: boolean; email?: string };

export async function fetchMe(): Promise<AuthMe> {
  try {
    const res = await apiFetch("/api/auth/me");
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as AuthMe;
  } catch {
    return { authenticated: false };
  }
}
