import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { AnnunciationSnapshot } from "@/lib/reports/annunciation/shape";

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY =
  process.env.ANNUNCIATION_CACHE_KEY || "annunciation/latest.json";

async function readCache(): Promise<AnnunciationSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as AnnunciationSnapshot;
  } catch {
    return null;
  }
}

/** Annunciation Circle members from DATA_BUCKET/annunciation/latest.json (AnnunciationRefresh cron). */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "annunciation");
  if (denied) return denied;

  const cached = await readCache();
  if (cached) {
    return NextResponse.json(cached);
  }

  const key = process.env.VIRTUOUS_API_KEY || "";
  const configured = Boolean(key) && key !== "PLACEHOLDER";
  return NextResponse.json(
    {
      error: configured
        ? "Annunciation cache not published yet (DATA_BUCKET/annunciation/latest.json). Secrets are set — wait for AnnunciationRefresh."
        : "Annunciation cache empty and Virtuous secret not configured.",
      members: [],
    },
    { status: 503 },
  );
}
