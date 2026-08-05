import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";

/**
 * Same-origin proxy for enrollment report JSON.
 * Avoids browser→S3 CORS on presigned GETs (root cause of "Failed to fetch").
 *
 * Returns gzip bytes WITHOUT Content-Encoding so CloudFront/Lambda don't
 * double-decode, and so large reports stay under the Lambda payload limit.
 * The client decompresses via DecompressionStream when it sees gzip magic.
 */
const REPORT_KEYS: Record<string, string> = {
  admissions: "admissions",
  decisions: "app_decisions",
  app_decisions: "app_decisions",
  psw: "psw",
  slc: "slc",
  withdrawn: "withdrawn",
  campus: "campus_visits",
  campus_visits: "campus_visits",
};

type Ctx = { params: Promise<{ report: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "enrollment");
  if (denied) return denied;

  const { report } = await ctx.params;
  const s3Name = REPORT_KEYS[report];
  if (!s3Name) {
    return NextResponse.json({ error: `Unknown report: ${report}` }, { status: 404 });
  }

  const bucket =
    process.env.ENROLLMENT_CACHE_BUCKET ||
    process.env.CACHE_BUCKET ||
    "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2";
  const region = process.env.AWS_REGION || "us-east-2";
  const s3 = new S3Client({ region });

  const gzipKey = `dashboard/reports/${s3Name}.json.gz`;
  const jsonKey = `dashboard/reports/${s3Name}.json`;

  try {
    let bytes: Uint8Array;
    let fromGzip = true;
    try {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: gzipKey }));
      bytes = await out.Body!.transformToByteArray();
    } catch {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: jsonKey }));
      bytes = await out.Body!.transformToByteArray();
      fromGzip = false;
    }

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Do NOT set Content-Encoding — keep compressed payload intact for the client.
        "X-AMU-Compressed": fromGzip ? "gzip" : "identity",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const http = err.$metadata?.httpStatusCode;
    if (err.name === "NoSuchKey" || err.name === "NotFound" || http === 404) {
      return NextResponse.json({ error: "Not found", report: s3Name }, { status: 404 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
