import { NextResponse } from "next/server";
import {
  aspireduPrivateHeaders,
  aspireduSessionSetCookieHeaders,
  completeAspireduMfa,
} from "@/lib/aspiredu-auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state || !/^[A-Za-z0-9_-]{20,100}$/.test(state)) {
    return NextResponse.json({ error: "Invalid MFA callback" }, { status: 400, headers: aspireduPrivateHeaders });
  }
  try {
    const session = await completeAspireduMfa(code, state);
    const response = NextResponse.redirect(new URL("/aspiredu/students", req.url), { headers: aspireduPrivateHeaders });
    for (const cookie of aspireduSessionSetCookieHeaders(session.sessionId)) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch {
    return NextResponse.json({ error: "MFA sign-in failed or expired" }, { status: 401, headers: aspireduPrivateHeaders });
  }
}
