import { NextResponse } from "next/server";
import { canAccessReport } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, getAspireduMfaSession } from "@/lib/aspiredu-auth";
import { invokeProcessor } from "@/lib/process-invoke";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  if (!canAccessReport(email, "aspiredu")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: aspireduPrivateHeaders });
  }
  const mfa = await getAspireduMfaSession(req, email);
  if (!mfa) return NextResponse.json({ error: "MFA required", mfaUrl: "/aspiredu/api/auth/start" }, { status: 401, headers: aspireduPrivateHeaders });
  const functionName = process.env.ASPIREDU_STUDENTS_FUNCTION?.trim();
  if (!functionName) return NextResponse.json({ error: "AspireDU student reporting is not configured" }, { status: 503, headers: aspireduPrivateHeaders });
  const url = new URL(req.url);
  const result = await invokeProcessor(functionName, {
    action: "list",
    callerEmail: mfa.email,
    query: url.searchParams.get("query") || undefined,
    riskBand: url.searchParams.get("riskBand") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  return NextResponse.json(result, { headers: aspireduPrivateHeaders });
}
