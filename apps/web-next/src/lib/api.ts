/** Client fetch helpers for AMU Reporting. */

import type { ReportId } from "@/lib/access";

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

export type AuthMe = {
  authenticated: boolean;
  email?: string;
  admin?: boolean;
  reports?: ReportId[];
};

export async function fetchMe(): Promise<AuthMe> {
  return await readAuthSession() ?? { authenticated: false };
}

/** Verification outages must not erase an already displayed session. */
export async function readAuthSession(): Promise<AuthMe | null> {
  try {
    let res = await apiFetch("/api/auth/me", { cache: "no-store" });
    // The server reads a Bearer header before the HttpOnly cookie. A stale
    // tab-scoped token (expired, or from before an AUTH_SECRET change) would
    // hide a valid cookie session, e.g. one set by Microsoft sign-in, which
    // never puts a token in sessionStorage. Drop it and retry on the cookie.
    if (res.status === 401 && getBearer()) {
      setBearer(null);
      res = await apiFetch("/api/auth/me", { cache: "no-store" });
    }
    if (res.status === 401) return { authenticated: false };
    if (!res.ok) return null;
    const me = await res.json() as AuthMe;
    return me.authenticated === true && typeof me.email === "string" ? me : null;
  } catch {
    return null;
  }
}
