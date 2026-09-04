import { NextResponse } from "next/server";
import { signedInAspireduEmail } from "@/lib/mfa-pending";
import { deletePasskey, listPasskeys } from "@/lib/webauthn";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const email = signedInAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const passkeys = await listPasskeys(email);
    return NextResponse.json({ ok: true, passkeys });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load passkeys";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const email = signedInAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { credentialId?: string } | null;
  const credentialId = String(body?.credentialId || "").trim();
  if (!credentialId) return NextResponse.json({ error: "Missing passkey id" }, { status: 400 });
  try {
    await deletePasskey(email, credentialId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete that passkey";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
