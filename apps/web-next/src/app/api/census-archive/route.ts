import { NextResponse } from "next/server";
import { loadArchiveManifest } from "@/lib/reports/census/archive-store";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";

/** Auth-gated list of official census workbooks. File bytes stay in the data bucket. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  const manifest = await loadArchiveManifest();
  if (!manifest) {
    return NextResponse.json({ generated: null, source: "", files: [] });
  }
  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
