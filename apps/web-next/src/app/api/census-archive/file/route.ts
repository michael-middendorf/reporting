import { NextResponse } from "next/server";
import { contentDisposition } from "@/lib/reports/census/archive";
import { findArchiveFile, loadArchiveManifest, readArchiveFile } from "@/lib/reports/census/archive-store";
import { requireReportAccess } from "@/lib/s3-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Auth-gated download of one official census file. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "census");
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") || "";
  const manifest = await loadArchiveManifest();
  const file = manifest ? findArchiveFile(manifest, id) : null;
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await readArchiveFile(file.id);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": file.contentType || "application/octet-stream",
      "Content-Disposition": contentDisposition(file.name, "attachment"),
      "Cache-Control": "private, max-age=300",
    },
  });
}
