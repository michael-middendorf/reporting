import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    ?.trim();
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const secure = proto === "https";
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookie(secure));
  return res;
}
