import { NextResponse } from "next/server";
import { beginAspireduTotpEnrollment } from "@/lib/aspiredu-auth";
import { pendingAspireduEmail } from "@/lib/mfa-pending";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const email = pendingAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const enrollment = await beginAspireduTotpEnrollment(email);
    return NextResponse.json({ ok: true, secret: enrollment.secret, otpauth: enrollment.otpauth });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start authenticator setup";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
