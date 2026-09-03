import { NextResponse } from "next/server";
import { clearAspireduSessionCookie } from "@/lib/aspiredu-auth";
import { clearMfaPendingCookie, clearSessionCookie, cookieSecureFromRequest } from "@/lib/auth";

export async function POST(req: Request) {
  const secure = cookieSecureFromRequest(req);
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookie(secure));
  res.headers.append("Set-Cookie", clearMfaPendingCookie(secure));
  res.headers.append("Set-Cookie", clearAspireduSessionCookie("/aspiredu"));
  res.headers.append("Set-Cookie", clearAspireduSessionCookie("/"));
  return res;
}
