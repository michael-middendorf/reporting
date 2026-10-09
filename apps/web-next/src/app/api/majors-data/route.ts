import { NextResponse } from "next/server";
import { loadMajorsSources } from "@/lib/reports/majors/load";
import { majorsParamsFromUrl } from "@/lib/reports/majors/params";
import { buildMajorsPayload } from "@/lib/reports/majors/shape";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Test seam: route tests swap the loader so no S3 call is made. */
export const majorsDataDeps = {
  load: loadMajorsSources,
  now: () => new Date(),
};

/**
 * DST-3015 Majors and Minors. Aggregate counts only: no PEOPLE_CODE_ID, name,
 * or per-student row is ever returned (FERPA). Before the first nightly publish
 * with the new columns, returns status "waiting" (HTTP 200) instead of numbers.
 */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "majors");
  if (denied) return denied;
  try {
    const sources = await majorsDataDeps.load();
    const payload = buildMajorsPayload(sources, majorsParamsFromUrl(req.url), majorsDataDeps.now());
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (error) {
    console.error("majors-data failed", error);
    return NextResponse.json({ error: "Unable to load the Majors and Minors report" }, { status: 503, headers: NO_STORE });
  }
}
