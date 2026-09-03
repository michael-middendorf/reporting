import { NextResponse } from "next/server";
import { authorizeAcademicAffairsApi } from "@/lib/aspiredu-api-auth";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";
import { currentUserEmail } from "@/lib/auth";
import { invokeProcessor } from "@/lib/process-invoke";

export async function GET(req: Request) {
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
  const url = new URL(req.url);
  const result = await invokeProcessor(functionName, {
    action: "list",
    callerEmail: auth.email,
    query: url.searchParams.get("query") || undefined,
    riskBand: url.searchParams.get("riskBand") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  return NextResponse.json(result, { headers: aspireduPrivateHeaders });
}
