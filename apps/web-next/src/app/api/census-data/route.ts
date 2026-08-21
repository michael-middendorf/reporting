import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import snapshot from "@/lib/reports/census/snapshot.json";

export const dynamic = "force-dynamic";

/** Auth-gated snapshot of the Fall census. Student-level files stay off git. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  return NextResponse.json(snapshot);
}
