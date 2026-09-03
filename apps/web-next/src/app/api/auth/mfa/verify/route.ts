import { NextResponse } from "next/server";
import { verifyAspireduTotp } from "@/lib/aspiredu-auth";
import { pendingAspireduEmail } from "@/lib/mfa-pending";
import { jsonWithReportingSession } from "@/lib/mint-session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const email = pendingAspireduEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  try {
    const result = await verifyAspireduTotp(email, String(body?.code || ""));
    return jsonWithReportingSession(req, result.email, { newlyEnrolled: result.newlyEnrolled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify that code";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
