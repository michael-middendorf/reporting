import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { MgoAnalysisSnapshot } from "@/lib/reports/mgo-analysis/shape";

export const dynamic = "force-dynamic";

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY =
  process.env.MGO_ANALYSIS_CACHE_KEY || "mgo-analysis/latest.json";

async function readCache(): Promise<MgoAnalysisSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as MgoAnalysisSnapshot;
  } catch {
    return null;
  }
}

/**
 * MGO Analysis and Management (DST-2830) from DATA_BUCKET/mgo-analysis/latest.json.
 * Cache-only on purpose: the MgoAnalysisData Lambda is a full Virtuous pull
 * (minutes long), so page loads never invoke it. The cron publishes the snapshot.
 */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "mgo-analysis");
  if (denied) return denied;

  const cached = await readCache();
  if (cached?.donors) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  return NextResponse.json(
    {
      error:
        "MGO analysis data is not published yet. It refreshes every 30 minutes; try again shortly.",
      donors: [],
    },
    { status: 503 },
  );
}
