import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, beginAspireduTotpEnrollment } from "@/lib/aspiredu-auth";

export async function POST(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  try {
    const enrollment = await beginAspireduTotpEnrollment(email);
    return NextResponse.json({ ok: true, ...enrollment }, { headers: aspireduPrivateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start authenticator setup";
    return NextResponse.json({ error: message }, { status: 400, headers: aspireduPrivateHeaders });
  }
}
