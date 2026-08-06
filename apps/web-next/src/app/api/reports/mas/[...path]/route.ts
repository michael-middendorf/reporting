import { NextResponse } from "next/server";
import {
  dataBucket,
  requireReportAccess,
  safeKey,
  streamS3Object,
} from "@/lib/s3-proxy";

type Ctx = { params: Promise<{ path: string[] }> };

/** Serve MAS giving artifacts from DATA_BUCKET/mas/data/*. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "mas");
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
    const primary = await streamS3Object(bucket, safeKey(path, "mas/data"));
    if (primary.status !== 404) return primary;
    return primary;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("MAS data proxy error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
