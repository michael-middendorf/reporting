import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { loadLatestPointer, readJson } from "@/lib/sources";

/** Enrollment dashboard metadata from sources/slate catalog pointers. */
const SLATE_DATASETS = [
  "admissions",
  "psw",
  "messages",
  "campus_visits",
  "app_decisions",
  "interactions",
  "slc",
  "islc",
  "slc_students",
  "withdrawn",
];

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "enrollment");
  if (denied) return denied;

  try {
    const reports: Record<string, Record<string, unknown>> = {};
    let generatedAt: string | undefined;
    for (const name of SLATE_DATASETS) {
      try {
        const latest = await loadLatestPointer("slate", name);
        generatedAt = generatedAt || latest.pulled_at;
        reports[name] = {
          success: true,
          row_count: latest.record_count,
          dt: latest.dt,
          prefix: latest.prefix,
        };
      } catch {
        reports[name] = { success: false, error: "missing" };
      }
    }

    let catalogGenerated: string | undefined;
    try {
      const catalog = await readJson<{ generated_at?: string }>("sources/_catalog.json");
      catalogGenerated = catalog.generated_at;
    } catch {
      /* optional */
    }

    return NextResponse.json({
      success: true,
      mode: "dashboard",
      source: "sources/slate",
      inline: false,
      generated_at: generatedAt || catalogGenerated,
      report_presigned_urls: {},
      manifest: {
        success: true,
        generated_at: generatedAt || catalogGenerated,
        report_order: SLATE_DATASETS,
        reports,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
