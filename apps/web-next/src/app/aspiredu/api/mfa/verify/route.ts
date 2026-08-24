import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, aspireduSessionCookie, completeAspireduTotp } from "@/lib/aspiredu-auth";

export async function POST(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  try {
    const result = await completeAspireduTotp(email, String(body?.code || ""));
    const response = NextResponse.json({ ok: true }, { headers: aspireduPrivateHeaders });
    response.headers.append("Set-Cookie", aspireduSessionCookie(result.sessionId));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify that code";
    return NextResponse.json({ error: message }, { status: 400, headers: aspireduPrivateHeaders });
  }
}
