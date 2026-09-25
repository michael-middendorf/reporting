import { NextResponse } from "next/server";
import { authorizeAcademicAffairsApi } from "@/lib/aspiredu-api-auth";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";
import { currentUserEmail } from "@/lib/auth";
import { invokeProcessor } from "@/lib/process-invoke";
import { buildProfileResponse } from "@/lib/reports/aspiredu/profile-handler";
import {
  loadProfileCensus,
  loadProfileHousing,
  loadProfileRoster,
} from "@/lib/reports/aspiredu/profile-sources";
import { STUDENT_KEY_PATTERN } from "@/lib/reports/aspiredu/student-profile";

export const dynamic = "force-dynamic";

const headers = { ...aspireduPrivateHeaders, "Cache-Control": "no-store, max-age=0" };

/**
 * One student's Academic Affairs profile. Same gate as the other
 * /aspiredu/api routes (magic-link session + aspiredu ACL). Every aspiredu
 * viewer sees the athletics, housing, and census blocks for this one student,
 * without needing those report grants; bulk rows never leave the server.
 */
export async function GET(req: Request, context: { params: Promise<{ studentKey: string }> }) {
  const auth = authorizeAcademicAffairsApi(currentUserEmail(req));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  }
  const functionName = process.env.ASPIREDU_STUDENTS_FUNCTION?.trim();
  if (!functionName) {
    return NextResponse.json({ error: "AspireDU student reporting is not configured" }, { status: 503, headers });
  }
  const { studentKey } = await context.params;
  if (!STUDENT_KEY_PATTERN.test(studentKey || "")) {
    return NextResponse.json({ error: "Invalid student key" }, { status: 400, headers });
  }
  try {
    const result = await buildProfileResponse({
      callerEmail: auth.email,
      studentKey,
      deps: {
        invoke: (payload) => invokeProcessor(functionName, payload),
        loadRoster: loadProfileRoster,
        loadHousing: loadProfileHousing,
        loadCensus: loadProfileCensus,
      },
    });
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    console.error("aspiredu profile failed", error instanceof Error ? error.name : typeof error);
    return NextResponse.json({ error: "Unable to load the student profile." }, { status: 503, headers });
  }
}
