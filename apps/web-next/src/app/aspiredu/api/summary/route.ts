import { NextResponse } from "next/server";
import { canAccessReport } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";
import { invokeProcessor } from "@/lib/process-invoke";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: aspireduPrivateHeaders });
  if (!canAccessReport(email, "aspiredu")) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: aspireduPrivateHeaders });
  const functionName = process.env.ASPIREDU_SUMMARY_FUNCTION?.trim();
  if (!functionName) return NextResponse.json({ error: "AspireDU reporting is not configured" }, { status: 503, headers: aspireduPrivateHeaders });
  const result = await invokeProcessor(functionName, {});
  return NextResponse.json(result, { headers: aspireduPrivateHeaders });
}
