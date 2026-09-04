import { NextResponse } from "next/server";
import { canAccessReport } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, aspireduTotpStatus } from "@/lib/aspiredu-auth";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  }
  // Campus Academic Affairs only. Coaching TOTP uses /api/athletics-coaching/mfa/*.
  if (!canAccessReport(email, "aspiredu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: aspireduPrivateHeaders });
  }
  try {
    const status = await aspireduTotpStatus(email);
    return NextResponse.json({ ok: true, enrolled: status.enrolled }, { headers: aspireduPrivateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load authenticator status";
    return NextResponse.json({ error: message }, { status: 400, headers: aspireduPrivateHeaders });
  }
}
