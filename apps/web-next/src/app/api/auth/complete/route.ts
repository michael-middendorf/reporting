import { NextResponse } from "next/server";
import { canLogin, sessionDecisionAtComplete } from "@/lib/access";
import { clearAspireduSessionCookie } from "@/lib/aspiredu-auth";
import {
  clearMfaPendingCookie,
  clearSessionCookie,
  cookieSecureFromRequest,
  createMfaPendingToken,
  createSessionToken,
  currentMfaPendingEmail,
  getSessionFromRequest,
  MFA_PENDING_TTL_MINUTES,
  mfaPendingCookie,
  reportingSessionTtlDays,
  sessionCookie,
  verifyMagicToken,
  verifySessionToken,
} from "@/lib/auth";
import { claimMagicNonce } from "@/lib/magic-nonce";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const token = String(body.token || "").trim();
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
  const secret = (process.env.AUTH_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Authentication is not configured." }, { status: 500 });
  }

  let email: string;
  let nonce: string;
  let exp: number;
  try {
    const payload = verifyMagicToken(token, secret) as {
      email: string;
      nonce?: string;
      exp?: number;
    };
    email = payload.email;
    nonce = String(payload.nonce || "");
    exp = payload.exp ?? 0;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid token" },
      { status: 401 },
    );
  }
  if (!canLogin(email)) {
    return NextResponse.json({ error: "Email is not permitted." }, { status: 403 });
  }

  const existingSessionToken = getSessionFromRequest(req);
  const alreadySignedIn =
    !!existingSessionToken &&
    (() => {
      try {
        return verifySessionToken(existingSessionToken, secret).email === email;
      } catch {
        return false;
      }
    })();
  const alreadyPending = currentMfaPendingEmail(req) === email;
  const decision = sessionDecisionAtComplete(email, alreadySignedIn);
  // Skip nonce only for a pending refresh, or a non-AA hub session. AA always claims.
  const skipNonce = alreadyPending || (alreadySignedIn && decision !== "mfa_pending");

  if (!skipNonce) {
    if (!nonce) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    let claim: { claimed: boolean };
    try {
      claim = await claimMagicNonce(nonce, exp);
    } catch {
      return NextResponse.json(
        { error: "Authentication is temporarily unavailable. Please try again." },
        { status: 503 },
      );
    }
    if (!claim.claimed) {
      return NextResponse.json({ error: "This sign-in link has already been used." }, { status: 401 });
    }
  }

  const secure = cookieSecureFromRequest(req);
  if (decision === "mfa_pending") {
    const pending = createMfaPendingToken(email, secret, MFA_PENDING_TTL_MINUTES);
    const res = NextResponse.json({ ok: true, mfaRequired: true, redirect: "/auth/mfa" });
    res.headers.append("Set-Cookie", mfaPendingCookie(pending, MFA_PENDING_TTL_MINUTES * 60, secure));
    res.headers.append("Set-Cookie", clearSessionCookie(secure));
    res.headers.append("Set-Cookie", clearAspireduSessionCookie("/aspiredu"));
    res.headers.append("Set-Cookie", clearAspireduSessionCookie("/"));
    return res;
  }

  const ttlDays = reportingSessionTtlDays();
  const session = createSessionToken(email, secret, ttlDays);
  const res = NextResponse.json({ ok: true, email, redirect: "/", session });
  res.headers.append("Set-Cookie", sessionCookie(session, ttlDays * 86400, secure));
  res.headers.append("Set-Cookie", clearMfaPendingCookie(secure));
  return res;
}
