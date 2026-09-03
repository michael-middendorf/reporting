import { NextResponse } from "next/server";
import { aspireduTotpStatus } from "@/lib/aspiredu-auth";
import { maskEmail, pendingAspireduEmail } from "@/lib/mfa-pending";
import { userHasPasskey } from "@/lib/webauthn";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const email = pendingAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const status = await aspireduTotpStatus(email);
    const hasPasskey = await userHasPasskey(email);
    return NextResponse.json({
      ok: true,
      enrolled: status.enrolled,
      hasPasskey,
      email: maskEmail(email),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check authenticator status";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
