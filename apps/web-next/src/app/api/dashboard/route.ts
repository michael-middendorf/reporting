import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { dataBucket, requireReportAccess } from "@/lib/s3-proxy";

/** Enrollment dashboard metadata from DATA_BUCKET/enrollment/ (no S3 presigns). */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "enrollment");
  if (denied) return denied;

  const bucket = dataBucket();
  if (!bucket) {
    return NextResponse.json(
      { success: false, error: "DATA_BUCKET is not configured" },
      { status: 500 },
    );
  }
  const manifestKey =
    process.env.ENROLLMENT_MANIFEST_KEY || "enrollment/slate-report-cache.json";
  const region = process.env.AWS_REGION || "us-east-2";
  const s3 = new S3Client({ region });

  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: manifestKey }));
    const manifest = JSON.parse(await obj.Body!.transformToString());
    const reportsMeta = (manifest.reports || {}) as Record<string, Record<string, unknown>>;

    return NextResponse.json({
      success: true,
      mode: "dashboard",
      source: "report-data",
      inline: false,
      bucket,
      key: manifestKey,
      generated_at: manifest.generated_at,
      // Same-origin /api/enrollment/:name is the data path; keep empty map for compatibility.
      report_presigned_urls: {},
      manifest: {
        success: manifest.success,
        generated_at: manifest.generated_at,
        report_order: manifest.report_order,
        reports: Object.fromEntries(
          Object.entries(reportsMeta).map(([name, meta]) => [
            name,
            {
              success: meta.success,
              row_count: meta.row_count,
              json_key: meta.json_key,
              gzip_key: meta.gzip_key,
              error: meta.error,
            },
          ]),
        ),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
