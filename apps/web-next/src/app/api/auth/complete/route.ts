import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionFromRequest,
  sessionCookie,
  verifyMagicToken,
  verifySessionToken,
} from "@/lib/auth";
import { canLogin } from "@/lib/access";
import { claimMagicNonce } from "@/lib/magic-nonce";

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

  // A page reload / double-submit re-POSTs the same magic token while the
  // caller already holds the session it minted. Treat that as a no-op
  // instead of "token already used" — only a request with NO valid session
  // for this email needs to actually claim the nonce.
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

  if (!alreadySignedIn) {
    if (!nonce) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    let claim: { claimed: boolean };
    try {
      claim = await claimMagicNonce(nonce, exp);
    } catch {
      // The nonce store is the only thing preventing replay — fail closed
      // rather than silently let a mint-time DynamoDB blip re-open it.
      return NextResponse.json(
        { error: "Authentication is temporarily unavailable. Please try again." },
        { status: 503 },
      );
    }
    if (!claim.claimed) {
      return NextResponse.json({ error: "This sign-in link has already been used." }, { status: 401 });
    }
  }

  const ttlDays = Math.max(parseInt(process.env.AUTH_SESSION_TTL_DAYS || "14", 10), 1);
  const session = createSessionToken(email, secret, ttlDays);
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    ?.trim();
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const secure = proto === "https";
  const res = NextResponse.json({ ok: true, email, redirect: "/", session });
  res.headers.append("Set-Cookie", sessionCookie(session, ttlDays * 86400, secure));
  return res;
}
