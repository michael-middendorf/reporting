/**
 * Server-only: exchange a Microsoft auth code at core and return the verified
 * campus email. Never import from client code.
 */

/** Core's session cookie name (avemaria-api app/utils/user_sessions/cookie.py). */
export const CORE_SESSION_COOKIE = "session_token";

/** Per-request timeout for every core call in this flow. */
export const CORE_TIMEOUT_MS = 10_000;

export class EntraSignInError extends Error {
  constructor(readonly status: number | null) {
    super("Microsoft sign-in did not complete");
    this.name = "EntraSignInError";
  }
}

/**
 * Core returns the session token ONLY as Set-Cookie. UserSessionRead has no
 * `token` field, so the body is never read for it.
 */
export function sessionTokenFromSetCookie(headers: Headers): string | null {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const raw =
    typeof getSetCookie === "function"
      ? getSetCookie.call(headers)
      : (() => {
          const combined = headers.get("set-cookie");
          return combined ? [combined] : [];
        })();
  for (const line of raw) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === CORE_SESSION_COOKIE) {
      const value = pair.slice(eq + 1).trim();
      return value || null;
    }
  }
  return null;
}

function coreHeaders(token: string): Record<string, string> {
  // Same auth shape as health-portal's coreFetch: core's own cookie.
  return { Cookie: `${CORE_SESSION_COOKIE}=${token}` };
}

/**
 * Exchange the Microsoft code at core and return the email core verified.
 *
 * Core mints a core session (7 days sliding / 30 days absolute) as a side
 * effect. Reporting does not use core sessions, so that token is used for
 * exactly one GET /users/me and then revoked in `finally`, on success and on
 * every failure after the mint. The token and the code are never logged,
 * stored or sent to the browser.
 */
export async function emailFromEntraCode(input: {
  coreApiUrl: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  nonce: string;
}): Promise<string> {
  const base = input.coreApiUrl.trim().replace(/\/+$/, "");
  if (!base) throw new EntraSignInError(null);

  let res: Response;
  try {
    res = await fetch(`${base}/user-sessions/from-entra`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
        nonce: input.nonce,
      }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
  } catch {
    throw new EntraSignInError(null);
  }
  const coreToken = res.status === 201 ? sessionTokenFromSetCookie(res.headers) : null;
  await res.arrayBuffer().catch(() => undefined);
  if (res.status !== 201) throw new EntraSignInError(res.status);
  if (!coreToken) throw new EntraSignInError(res.status);

  try {
    let me: Response;
    try {
      me = await fetch(`${base}/users/me`, {
        method: "GET",
        headers: coreHeaders(coreToken),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
      });
    } catch {
      throw new EntraSignInError(null);
    }
    if (me.status !== 200) {
      await me.arrayBuffer().catch(() => undefined);
      throw new EntraSignInError(me.status);
    }
    let body: { email?: unknown };
    try {
      body = (await me.json()) as { email?: unknown };
    } catch {
      throw new EntraSignInError(me.status);
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) throw new EntraSignInError(me.status);
    return email;
  } finally {
    try {
      const revoke = await fetch(`${base}/user-sessions/current`, {
        method: "DELETE",
        headers: coreHeaders(coreToken),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
      });
      await revoke.arrayBuffer().catch(() => undefined);
      if (!revoke.ok) console.error("[entra] core session revoke failed", { status: revoke.status });
    } catch {
      // Best effort. A failed revoke leaves a core session nobody holds: the
      // token was never sent to the browser or stored.
      console.error("[entra] core session revoke failed");
    }
  }
}
