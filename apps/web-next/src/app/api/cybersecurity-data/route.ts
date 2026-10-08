import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireCyberAccess } from "@/lib/cyber-access";
import {
  historyDatesFromKeys,
  isCyberSnapshot,
  type CyberDataResponse,
  type CyberSnapshot,
} from "@/lib/cyber/shape";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const region = process.env.AWS_REGION || "us-east-2";
const LATEST_KEY = "cybersecurity/latest.json";
const HISTORY_PREFIX = "cybersecurity/history/";

/** Seam for tests (same pattern as advancement-pipeline-data). */
export const cyberDataSource = {
  async readLatest(): Promise<CyberSnapshot | null> {
    const bucket = (process.env.DATA_BUCKET || "").trim();
    if (!bucket) return null;
    try {
      const out = await new S3Client({ region }).send(
        new GetObjectCommand({ Bucket: bucket, Key: LATEST_KEY }),
      );
      const text = await out.Body?.transformToString();
      if (!text) return null;
      const parsed: unknown = JSON.parse(text);
      return isCyberSnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  async listHistory(): Promise<string[]> {
    const bucket = (process.env.DATA_BUCKET || "").trim();
    if (!bucket) return [];
    try {
      const out = await new S3Client({ region }).send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: HISTORY_PREFIX, MaxKeys: 400 }),
      );
      return historyDatesFromKeys((out.Contents ?? []).map((o) => o.Key ?? ""));
    } catch {
      return [];
    }
  },
};

/**
 * Cybersecurity board snapshot from DATA_BUCKET/cybersecurity/latest.json,
 * written by the security publisher (PR 2). Strict access + fresh Microsoft
 * sign-in via requireCyberAccess. 503 until the first publish.
 */
export async function GET(req: Request) {
  const access = requireCyberAccess(req);
  if (!access.ok) return access.response;

  const [snapshot, history] = await Promise.all([
    cyberDataSource.readLatest(),
    cyberDataSource.listHistory(),
  ]);
  if (!snapshot) {
    return NextResponse.json(
      { error: "not_published", message: "No data published yet." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const body: CyberDataResponse = { snapshot, history };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
