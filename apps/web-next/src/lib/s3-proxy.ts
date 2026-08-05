import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";

const region = process.env.AWS_REGION || "us-east-2";

export function s3() {
  return new S3Client({ region });
}

export function requireUser(req: Request) {
  if (!currentUserEmail(req)) {
    return NextResponse.json(
      { error: "Authentication required", redirect: "/login" },
      { status: 401 },
    );
  }
  return null;
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

export const MAS_REPORT_BUCKET =
  process.env.MAS_REPORT_BUCKET ||
  "mas-report-report-905418447941-us-east-2";

export const MAS_CACHE_BUCKET =
  process.env.MAS_CACHE_BUCKET ||
  "mas-report-cache-905418447941-us-east-2";

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
