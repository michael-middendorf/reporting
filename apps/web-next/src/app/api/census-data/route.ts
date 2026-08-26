import { NextResponse } from "next/server";
import { loadCensusSnapshot } from "@/lib/reports/census/overlay";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";

/** Auth-gated snapshot of the Fall census. Student-level files stay off git. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  const { data } = await loadCensusSnapshot();
  return NextResponse.json(data);
}
