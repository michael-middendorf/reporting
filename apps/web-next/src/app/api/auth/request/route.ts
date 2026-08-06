import { NextResponse } from "next/server";
import { canLogin } from "@/lib/access";
import {
  createMagicToken,
  isValidEmail,
  normalizeEmail,
  sendMagicEmail,
} from "@/lib/auth";

const MSG = "If your email is approved, you will receive a sign-in link shortly.";

export async function POST(req: Request) {
  let body: { email?: string };
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
  // Prefer the request origin so localhost / preview / CloudFront each get matching links.
  // APP_BASE_URL is only a fallback (e.g. cron jobs with no Host header).
  const headerHost = (
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    ""
  )
    .split(",")[0]
    ?.trim();
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto ||
    (headerHost.startsWith("localhost") || headerHost.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const base =
    (headerHost ? `${proto}://${headerHost}` : "") ||
    (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (!secret) return NextResponse.json({ error: "Authentication is not configured." }, { status: 500 });
  if (!base) return NextResponse.json({ error: "APP_BASE_URL is not configured." }, { status: 500 });

  if (!canLogin(email)) {
    console.log("Auth request ignored for non-allowlisted email:", email);
    return NextResponse.json({ ok: true, message: MSG });
  }

  const ttl = Math.max(parseInt(process.env.AUTH_MAGIC_LINK_TTL_MINUTES || "15", 10), 1);
  const token = createMagicToken(email, secret, ttl);
  const link = `${base}/auth/magic?token=${encodeURIComponent(token)}`;
  const sent = await sendMagicEmail(email, link, ttl);
  if (!sent.ok) {
    return NextResponse.json({ error: "Unable to send sign-in email right now." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: MSG });
}
