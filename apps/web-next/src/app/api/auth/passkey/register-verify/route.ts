import { NextResponse } from "next/server";
import { signedInAspireduEmail } from "@/lib/mfa-pending";
import { verifyRegistrationFor } from "@/lib/webauthn";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const email = signedInAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | (RegistrationResponseJSON & { deviceName?: string })
    | null;
  if (!body?.id || !body.response) {
    return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
  }
  try {
    const { deviceName, ...response } = body;
    const result = await verifyRegistrationFor(email, response, String(deviceName || "Passkey"));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save that passkey";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
