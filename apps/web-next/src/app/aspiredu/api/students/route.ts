import { NextResponse } from "next/server";
import { authorizeAcademicAffairsApi } from "@/lib/aspiredu-api-auth";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";
import { currentUserEmail } from "@/lib/auth";
import { invokeProcessor } from "@/lib/process-invoke";
import { isAspireduCallerDenied } from "@/lib/reports/athletics-coaching/academics";
import { parseListFilters } from "@/lib/reports/aspiredu/student-list";

export const dynamic = "force-dynamic";

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
  const filters = parseListFilters(url);
  if (!filters.ok) {
    return NextResponse.json({ error: filters.error }, { status: 400, headers: aspireduPrivateHeaders });
  }
  const query = url.searchParams.get("query")?.trim().slice(0, 200) || undefined;
  try {
    const result = await invokeProcessor(functionName, {
      action: "list",
      callerEmail: auth.email,
      query,
      minRisk: filters.minRisk,
      sort: filters.sort,
      cursor: url.searchParams.get("cursor") || undefined,
    });
    return NextResponse.json(result, { headers: aspireduPrivateHeaders });
  } catch (error) {
    if (isAspireduCallerDenied(error)) {
      return NextResponse.json(
        { error: "You do not have access to student records." },
        { status: 403, headers: aspireduPrivateHeaders },
      );
    }
    // Never echo the Lambda error: it carries the raw payload.
    console.error("aspiredu student list failed", error instanceof Error ? error.name : typeof error);
    return NextResponse.json(
      { error: "Student search is unavailable right now." },
      { status: 503, headers: aspireduPrivateHeaders },
    );
  }
}
