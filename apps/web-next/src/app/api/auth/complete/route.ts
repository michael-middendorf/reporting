import { NextResponse } from "next/server";
import {
  createSessionToken,
  parseAllowed,
  sessionCookie,
  verifyMagicToken,
} from "@/lib/auth";

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
  try {
    email = verifyMagicToken(token, secret).email as string;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid token" },
      { status: 401 },
    );
  }
  if (!parseAllowed().has(email)) {
    return NextResponse.json({ error: "Email is not permitted." }, { status: 403 });
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
