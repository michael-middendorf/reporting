import { NextResponse } from "next/server";
import { authorizeAcademicAffairsApi } from "@/lib/aspiredu-api-auth";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";
import { currentUserEmail } from "@/lib/auth";
import { invokeProcessor } from "@/lib/process-invoke";

export async function GET(req: Request, context: { params: Promise<{ studentKey: string }> }) {
  const auth = authorizeAcademicAffairsApi(currentUserEmail(req));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: aspireduPrivateHeaders });
  }
  const functionName = process.env.ASPIREDU_STUDENTS_FUNCTION?.trim();
  if (!functionName) {
    return NextResponse.json(
      { error: "AspireDU student reporting is not configured" },
      { status: 503, headers: aspireduPrivateHeaders },
    );
  }
  const { studentKey } = await context.params;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(studentKey)) {
    return NextResponse.json({ error: "Invalid student key" }, { status: 400, headers: aspireduPrivateHeaders });
  }
  const result = await invokeProcessor(functionName, {
    action: "get",
    callerEmail: auth.email,
    studentKey,
  });
  return NextResponse.json(result, { headers: aspireduPrivateHeaders });
}
