import { NextResponse } from "next/server";
import { canAccessReport } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, beginAspireduTotpEnrollment } from "@/lib/aspiredu-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  }
  if (!canAccessReport(email, "athletics-coaching")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: aspireduPrivateHeaders });
  }
  try {
    const enrollment = await beginAspireduTotpEnrollment(email);
    return NextResponse.json({ ok: true, ...enrollment }, { headers: aspireduPrivateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start authenticator setup";
    return NextResponse.json({ error: message }, { status: 400, headers: aspireduPrivateHeaders });
  }
}
