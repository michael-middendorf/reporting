import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { canAccessReport, type ReportId } from "@/lib/access";
import { currentUserEmail } from "@/lib/auth";
import { housingLocalDevEnabled } from "@/lib/housing-local-dev";

const region = process.env.AWS_REGION || "us-east-2";

/** Unified SST ReportData bucket — sole read path for this app. */
export function dataBucket() {
  return (process.env.DATA_BUCKET || "").trim();
}

export function s3() {
  return new S3Client({ region });
}

export function requireUser(req: Request) {
  if (!currentUserEmail(req)) {
    return NextResponse.json(
      { error: "Authentication required", redirect: "/" },
      { status: 401 },
    );
  }
  return null;
}

/** Require login + access to a specific report. */
export function requireReportAccess(req: Request, report: ReportId) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json(
      { error: "Authentication required", redirect: "/" },
      { status: 401 },
    );
  }
  if (!canAccessReport(email, report)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Local-dev skip for housing reads and room-overlay POST. Never on in production. */
export function requireHousingPreviewAccess(req: Request) {
  if (housingLocalDevEnabled()) return null;
  return requireReportAccess(req, "housing");
}

export async function streamS3Object(bucket: string, key: string) {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = out.Body;
    if (!body) {
      return NextResponse.json({ error: "Empty object", bucket, key }, { status: 404 });
    }
    const bytes = await body.transformToByteArray();
    const contentType =
      out.ContentType ||
      (key.endsWith(".json")
        ? "application/json; charset=utf-8"
        : key.endsWith(".csv")
          ? "text/csv; charset=utf-8"
          : "application/octet-stream");
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e: unknown) {
    const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    const code = err.name || err.Code || "";
    const http = err.$metadata?.httpStatusCode;
    if (code === "NoSuchKey" || code === "NotFound" || http === 404) {
      return NextResponse.json({ error: "Not found", bucket, key }, { status: 404 });
    }
    throw e;
  }
}

/** Normalize path segments and block traversal. */
export function safeKey(parts: string[], prefix: string) {
  const cleaned = parts
    .map((p) => decodeURIComponent(p))
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
  if (!cleaned || cleaned.includes("..")) {
    throw new Error("Invalid path");
  }
  const base = prefix.replace(/\/+$/, "");
  return base ? `${base}/${cleaned}` : cleaned;
}
