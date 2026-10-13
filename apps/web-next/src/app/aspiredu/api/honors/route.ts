import { NextResponse } from "next/server";
import { authorizeAcademicAffairsApi } from "@/lib/aspiredu-api-auth";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";
import { currentUserEmail } from "@/lib/auth";
import { invokeProcessor } from "@/lib/process-invoke";
import { loadProfileCensus } from "@/lib/reports/aspiredu/profile-sources";
import { HONORS_FA2026_FRESHMEN_PCIDS } from "@/lib/reports/aspiredu/honors-roster";
import { buildHonorsReportData } from "@/lib/reports/aspiredu/honors-report";
import { isAspireduCallerDenied } from "@/lib/reports/athletics-coaching/academics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { ...aspireduPrivateHeaders, "Cache-Control": "private, no-store, max-age=0" };

export async function GET(req: Request) {
  const auth = authorizeAcademicAffairsApi(currentUserEmail(req));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  }

  const functionName = process.env.ASPIREDU_STUDENTS_FUNCTION?.trim();
  if (!functionName) {
    return NextResponse.json(
      { error: "AspireDU student reporting is not configured" },
      { status: 503, headers },
    );
  }

  let lambdaResult: unknown;
  try {
    lambdaResult = await invokeProcessor(functionName, {
      action: "coaching",
      callerEmail: auth.email,
      sport: "Honors College Freshmen",
      pcids: [...HONORS_FA2026_FRESHMEN_PCIDS],
      sisIds: HONORS_FA2026_FRESHMEN_PCIDS.map((p) => p.replace(/^P0*/, "")),
    });
  } catch (error) {
    if (isAspireduCallerDenied(error)) {
      return NextResponse.json(
        { error: "You do not have access to Academic Affairs student records." },
        { status: 403, headers },
      );
    }
    console.error("aspiredu honors API: invoke failed", error);
    return NextResponse.json(
      { error: "Unable to load Honors student records right now." },
      { status: 503, headers },
    );
  }

  const record = lambdaResult && typeof lambdaResult === "object" ? (lambdaResult as Record<string, unknown>) : null;
  if (!record || record.ok !== true) {
    return NextResponse.json(
      { error: "Unable to load Honors student records right now." },
      { status: 503, headers },
    );
  }

  const students = Array.isArray(record.students) ? record.students : [];
  const asOf = typeof record.asOf === "string" ? record.asOf : null;

  let census = null;
  try {
    census = await loadProfileCensus();
  } catch (censusError) {
    console.warn("aspiredu honors API: census load failed", censusError);
  }

  const reportData = buildHonorsReportData(students, census?.students ?? null, asOf);

  return NextResponse.json({ ok: true, ...reportData }, { headers });
}
