import { ssoOnlyEnabled } from "@/lib/sso-policy";
import { NextResponse } from "next/server";
import { canLogin } from "@/lib/access";
import {
  createMagicToken,
  isValidEmail,
  normalizeEmail,
  sendMagicEmail,
} from "@/lib/auth";
import { MAGIC_LINK_SENT_MSG } from "@/lib/auth-messages";
import { appBaseUrlForEmail } from "@/lib/public-url";

export async function POST(req: Request) {
  if (ssoOnlyEnabled()) return new Response(JSON.stringify({ error: "Sign in with Microsoft." }), { status: 410, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  let body: { email?: string; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = normalizeEmail(String(body.email || ""));
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const secret = (process.env.AUTH_SECRET || "").trim();
  const base = appBaseUrlForEmail(req);
  if (!secret) return NextResponse.json({ error: "Authentication is not configured." }, { status: 500 });
  if (!base) return NextResponse.json({ error: "APP_BASE_URL is not configured." }, { status: 500 });

  if (!canLogin(email)) {
    console.log("Auth request ignored for non-allowlisted email:", email);
    return NextResponse.json({ ok: true, message: MAGIC_LINK_SENT_MSG });
  }

  const ttl = Math.max(parseInt(process.env.AUTH_MAGIC_LINK_TTL_MINUTES || "15", 10), 1);
  // Optional page to return to (the login page's ?next=). createMagicToken
  // keeps it in the signed token only when carriedReturnPath accepts it.
  const returnPath = typeof body.next === "string" ? body.next : null;
  const token = createMagicToken(email, secret, ttl, returnPath);
  const link = `${base}/auth/magic?token=${encodeURIComponent(token)}`;
  const sent = await sendMagicEmail(email, link, ttl);
  if (!sent.ok) {
    return NextResponse.json({ error: "Unable to send sign-in email right now." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: MAGIC_LINK_SENT_MSG });
}
