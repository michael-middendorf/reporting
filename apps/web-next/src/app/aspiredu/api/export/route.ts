import { NextResponse } from "next/server";
import { authorizeAcademicAffairsApi } from "@/lib/aspiredu-api-auth";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";
import { currentUserEmail } from "@/lib/auth";
import { invokeProcessor } from "@/lib/process-invoke";
import { buildExportResponse } from "@/lib/reports/aspiredu/export-handler";
import {
  loadProfileCensus,
  loadProfileHousing,
  loadProfileRoster,
} from "@/lib/reports/aspiredu/profile-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Every AspireDU student as one Excel workbook (Students + Classes sheets).
 * No query parameters, so nothing about a student is ever in the URL. Same
 * gate as the other /aspiredu/api routes: a signed-in session plus the
 * aspiredu ACL.
 */
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
  return buildExportResponse({
    callerEmail: auth.email,
    deps: {
      invoke: (payload) => invokeProcessor(functionName, payload),
      loadRoster: loadProfileRoster,
      loadHousing: loadProfileHousing,
      loadCensus: loadProfileCensus,
    },
  });
}
