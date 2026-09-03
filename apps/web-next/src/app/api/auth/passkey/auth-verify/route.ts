import { NextResponse } from "next/server";
import { pendingAspireduEmail } from "@/lib/mfa-pending";
import { jsonWithReportingSession } from "@/lib/mint-session";
import { verifyAuthenticationFor } from "@/lib/webauthn";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const email = pendingAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as AuthenticationResponseJSON | null;
  if (!body?.id || !body.response) {
    return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
  }
  try {
    const result = await verifyAuthenticationFor(email, body);
    return jsonWithReportingSession(req, result.email);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify that passkey";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
