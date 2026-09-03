import { NextResponse } from "next/server";
import { canAccessReport } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, aspireduSessionSetCookieHeaders, completeAspireduTotp } from "@/lib/aspiredu-auth";

export async function POST(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  // Campus Academic Affairs only. Coaching TOTP uses /api/athletics-coaching/mfa/*.
  if (!canAccessReport(email, "aspiredu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: aspireduPrivateHeaders });
  }
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  try {
    const result = await completeAspireduTotp(email, String(body?.code || ""));
    const response = NextResponse.json({ ok: true }, { headers: aspireduPrivateHeaders });
    for (const cookie of aspireduSessionSetCookieHeaders(result.sessionId)) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify that code";
    return NextResponse.json({ error: message }, { status: 400, headers: aspireduPrivateHeaders });
  }
}
