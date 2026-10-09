import { NextResponse } from "next/server";
import { athleticsSportsForEmail, isAdmin, reportsForEmail } from "@/lib/access";
import { currentUserEmail, clearSessionCookie, cookieSecureFromRequest } from "@/lib/auth";
import { housingLocalDevEnabled } from "@/lib/housing-local-dev";

export async function GET(req: Request) {
  let email: string | null;
  try { email = currentUserEmail(req); } catch { email = null; }
  if (!email) {
    if (housingLocalDevEnabled()) {
      return NextResponse.json({
        authenticated: true,
        email: "local-dev@localhost",
        admin: false,
        reports: ["housing"],
        athleticsSports: [],
      });
    }
    if (!(process.env.AUTH_SECRET || "").trim()) return NextResponse.json({ error: "Authentication temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const response = NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    // Pending TOTP/passkey and AspirEDU cookies belong to their own flows.
    // Never remove them or a fresh cookie hidden by a stale tab Bearer.
    if (!req.headers.has("authorization")) response.headers.append("Set-Cookie", clearSessionCookie(cookieSecureFromRequest(req)));
    return response;
  }
  return NextResponse.json({
    authenticated: true,
    email,
    admin: isAdmin(email),
    reports: reportsForEmail(email),
    athleticsSports: athleticsSportsForEmail(email),
  }, { headers: { "Cache-Control": "no-store" } });
}
