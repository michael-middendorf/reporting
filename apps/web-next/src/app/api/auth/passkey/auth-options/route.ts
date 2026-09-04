import { NextResponse } from "next/server";
import { pendingAspireduEmail } from "@/lib/mfa-pending";
import { authenticationOptionsFor } from "@/lib/webauthn";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const email = pendingAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const optionsJSON = await authenticationOptionsFor(email);
    return NextResponse.json({ ok: true, optionsJSON });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start passkey sign-in";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
