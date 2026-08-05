import { NextResponse } from "next/server";
import {
  MAS_REPORT_BUCKET,
  requireUser,
  safeKey,
  streamS3Object,
} from "@/lib/s3-proxy";

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * Serve MAS giving report artifacts from the legacy report bucket.
 * Keys live under data/ (e.g. data/metadata.json).
 */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireUser(req);
  if (denied) return denied;

  const { path } = await ctx.params;
  if (!path?.length) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  try {
    // Primary: data/<file> on the public report bucket (how the old CF site published)
    const primary = await streamS3Object(MAS_REPORT_BUCKET, safeKey(path, "data"));
    if (primary.status !== 404) return primary;

    // Fallback: some publishes used a bare prefix (no data/)
    const fallback = await streamS3Object(MAS_REPORT_BUCKET, safeKey(path, ""));
    if (fallback.status !== 404) return fallback;

    return primary;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("MAS data proxy error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
