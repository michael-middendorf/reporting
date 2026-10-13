import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { GalaHistoryRow, GalaPayload } from "@/lib/reports/gala/shape";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const region = process.env.AWS_REGION || "us-east-2";
const LATEST_KEY = "gala/latest.json";
const INDEX_KEY = "gala/snapshots/index.json";
const NO_STORE = { "Cache-Control": "private, no-store" };

async function readJson<T>(key: string): Promise<T | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Test seam. Production reads DATA_BUCKET/gala/latest.json and gala/snapshots/index.json. */
export const galaCache = {
  readLatest: () => readJson<GalaPayload>(LATEST_KEY),
  readIndex: () => readJson<GalaHistoryRow[]>(INDEX_KEY),
};

/**
 * Chancellor's Gala report (DST-3095). Cache-only: the GalaReportData Lambda
 * pulls the feed on its hourly cron, and page loads never call it.
 */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "gala");
  if (denied) return denied;

  const latest = await galaCache.readLatest();
  if (!latest || typeof latest !== "object" || !latest.categories) {
    return NextResponse.json(
      { error: "The gala report is not published yet. It refreshes hourly; try again later." },
      { status: 503, headers: NO_STORE },
    );
  }
  const index = await galaCache.readIndex();
  const history = Array.isArray(index) ? index : [];
  return NextResponse.json({ latest, history }, { headers: NO_STORE });
}
