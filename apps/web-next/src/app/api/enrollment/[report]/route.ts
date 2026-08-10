import { NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { requireReportAccess } from "@/lib/s3-proxy";
import { loadLatestPointer, loadSourceRows } from "@/lib/sources";

/**
 * Enrollment report rows from sources/slate/{dataset}/_latest.
 * Returns JSON `{ row: [...] }` for existing enrollment processors.
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
    const { rows, latest } = await loadSourceRows("slate", dataset);
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
