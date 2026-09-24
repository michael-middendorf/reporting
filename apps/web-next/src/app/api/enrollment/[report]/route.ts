import { gzipSync } from "zlib";
import { NextResponse } from "next/server";
import { TOUCHPOINT_INTERACTION_CODES } from "@/lib/reports/enrollment/process.js";
import { requireReportAccess } from "@/lib/s3-proxy";
import { loadSourceRows, loadSourceRowsFiltered } from "@/lib/sources";

/**
 * Enrollment report rows from sources/slate/{dataset}/_latest.
 * Returns gzipped JSON `{ row: [...] }` (Lambda 6MB payload limit).
 */
const REPORT_KEYS: Record<string, string> = {
  admissions: "admissions",
  decisions: "app_decisions",
  app_decisions: "app_decisions",
  psw: "psw",
  slc: "slc",
  withdrawn: "withdrawn",
  campus: "campus_visits",
  campus_visits: "campus_visits",
  ame: "ame",
  messages: "messages",
  interactions: "interactions",
  islc: "islc",
  slc_students: "slc_students",
};

type Ctx = { params: Promise<{ report: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = requireReportAccess(_req, "enrollment");
  if (denied) return denied;

  const { report } = await ctx.params;
  const dataset = REPORT_KEYS[report];
  if (!dataset) {
    return NextResponse.json({ error: `Unknown report: ${report}` }, { status: 404 });
  }

  try {
    // The raw Interactions feed is ~3M rows / several hundred MB decompressed —
    // too large to safely parse in full in this container. Stream + filter to
    // counselor-touchpoint codes as we read, so the full feed is never held in
    // memory at once (only the gzip stream and the ~35k matching rows).
    const { rows, latest } =
      dataset === "interactions"
        ? await loadSourceRowsFiltered("slate", dataset, (r) =>
            Object.prototype.hasOwnProperty.call(
              TOUCHPOINT_INTERACTION_CODES,
              (r as { InteractionCode?: string }).InteractionCode ?? "",
            ),
          )
        : await loadSourceRows("slate", dataset);
    const json = JSON.stringify({ row: rows });
    const gz = gzipSync(Buffer.from(json, "utf-8"));
    return new NextResponse(gz, {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=60",
        "X-AMU-Source": `slate/${dataset}`,
        "X-AMU-Dt": latest.dt,
        "Content-Encoding": "gzip",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const http = err.$metadata?.httpStatusCode;
    if (err.name === "NoSuchKey" || err.name === "NotFound" || http === 404) {
      return NextResponse.json({ error: "Not found", report: dataset }, { status: 404 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
