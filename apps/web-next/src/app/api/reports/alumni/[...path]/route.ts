import { NextResponse } from "next/server";
import {
  MAS_REPORT_BUCKET,
  requireReportAccess,
  safeKey,
  streamS3Object,
} from "@/lib/s3-proxy";

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * Alumni report artifacts — prefer unified DATA_BUCKET/alumni, fall back to
 * publishing under MAS report bucket alumni/ if present.
 */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "alumni");
  if (denied) return denied;

  const { path } = await ctx.params;
  if (!path?.length) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  const dataBucket = process.env.DATA_BUCKET || "";
  try {
    if (dataBucket) {
      const primary = await streamS3Object(dataBucket, safeKey(path, "alumni"));
      if (primary.status !== 404) return primary;
    }
    const fallback = await streamS3Object(
      MAS_REPORT_BUCKET,
      safeKey(path, "alumni/data"),
    );
    if (fallback.status !== 404) return fallback;

    return NextResponse.json(
      {
        error: "Not found",
        hint: "Publish alumni JSON under DATA_BUCKET/alumni/ (summary.json, etc.).",
      },
      { status: 404 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
