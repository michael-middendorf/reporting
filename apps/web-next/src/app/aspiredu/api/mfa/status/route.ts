import { NextResponse } from "next/server";
import { canAccessReport } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, aspireduTotpStatus, getAspireduMfaSession } from "@/lib/aspiredu-auth";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  // Campus Academic Affairs only. Coaching TOTP uses /api/athletics-coaching/mfa/*.
  if (!canAccessReport(email, "aspiredu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: aspireduPrivateHeaders });
  }
  try {
    const session = await getAspireduMfaSession(req, email);
    if (session) return NextResponse.json({ ok: true, enrolled: true, session: true }, { headers: aspireduPrivateHeaders });
    const status = await aspireduTotpStatus(email);
    return NextResponse.json({ ok: true, enrolled: status.enrolled, session: false }, { headers: aspireduPrivateHeaders });
  } catch {
    return NextResponse.json({ error: "Student-level access is not available for this account" }, { status: 403, headers: aspireduPrivateHeaders });
  }
}
