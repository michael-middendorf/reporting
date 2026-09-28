import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CANONICAL_APP_URL } from "@/lib/public-url";
import { entraReturnPath } from "@/lib/safe-local-path";

export { entraReturnPath };

/**
 * Microsoft Entra ("Sign in with Microsoft") for AMU Reporting.
 *
 * The browser does an authorization-code + PKCE round trip with Microsoft.
 * The callback hands the code to core `POST /user-sessions/from-entra`, which
 * holds the only client secret and verifies the ID token. This app never sees
 * a secret or an ID token. Core's session is used once to learn the email and
 * then revoked (src/lib/core/entraSession.ts). The session the user gets is
 * our own `amu_reporting_session`, minted by the same code the magic link uses
 * (src/lib/sign-in-after-verification.ts), so the allowlist and the TOTP /
 * passkey step for Academic Affairs and coaching apply exactly as for a link.
 *
 * Shared Entra app: "AMU Apps Sign-In". The redirect URI must be
 * byte-identical in three places: that registration, core REDIRECT_URI_APPS
 * (avemaria-api), and entraRedirectUri() here.
 *
 * PRODUCTION ONLY. readEntraConfig() returns null outside production even when
 * the IDs are set. http://localhost:3000 belongs to frisbee in core, so a
 * local sign-in would be provisioned as the wrong app.
 */

export const ENTRA_CALLBACK_PATH = "/api/auth/microsoft/callback";

/** Where every callback failure lands. LoginClient shows a message for it. */
export const MICROSOFT_FAILED_PATH = "/login?microsoft=failed";

export const ENTRA_COOKIES = {
  state: "amu_reporting_entra_state",
  verifier: "amu_reporting_entra_verifier",
  nonce: "amu_reporting_entra_nonce",
  from: "amu_reporting_entra_from",
} as const;

/** Scoped to the two Microsoft routes so no other request carries them. */
export const ENTRA_COOKIE_PATH = "/api/auth/microsoft";

/** Time allowed on the Microsoft page before the round trip goes stale. */
export const ENTRA_COOKIE_MAX_AGE = 600;

const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export type EntraConfig = { tenantId: string; clientId: string; coreApiUrl: string };

/**
 * Public IDs and the core base URL, or null when Microsoft sign-in is off.
 * Pure over its inputs so the production gate is unit-tested.
 */
export function entraConfigFrom(env: {
  NODE_ENV?: string;
  ENTRA_TENANT_ID?: string;
  ENTRA_CLIENT_ID?: string;
  CORE_API_URL?: string;
}): EntraConfig | null {
  if (env.NODE_ENV !== "production") return null;
  const tenantId = (env.ENTRA_TENANT_ID ?? "").trim();
  const clientId = (env.ENTRA_CLIENT_ID ?? "").trim();
  const coreApiUrl = (env.CORE_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!tenantId || !clientId || !coreApiUrl) return null;
  return { tenantId, clientId, coreApiUrl };
}

export function readEntraConfig(): EntraConfig | null {
  return entraConfigFrom({
    NODE_ENV: process.env.NODE_ENV,
    ENTRA_TENANT_ID: process.env.ENTRA_TENANT_ID,
    ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID,
    CORE_API_URL: process.env.CORE_API_URL,
  });
}

/** Server-side flag for the login UI. */
export function microsoftSignInEnabled(): boolean {
  return readEntraConfig() !== null;
}

/**
 * Fixed public base URL, never from Host / x-forwarded-*. Behind CloudFront
 * the request can arrive on another host and the ALB sees
 * x-forwarded-proto=http; neither is on core's allowlist.
 */
export function entraAppBaseUrl(appBaseUrl: string | undefined = process.env.APP_BASE_URL): string {
  return ((appBaseUrl ?? "").trim() || CANONICAL_APP_URL).replace(/\/+$/, "");
}

/** https://reporting.avemaria.edu/api/auth/microsoft/callback in production. */
export function entraRedirectUri(appBaseUrl: string | undefined = process.env.APP_BASE_URL): string {
  return `${entraAppBaseUrl(appBaseUrl)}${ENTRA_CALLBACK_PATH}`;
}

/**
 * Set-Cookie value for one of the round-trip cookies. Always Secure: the flow
 * only runs in production over https. Built by hand (not res.cookies) so it
 * can sit next to the raw Set-Cookie strings the session helpers append.
 */
export function entraCookie(name: string, value: string, maxAge = ENTRA_COOKIE_MAX_AGE): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${ENTRA_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
  ];
  if (maxAge <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  parts.push("HttpOnly", "Secure", "SameSite=Lax");
  return parts.join("; ");
}

/** Set-Cookie values that expire every round-trip cookie. */
export function clearEntraCookies(): string[] {
  return Object.values(ENTRA_COOKIES).map((name) => entraCookie(name, "", 0));
}

/** 32 random bytes as base64url (43 url-safe chars, no padding). */
export function createUrlSafeToken(): string {
  return randomBytes(32).toString("base64url");
}

/** PKCE verifier (RFC 7636): 43 chars from the unreserved set. */
export function createPkceVerifier(): string {
  const verifier = randomBytes(32).toString("base64url");
  if (!VERIFIER_RE.test(verifier)) {
    throw new Error("Could not start Microsoft sign-in.");
  }
  return verifier;
}

/** base64url(SHA-256(verifier)), no padding (S256). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildEntraAuthorizeUrl(input: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL("https://login.microsoftonline.com");
  url.pathname = `/${encodeURIComponent(input.tenantId)}/oauth2/v2.0/authorize`;
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  // query, not form_post: the state/verifier cookies are SameSite=Lax and a
  // cross-site POST back from Microsoft would not carry them.
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}
