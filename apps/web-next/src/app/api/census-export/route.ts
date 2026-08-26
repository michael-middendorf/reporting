import { NextResponse } from "next/server";
import { loadCensusSnapshot } from "@/lib/reports/census/overlay";
import { buildCensusWorkbook, censusFileName } from "@/lib/reports/census/workbook";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Auth-gated Excel draft matching the FA25 census workbook layout. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  try {
    const { data, housingRows } = await loadCensusSnapshot();
    const buf = await buildCensusWorkbook(data, housingRows);
    const filename = censusFileName(data);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
