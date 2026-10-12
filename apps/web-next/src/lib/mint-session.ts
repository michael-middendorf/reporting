import { currentMfaPendingContext } from "@/lib/auth";
import { ssoOnlyEnabled } from "@/lib/sso-policy";
import { NextResponse } from "next/server";
import { carriedReturnPath } from "@/lib/safe-local-path";
import { clearAspireduSessionCookie } from "@/lib/aspiredu-auth";
import {
  clearMfaPendingCookie,
  cookieSecureFromRequest,
  createSessionToken,
  currentMfaPending,
  reportingSessionTtlDays,
  sessionCookie,
  type SessionAuthMethod,
} from "@/lib/auth";

/**
 * How the first factor was proven, read from the mfa_pending cookie that
 * /auth/mfa is finishing. "entra" only when that cookie was minted by the
 * Microsoft callback for this same email; anything else is "magic".
 */
function firstFactorAuth(req: Request, email: string): SessionAuthMethod {
  const pending = currentMfaPending(req);
  if (pending && pending.email === email.trim().toLowerCase() && pending.auth === "entra") {
    return "entra";
  }
  return "magic";
}

/**
 * Where /auth/mfa sends the user once this session is minted. The page passes
 * its own ?next= on the verify request URL; re-validated here and dropped
 * (to "/") when unsafe, the default, or a sign-in page. Only read after the
 * second factor has been verified, so it cannot skip MFA.
 */
export function mfaReturnRedirect(req: Request): string {
  let raw: string | null = null;
  try {
    raw = new URL(req.url).searchParams.get("next");
  } catch {
    raw = null;
  }
  return carriedReturnPath(raw) ?? "/";
}

export function jsonWithReportingSession(
  req: Request,
  email: string,
  body: Record<string, unknown> = {},
) {
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Authentication is not configured." }, { status: 500 });
  }
  const context = currentMfaPendingContext(req);
  if (ssoOnlyEnabled() && (!context || context.email !== email)) return NextResponse.json({ error: 'Microsoft sign-in required' }, { status: 401 });
  const ttlDays = reportingSessionTtlDays();
  const session = createSessionToken(email, secret, ttlDays, {
    mfa: true,
    auth: firstFactorAuth(req, email),
    authCreatedAt: context?.createdAt,
  });
  const secure = cookieSecureFromRequest(req);
  const res = NextResponse.json({ ok: true, email, redirect: mfaReturnRedirect(req), session, ...body });
  res.headers.append("Set-Cookie", sessionCookie(session, ttlDays * 86400, secure));
  res.headers.append("Set-Cookie", clearMfaPendingCookie(secure));
  res.headers.append("Set-Cookie", clearAspireduSessionCookie("/aspiredu"));
  res.headers.append("Set-Cookie", clearAspireduSessionCookie("/"));
  return res;
}
