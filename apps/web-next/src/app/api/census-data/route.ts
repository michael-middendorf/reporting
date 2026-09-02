import { NextResponse } from "next/server";
import { attachLoaStatus, isUgDegreeSeekingRow, S26_LOA_ROSTER } from "@/lib/reports/census/lists-core";
import { loadCensusSnapshot } from "@/lib/reports/census/overlay";
import { projectReportStudents } from "@/lib/reports/census/report";
import { ayGraduatePcids } from "@/lib/reports/census/retention";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";

/** Auth-gated snapshot of the Fall census. Student-level files stay off git. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  const { data, lists, ftcaRaw, housingRows } = await loadCensusSnapshot();
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
    housingRows,
    ftcaRaw,
    loaStudents: attachLoaStatus(
      lists.loa.length ? lists.loa : S26_LOA_ROSTER,
      lists.students,
      ayGraduatePcids(lists.graduates),
    ),
    loaFallStudents: attachLoaStatus(
      lists.loaFall,
      lists.students,
      ayGraduatePcids(lists.graduates),
    ),
    unretained: {
      n: lists.unretained.length,
      ug: unretainedUg,
    },
  });
}
