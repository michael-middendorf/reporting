import { NextResponse } from "next/server";
import { isUgDegreeSeekingRow } from "@/lib/reports/census/lists";
import { loadCensusSnapshot } from "@/lib/reports/census/overlay";
import { projectReportStudents } from "@/lib/reports/census/report";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";

/** Auth-gated snapshot of the Fall census. Student-level files stay off git. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  const { data, lists, ftcaRaw } = await loadCensusSnapshot();
  const unretainedUg = lists.unretained.filter((s) =>
    isUgDegreeSeekingRow(s.program || "", s.collegeAttend),
  ).length;
  return NextResponse.json({
    ...data,
    reportStudents: projectReportStudents(lists.students),
    rawStudents: lists.students,
    unretainedStudents: lists.unretained,
    priorStudents: lists.prior,
    graduates: lists.graduates,
    ftcaRaw,
    unretained: {
      n: lists.unretained.length,
      ug: unretainedUg,
    },
  });
}
