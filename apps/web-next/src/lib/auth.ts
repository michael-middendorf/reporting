import { ssoSessionAccepted } from "./sso-policy";
import { carriedReturnPath } from "./safe-local-path";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";

export const SESSION_COOKIE_NAME = "amu_reporting_session";
export const MFA_PENDING_COOKIE = "amu_reporting_mfa_pending";
export const MFA_PENDING_TTL_MINUTES = 10;

function b64url(buf: Buffer | string) {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function b64urlDecode(s: string) {
  return Buffer.from(s, "base64url");
}

export function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  if (!email || email.length > 320 || /\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0) return false;
  const domain = email.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return true;
}

/** @deprecated Prefer canLogin / allowedEmailsForReport from access.ts */
export function parseAllowed(csv?: string) {
  if (csv) {
    return new Set(csv.split(",").map(normalizeEmail).filter(Boolean));
  }
  // Lazy import avoided: re-export union via access in call sites.
  const source =
    process.env.ALLOWED_EMAILS ||
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu";
  return new Set(source.split(",").map(normalizeEmail).filter(Boolean));
}

function sign(signingKey: string, payloadB64: string) {
  // HMAC-SHA256 MAC for session/magic tokens. AUTH_SECRET is the signing key, not a user password.
  // codeql[js/insufficient-password-hash]
  return b64url(createHmac("sha256", signingKey).update(payloadB64, "ascii").digest());
}

export function createSignedToken(payload: Record<string, unknown>, signingKey: string) {
  const body = JSON.stringify(payload, Object.keys(payload).sort());
  const payloadB64 = b64url(body);
  return `${payloadB64}.${sign(signingKey, payloadB64)}`;
}

export function verifySignedToken(token: string, signingKey: string): Record<string, unknown> {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) throw new Error("Malformed token");
  const expected = sign(signingKey, payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid token signature");
  const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return payload;
}

/**
 * Signed, single-use (nonce) magic-link token. `returnPath` is the untrusted
 * page to land on after sign-in; it is kept in the signed payload as `next`
 * only when carriedReturnPath accepts it, so the emailed URL carries no
 * separate redirect parameter that could be edited.
 */
export function createMagicToken(
  email: string,
  signingKey: string,
  ttlMinutes: number,
  returnPath?: string | null,
) {
  const next = carriedReturnPath(returnPath);
  return createSignedToken(
    {
      email: normalizeEmail(email),
      exp: Math.floor(Date.now() / 1000) + Math.max(ttlMinutes, 1) * 60,
      nonce: randomBytes(16).toString("base64url"),
      type: "magic",
      ...(next ? { next } : {}),
    },
    signingKey,
  );
}

/**
 * Verified magic-link payload. `next` is re-validated with carriedReturnPath
 * (null when absent, unsafe, the default, or a sign-in page).
 */
export function verifyMagicToken(token: string, signingKey: string) {
  const p = verifySignedToken(token, signingKey);
  if (p.type !== "magic") throw new Error("Invalid token type");
  const email = normalizeEmail(String(p.email || ""));
  if (!isValidEmail(email)) throw new Error("Invalid token email");
  const next = carriedReturnPath(typeof p.next === "string" ? p.next : null);
  return { ...p, email, next };
}

/**
 * How the person proved their email for this session. "entra" means core
 * verified a Microsoft sign-in (Conditional Access enforces MFA there).
 * "magic" is the emailed link. Sessions minted before this claim existed
 * have none and parse as null, which every check treats as NOT entra.
 */
export type SessionAuthMethod = "entra" | "magic";

export function parseAuthMethod(value: unknown): SessionAuthMethod | null {
  return value === "entra" || value === "magic" ? value : null;
}

export function createSessionToken(
  email: string,
  signingKey: string,
  ttlDays: number,
  options?: { mfa?: boolean; auth?: SessionAuthMethod; nowSeconds?: number; authCreatedAt?: string },
) {
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    email: normalizeEmail(email),
    exp: now + Math.max(ttlDays, 1) * 86400,
    // Issued-at, epoch seconds. Lets one route demand a recent sign-in
    // (requireCyberAccess: 12 hours) without shortening the global TTL.
    iat: now,
    type: "session",
    auth_method: options?.auth === "entra" ? "entra" : null,
    auth_created_at: options?.authCreatedAt ?? new Date().toISOString(),
  };
  if (options?.mfa) payload.mfa = true;
  if (options?.auth) payload.auth = options.auth;
  return createSignedToken(payload, signingKey);
}

export function verifySessionToken(token: string, signingKey: string) {
  const p = verifySignedToken(token, signingKey);
  if (p.type !== "session") throw new Error("Invalid session type");
  if (!ssoSessionAccepted({ method: p.auth_method, created_at: p.auth_created_at })) throw new Error("Microsoft sign-in required");
  const email = normalizeEmail(String(p.email || ""));
  if (!isValidEmail(email)) throw new Error("Invalid session email");
  return {
    ...p,
    email,
    mfa: p.mfa === true,
    auth: parseAuthMethod(p.auth),
    iat: typeof p.iat === "number" && Number.isFinite(p.iat) ? p.iat : null,
  };
}

