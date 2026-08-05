import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST() {
  const secure = (process.env.APP_BASE_URL || "").startsWith("https://");
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookie(secure));
  return res;
}
