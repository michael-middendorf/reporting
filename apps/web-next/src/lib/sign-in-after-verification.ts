import { clearAspireduSessionCookie } from "@/lib/aspiredu-auth";
import {
  clearMfaPendingCookie,
  clearSessionCookie,
  cookieSecureFromRequest,
  createMfaPendingToken,
  createSessionToken,
  MFA_PENDING_TTL_MINUTES,
  mfaPendingCookie,
  reportingSessionTtlDays,
  sessionCookie,
  type SessionAuthMethod,
} from "@/lib/auth";

export const MFA_PAGE_PATH = "/auth/mfa";

export type SignInDecision = "session" | "mfa_pending";

export type VerifiedSignIn =
  | { kind: "mfa_pending"; redirect: typeof MFA_PAGE_PATH; setCookies: string[] }
  | { kind: "session"; session: string; setCookies: string[] };

/**
 * What happens after an email has been proven (magic link redeemed, or
 * Microsoft sign-in verified by core) and passed canLogin(). Shared by
 * POST /api/auth/complete and GET /api/auth/microsoft/callback so both
 * credentials end in exactly the same cookies.
 *
 * - mfa_pending (Academic Affairs, coaching): short-lived
 *   amu_reporting_mfa_pending cookie, any hub session and leftover AspireDU
 *   MFA cookies cleared. The user finishes TOTP or passkey on /auth/mfa.
 * - session: 14-day amu_reporting_session WITHOUT the mfa claim. Only
 *   /auth/mfa (mint-session.ts) may mint a session with mfa: true.
 */
export function signInAfterVerification(
  req: Request,
  email: string,
  secret: string,
  decision: SignInDecision,
  /**
   * How the email was proven. Only the Microsoft callback passes "entra";
   * every other caller (the magic link) gets "magic". Stored as the session's
   * `auth` claim (and on the mfa_pending token so /auth/mfa keeps it).
   */
  auth: SessionAuthMethod = "magic",
  authCreatedAt?: string,
): VerifiedSignIn {
  const secure = cookieSecureFromRequest(req);
  if (decision === "mfa_pending") {
    const pending = createMfaPendingToken(email, secret, MFA_PENDING_TTL_MINUTES, { auth, authCreatedAt });
    return {
      kind: "mfa_pending",
      redirect: MFA_PAGE_PATH,
      setCookies: [
        mfaPendingCookie(pending, MFA_PENDING_TTL_MINUTES * 60, secure),
        clearSessionCookie(secure),
        clearAspireduSessionCookie("/aspiredu"),
        clearAspireduSessionCookie("/"),
      ],
    };
  }

  const ttlDays = reportingSessionTtlDays();
  const session = createSessionToken(email, secret, ttlDays, { auth, authCreatedAt });
  return {
    kind: "session",
    session,
    setCookies: [sessionCookie(session, ttlDays * 86400, secure), clearMfaPendingCookie(secure)],
  };
}

export function appendSetCookies(res: Response, setCookies: string[]) {
  for (const value of setCookies) res.headers.append("Set-Cookie", value);
}
