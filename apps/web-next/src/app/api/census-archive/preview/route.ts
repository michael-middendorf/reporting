import { NextResponse } from "next/server";
import { findArchiveFile, loadArchiveManifest, loadArchiveSheet } from "@/lib/reports/census/archive-store";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";

/** One sheet from a published census workbook. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const sheet = Number(url.searchParams.get("sheet") || "0");
  if (!Number.isInteger(sheet) || sheet < 0) {
    return NextResponse.json({ error: "Invalid sheet" }, { status: 400 });
  }
  const manifest = await loadArchiveManifest();
  const file = manifest ? findArchiveFile(manifest, id) : null;
  if (!file || file.kind !== "workbook" || sheet >= file.sheets.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const preview = await loadArchiveSheet(file.id, sheet);
  if (!preview) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(preview, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
