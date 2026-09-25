import { NextResponse } from "next/server";
import { authorizeAcademicAffairsApi } from "@/lib/aspiredu-api-auth";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";
import { currentUserEmail } from "@/lib/auth";
import { invokeProcessor } from "@/lib/process-invoke";
import { isAspireduCallerDenied } from "@/lib/reports/athletics-coaching/academics";
import { parseListFilters, parseListInput, type ListInput } from "@/lib/reports/aspiredu/student-list";

export const dynamic = "force-dynamic";

type Parsed = ReturnType<typeof parseListInput>;

async function listStudents(req: Request, parse: () => Promise<Parsed>) {
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
  const filters = await parse();
  if (!filters.ok) {
    return NextResponse.json({ error: filters.error }, { status: 400, headers: aspireduPrivateHeaders });
  }
  const input: ListInput = filters;
  try {
    const result = await invokeProcessor(functionName, {
      action: "list",
      callerEmail: auth.email,
      query: input.query,
      minRisk: input.minRisk,
      sort: input.sort,
      cursor: input.cursor,
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

/** Backward-compatible query-string form. The page uses POST so names stay out of URLs and logs. */
export async function GET(req: Request) {
  return listStudents(req, async () => parseListFilters(new URL(req.url)));
}

/** Preferred: filters in a JSON body { query, minRisk, sort, cursor }. */
export async function POST(req: Request) {
  return listStudents(req, async () => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return { ok: false, error: "Request body must be JSON" };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, error: "Request body must be a JSON object" };
    }
    return parseListInput(body as Record<string, unknown>);
  });
}
