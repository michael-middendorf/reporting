import { NextResponse } from "next/server";
import { canAccessReport } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, getAspireduMfaSession } from "@/lib/aspiredu-auth";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ authenticated: false }, { status: 401, headers: aspireduPrivateHeaders });
  }
  // Coaching TOTP cookies are not campus MFA. Require the aspiredu grant first.
  if (!canAccessReport(email, "aspiredu")) {
    return NextResponse.json({ authenticated: false }, { status: 403, headers: aspireduPrivateHeaders });
  }
  const session = await getAspireduMfaSession(req, email);
  return NextResponse.json({ authenticated: Boolean(session), email: session?.email }, {
    status: session ? 200 : 401,
    headers: aspireduPrivateHeaders,
  });
}
