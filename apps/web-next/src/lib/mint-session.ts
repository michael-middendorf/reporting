import { NextResponse } from "next/server";
import { clearAspireduSessionCookie } from "@/lib/aspiredu-auth";
import {
  clearMfaPendingCookie,
  cookieSecureFromRequest,
  createSessionToken,
  reportingSessionTtlDays,
  sessionCookie,
} from "@/lib/auth";

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
  const session = createSessionToken(email, secret, ttlDays, { mfa: true });
  const secure = cookieSecureFromRequest(req);
  const res = NextResponse.json({ ok: true, email, redirect: "/", session, ...body });
  res.headers.append("Set-Cookie", sessionCookie(session, ttlDays * 86400, secure));
  res.headers.append("Set-Cookie", clearMfaPendingCookie(secure));
  res.headers.append("Set-Cookie", clearAspireduSessionCookie("/aspiredu"));
  res.headers.append("Set-Cookie", clearAspireduSessionCookie("/"));
  return res;
}
