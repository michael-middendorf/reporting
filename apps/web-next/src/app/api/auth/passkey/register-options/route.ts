import { NextResponse } from "next/server";
import { signedInAspireduEmail } from "@/lib/mfa-pending";
import { registrationOptionsFor } from "@/lib/webauthn";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const email = signedInAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const optionsJSON = await registrationOptionsFor(email);
    return NextResponse.json({ ok: true, optionsJSON });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start passkey setup";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
