import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, getAspireduMfaSession } from "@/lib/aspiredu-auth";
import { invokeProcessor } from "@/lib/process-invoke";

export async function GET(req: Request, context: { params: Promise<{ studentKey: string }> }) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  const mfa = await getAspireduMfaSession(req, email);
  if (!mfa) return NextResponse.json({ error: "MFA required" }, { status: 401, headers: aspireduPrivateHeaders });
  const functionName = process.env.ASPIREDU_STUDENTS_FUNCTION?.trim();
  if (!functionName) return NextResponse.json({ error: "AspireDU student reporting is not configured" }, { status: 503, headers: aspireduPrivateHeaders });
  const { studentKey } = await context.params;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(studentKey)) {
    return NextResponse.json({ error: "Invalid student key" }, { status: 400, headers: aspireduPrivateHeaders });
  }
  const result = await invokeProcessor(functionName, {
    action: "get",
    callerEmail: mfa.email,
    studentKey,
  });
  return NextResponse.json(result, { headers: aspireduPrivateHeaders });
}
