import { NextResponse } from "next/server";
import {
  dataBucket,
  requireReportAccess,
  safeKey,
  streamS3Object,
} from "@/lib/s3-proxy";

type Ctx = { params: Promise<{ path: string[] }> };

/** Alumni artifacts from DATA_BUCKET/alumni/*. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "alumni");
  if (denied) return denied;

  const { path } = await ctx.params;
  if (!path?.length) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  const bucket = dataBucket();
  if (!bucket) {
    return NextResponse.json({ error: "DATA_BUCKET is not configured" }, { status: 500 });
  }

  try {
    const res = await streamS3Object(bucket, safeKey(path, "alumni"));
    if (res.status !== 404) return res;
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
