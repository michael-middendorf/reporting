import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";

/**
 * Same-origin proxy for the Institute dashboard payload from
 * DATA_BUCKET/institute/latest.json (published by the InstituteRefresh cron,
 * which runs the six Slate queries + build.payload). Small (~0.5 MB) so it is
 * returned inline as JSON — no presigning/gzip like the enrollment reports.
 */
const region = process.env.AWS_REGION || "us-east-2";
const DATA_KEY = process.env.INSTITUTE_DATA_KEY || "institute/latest.json";

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "institute");
  if (denied) return denied;

  const bucket = (process.env.DATA_BUCKET || "").trim();
  if (!bucket) {
    return NextResponse.json({ error: "DATA_BUCKET is not configured" }, { status: 500 });
  }

  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: DATA_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) {
      return NextResponse.json(
        { error: "Institute data is empty", buildings: [] },
        { status: 503 },
      );
    }
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      data.source = data.source || "s3-cache";
    }
    return new NextResponse(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const http = err.$metadata?.httpStatusCode;
    if (err.name === "NoSuchKey" || err.name === "NotFound" || http === 404) {
      return NextResponse.json(
        {
          error:
            "Institute cache not published yet (DATA_BUCKET/institute/latest.json). Wait for the InstituteRefresh cron.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
