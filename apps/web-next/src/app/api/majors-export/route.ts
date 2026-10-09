import { NextResponse } from "next/server";
import { loadMajorsSources } from "@/lib/reports/majors/load";
import { majorsParamsFromUrl } from "@/lib/reports/majors/params";
import { buildMajorsPayload } from "@/lib/reports/majors/shape";
import { buildMajorsWorkbook, majorsFileName } from "@/lib/reports/majors/workbook";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Test seam: route tests swap the loader so no S3 call is made. */
export const majorsExportDeps = {
  load: loadMajorsSources,
  now: () => new Date(),
};

/** One aggregate-only workbook: Incoming, Majors, Majors incl Undeclared, Minors, Trends. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "majors");
  if (denied) return denied;
  try {
    const sources = await majorsExportDeps.load();
    const payload = buildMajorsPayload(sources, majorsParamsFromUrl(req.url), majorsExportDeps.now());
    if (payload.status !== "ready") {
      return NextResponse.json({ error: payload.message, missing: payload.missing }, { status: 409, headers: NO_STORE });
    }
    const buf = buildMajorsWorkbook(payload);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${majorsFileName(payload)}"`,
        ...NO_STORE,
      },
    });
  } catch (error) {
    console.error("majors-export failed", error);
    return NextResponse.json({ error: "Unable to build the Majors and Minors workbook" }, { status: 503, headers: NO_STORE });
  }
}
