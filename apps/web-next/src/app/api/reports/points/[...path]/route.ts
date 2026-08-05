import { NextResponse } from "next/server";
import {
  MAS_CACHE_BUCKET,
  requireReportAccess,
  safeKey,
  streamS3Object,
} from "@/lib/s3-proxy";

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * Serve MA Points raw JSON from the legacy cache bucket (points/data/*).
 */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;

  const { path } = await ctx.params;
  if (!path?.length) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  try {
    const key = safeKey(path, "points/data");
    return await streamS3Object(MAS_CACHE_BUCKET, key);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("NoSuchKey") || msg.includes("NotFound") ? 404 : 502;
    console.error("Points data proxy error", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
