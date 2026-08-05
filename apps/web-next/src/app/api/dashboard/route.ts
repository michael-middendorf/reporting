import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";

const REPORT_FILES: Record<string, string> = {
  admissions: "admissions",
  decisions: "app_decisions",
  psw: "psw",
  slc: "slc",
  withdrawn: "withdrawn",
  campus: "campus_visits",
};

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "enrollment");
  if (denied) return denied;

  const bucket =
    process.env.ENROLLMENT_CACHE_BUCKET ||
    process.env.CACHE_BUCKET ||
    "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2";
  const manifestKey = process.env.CACHE_KEY || "dashboard/slate-report-cache.json";
  const expires = parseInt(process.env.PRESIGN_EXPIRATION_SECONDS || "3600", 10);
  const region = process.env.AWS_REGION || "us-east-2";
  const s3 = new S3Client({ region });

  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: manifestKey }));
    const manifest = JSON.parse(await obj.Body!.transformToString());
    const reportsMeta = manifest.reports || {};
    const reportPresigned: Record<string, { json: string; json_gzip: string }> = {};

    for (const s3Name of Object.values(REPORT_FILES)) {
      const entry = reportsMeta[s3Name] || {};
      const jsonKey = entry.json_key || `dashboard/reports/${s3Name}.json`;
      const gzipKey = entry.gzip_key || `${jsonKey}.gz`;
      reportPresigned[s3Name] = {
        json: await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: jsonKey }), {
          expiresIn: expires,
        }),
        json_gzip: await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: gzipKey }),
          { expiresIn: expires },
        ),
      };
    }
    for (const [hub, s3Name] of Object.entries(REPORT_FILES)) {
      if (hub !== s3Name && reportPresigned[s3Name]) {
        reportPresigned[hub] = reportPresigned[s3Name];
      }
    }

    return NextResponse.json({
      success: true,
      mode: "dashboard",
      source: "s3-cache",
      inline: false,
      bucket,
      key: manifestKey,
      generated_at: manifest.generated_at,
      report_presigned_urls: reportPresigned,
      manifest: {
        success: manifest.success,
        generated_at: manifest.generated_at,
        report_order: manifest.report_order,
        reports: Object.fromEntries(
          Object.entries(reportsMeta as Record<string, Record<string, unknown>>).map(
            ([name, meta]) => [
              name,
              {
                success: meta.success,
                row_count: meta.row_count,
                json_key: meta.json_key,
                gzip_key: meta.gzip_key,
                error: meta.error,
              },
            ],
          ),
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
