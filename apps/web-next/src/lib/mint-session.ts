import { NextResponse } from "next/server";
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

export function jsonWithReportingSession(
  req: Request,
  email: string,
  body: Record<string, unknown> = {},
) {
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Authentication is not configured." }, { status: 500 });
  }
  const ttlDays = reportingSessionTtlDays();
  const session = createSessionToken(email, secret, ttlDays, {
    mfa: true,
    auth: firstFactorAuth(req, email),
  });
  const secure = cookieSecureFromRequest(req);
  const res = NextResponse.json({ ok: true, email, redirect: "/", session, ...body });
  res.headers.append("Set-Cookie", sessionCookie(session, ttlDays * 86400, secure));
  res.headers.append("Set-Cookie", clearMfaPendingCookie(secure));
  res.headers.append("Set-Cookie", clearAspireduSessionCookie("/aspiredu"));
  res.headers.append("Set-Cookie", clearAspireduSessionCookie("/"));
  return res;
}
