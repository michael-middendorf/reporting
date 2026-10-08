import { ssoOnlyEnabled } from "@/lib/sso-policy";
import { NextResponse } from "next/server";
import { canLogin, sessionDecisionAtComplete } from "@/lib/access";
import {
  currentMfaPendingEmail,
  getSessionFromRequest,
  verifyMagicToken,
  verifySessionToken,
} from "@/lib/auth";
import { claimMagicNonce } from "@/lib/magic-nonce";
import { appendSetCookies, signInAfterVerification } from "@/lib/sign-in-after-verification";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (ssoOnlyEnabled()) return new Response(JSON.stringify({ error: "Sign in with Microsoft." }), { status: 410, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
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

  const signIn = signInAfterVerification(req, email, secret, decision);
  if (signIn.kind === "mfa_pending") {
    const res = NextResponse.json({ ok: true, mfaRequired: true, redirect: signIn.redirect });
    appendSetCookies(res, signIn.setCookies);
    return res;
  }

  const res = NextResponse.json({ ok: true, email, redirect: "/", session: signIn.session });
  appendSetCookies(res, signIn.setCookies);
  return res;
}
