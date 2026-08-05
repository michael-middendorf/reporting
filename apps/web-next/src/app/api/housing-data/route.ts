import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { buildingsFromRecords, type HousingRecord } from "@/lib/reports/housing/shape";

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY = "housing/latest.json";

async function readCache(): Promise<{
  records?: HousingRecord[];
  buildings?: ReturnType<typeof buildingsFromRecords>;
  session?: string;
  cached_at?: string;
  source?: string;
  total?: number;
} | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Housing occupancy from DATA_BUCKET/housing/latest.json (HousingRefresh cron). */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "housing");
  if (denied) return denied;

  const cached = await readCache();
  if (cached) {
    const buildings =
      cached.buildings ||
      buildingsFromRecords(Array.isArray(cached.records) ? cached.records : []);
    return NextResponse.json({
      buildings,
      planning: {
        session: cached.session || "—",
        total: cached.total ?? buildings.reduce((s, b) => s + (b.occupied || 0), 0),
        cached_at: cached.cached_at || "—",
      },
      source: cached.source || "s3-cache",
    });
  }

  const qlik = process.env.QLIK_API_KEY || "";
  const tenant = process.env.QLIK_TENANT || "";
  const configured =
    Boolean(qlik) &&
    qlik !== "PLACEHOLDER" &&
    Boolean(tenant) &&
    tenant !== "PLACEHOLDER";

  return NextResponse.json(
    {
      error: configured
        ? "Housing cache not published yet (DATA_BUCKET/housing/latest.json). Secrets are set — wait for HousingRefresh."
        : "Housing cache empty and Qlik secrets not configured.",
      buildings: [],
    },
    { status: 503 },
  );
}
