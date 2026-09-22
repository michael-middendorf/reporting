import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { dataBucket, s3 } from "@/lib/s3-proxy";
import { appealCampaign } from "@/lib/reports/appeals/config";
import { parseAppealImport, type ImportDataset } from "@/lib/reports/appeals/imports";

export const dynamic = "force-dynamic";
const MAX_BYTES = 128 * 1024;
const DATASETS: ImportDataset[] = ["mail", "email", "digital"];

export async function POST(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isAdmin(email)) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const url = new URL(req.url);
  const campaign = appealCampaign(url.searchParams.get("campaign"));
  const dataset = url.searchParams.get("dataset") as ImportDataset | null;
  if (!campaign || !dataset || !DATASETS.includes(dataset)) return NextResponse.json({ error: "A supported campaign and dataset are required" }, { status: 400 });
  const body = Buffer.from(await req.arrayBuffer());
  if (!body.length || body.length > MAX_BYTES) return NextResponse.json({ error: "CSV must be between 1 byte and 128 KB" }, { status: 400 });
  try {
    const snapshot = parseAppealImport(body.toString("utf8"), dataset, campaign.slug);
    const bucket = dataBucket(); if (!bucket) throw new Error("DATA_BUCKET is not configured");
    const key = `appeals/${campaign.slug}/imports/${dataset}.json`;
    await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(snapshot), ContentType: "application/json; charset=utf-8", CacheControl: "no-store" }));
    return NextResponse.json({ ok: true, rows: snapshot.rows.length, availableAfter: "next hourly Appeals refresh" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CSV import failed" }, { status: 400 });
  }
}
