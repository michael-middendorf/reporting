import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { dataBucket, s3 } from "@/lib/s3-proxy";
import { EMAIL_PERFORMANCE_KEY, parseEmailPerformanceCsv } from "@/lib/reports/fall-appeal/email-import";

export const dynamic = "force-dynamic";
const MAX_BYTES = 128 * 1024;

export async function POST(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isAdmin(email)) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = Buffer.from(await req.arrayBuffer());
  if (!body.length || body.length > MAX_BYTES) return NextResponse.json({ error: "CSV must be between 1 byte and 128 KB" }, { status: 400 });
  try {
    const snapshot = parseEmailPerformanceCsv(body.toString("utf8"));
    const bucket = dataBucket(); if (!bucket) throw new Error("DATA_BUCKET is not configured");
    await s3().send(new PutObjectCommand({ Bucket: bucket, Key: EMAIL_PERFORMANCE_KEY, Body: JSON.stringify(snapshot), ContentType: "application/json; charset=utf-8", CacheControl: "no-store" }));
    return NextResponse.json({ ok: true, segments: snapshot.segments.length, availableAfter: "next hourly Fall Appeal refresh" });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "CSV import failed" }, { status: 400 }); }
}