export function createMfaPendingToken(
  email: string,
  signingKey: string,
  ttlMinutes = MFA_PENDING_TTL_MINUTES,
  options?: { auth?: SessionAuthMethod; authCreatedAt?: string },
) {
  const payload: Record<string, unknown> = {
    email: normalizeEmail(email),
    exp: Math.floor(Date.now() / 1000) + Math.max(ttlMinutes, 1) * 60,
    type: "mfa_pending",
    auth_method: options?.auth === "entra" ? "entra" : null,
    auth_created_at: options?.authCreatedAt ?? new Date().toISOString(),
  };
  // Carried through /auth/mfa so a Microsoft sign-in that also needs TOTP or a
  // passkey still ends in an auth: "entra" session (see mint-session.ts).
  if (options?.auth) payload.auth = options.auth;
  return createSignedToken(payload, signingKey);
}

export function verifyMfaPendingToken(token: string, signingKey: string) {
  const p = verifySignedToken(token, signingKey);
  if (p.type !== "mfa_pending") throw new Error("Invalid token type");
  if (!ssoSessionAccepted({ method: p.auth_method, created_at: p.auth_created_at })) throw new Error("Microsoft sign-in required");
  const email = normalizeEmail(String(p.email || ""));
  if (!isValidEmail(email)) throw new Error("Invalid token email");
  return { ...p, email, auth: parseAuthMethod(p.auth) };
}

export function reportingSessionTtlDays() {
  return Math.max(parseInt(process.env.AUTH_SESSION_TTL_DAYS || "14", 10), 1);
}

function isLoopbackHost(host: string) {
  const hostname = host.toLowerCase().replace(/:\d+$/, "");
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function cookieSecureFromRequest(req: Request) {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    ?.trim();
  // In production the session and MFA cookies always carry Secure. The
  // x-forwarded-proto header is not trusted here: if a CloudFront or ALB change
  // ever forwarded "http", the cookies would silently lose Secure. Only a
  // loopback host (local `next start` over plain http) is exempt.
  if (process.env.NODE_ENV === "production") {
    return !isLoopbackHost(host);
  }
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return proto === "https";
}

export function sessionCookie(token: string, maxAge: number, secure: boolean) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function mfaPendingCookie(token: string, maxAge: number, secure: boolean) {
  const parts = [
    `${MFA_PENDING_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearMfaPendingCookie(secure: boolean) {
  const parts = [
    `${MFA_PENDING_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function currentMfaPendingEmail(req: Request): string | null {
  return currentMfaPending(req)?.email ?? null;
}

/** Verified mfa_pending cookie: email plus how the first factor was proven. */
export function currentMfaPending(
  req: Request,
): { email: string; auth: SessionAuthMethod | null } | null {
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) return null;
  const header = req.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${MFA_PENDING_COOKIE}=([^;]*)`));
  const token = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (!token) return null;
  try {
    const p = verifyMfaPendingToken(token, secret);
    return { email: p.email, auth: p.auth };
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const cookie = req.headers.get("cookie") || "";
  for (const name of [SESSION_COOKIE_NAME, "enrollment_session", "dashboard_session"]) {
    const re = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`);
    const m = cookie.match(re);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  return null;
}

export function currentUserEmail(req: Request): string | null {
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) return null;
  const token = getSessionFromRequest(req);
  if (!token) return null;
  try {
    return verifySessionToken(token, secret).email as string;
  } catch {
    return null;
  }
}

export type SessionClaims = {
  email: string;
  auth: SessionAuthMethod | null;
  /** Epoch seconds; null for sessions minted before iat was added. */
  iat: number | null;
  mfa: boolean;
};

/** Verified claims of the request's session (Bearer first, then cookie), or null. */
export function currentSession(req: Request): SessionClaims | null {
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) return null;
  const token = getSessionFromRequest(req);
  if (!token) return null;
  try {
    const p = verifySessionToken(token, secret);
    return { email: p.email, auth: p.auth, iat: p.iat, mfa: p.mfa };
  } catch {
    return null;
  }
}

/** True when the hub session was minted after TOTP or passkey at /auth/mfa. */
export function sessionHasHubMfa(req: Request): boolean {
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) return false;
  const token = getSessionFromRequest(req);
  if (!token) return false;
  try {
    return verifySessionToken(token, secret).mfa === true;
  } catch {
    return false;
  }
}

export async function sendMagicEmail(email: string, link: string, ttlMinutes: number) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from =
    process.env.EMAIL_FROM ||
    "AMU Project Manager <noreply@notifications.avemaria.edu>";
  const subject = "Your AMU Reporting sign-in link";
  const text = `Use the link below to sign in to AMU Reporting. It will take you to your reports.\n\n${link}\n\nThis link expires in ${ttlMinutes} minutes.`;
  const html = `<p>Use the link below to sign in to AMU Reporting. It will take you to your reports.</p><p><a href="${link}">Open AMU Reporting</a></p><p>This link expires in ${ttlMinutes} minutes.</p>`;

  if (!apiKey) {
    console.log("\nEMAIL (dev)\nTo:", email, "\n", text, "\n");
    return { ok: true as const };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [email], subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return { ok: false as const, error: `Resend ${res.status}: ${detail}` };
  }
  return { ok: true as const };
}

export function currentMfaPendingContext(req: Request): { email: string; method: 'entra'; createdAt: string } | null {
  const secret = (process.env.AUTH_SECRET || '').trim();
  const token = (req.headers.get('cookie') || '').match(/(?:^|;\s*)amu_reporting_mfa_pending=([^;]*)/)?.[1];
  if (!secret || !token) return null;
  try {
    const payload = verifyMfaPendingToken(decodeURIComponent(token), secret) as { email: string; auth_method?: unknown; auth_created_at?: unknown };
    if (payload.auth_method !== 'entra' || typeof payload.auth_created_at !== 'string') return null;
    return { email: payload.email, method: 'entra', createdAt: payload.auth_created_at };
  } catch { return null; }
}
