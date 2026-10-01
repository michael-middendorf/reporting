import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { MgoAnalysisSnapshot } from "@/lib/reports/mgo-analysis/shape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY =
  process.env.MGO_ANALYSIS_CACHE_KEY || "mgo-analysis/latest.json";

async function readCache(): Promise<MgoAnalysisSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as MgoAnalysisSnapshot;
  } catch {
    return null;
  }
}

async function invokeBuild(): Promise<MgoAnalysisSnapshot | null> {
  const fn = (process.env.MGO_ANALYSIS_FN_NAME || "").trim();
  if (!fn) return null;
  const out = await new LambdaClient({ region }).send(
    new InvokeCommand({
      FunctionName: fn,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify({})),
    }),
  );
  const text = out.Payload ? new TextDecoder().decode(out.Payload) : "";
  if (!text) return null;
  const data = JSON.parse(text) as MgoAnalysisSnapshot & {
    errorMessage?: string;
    error?: string;
  };
  if (out.FunctionError) {
    throw new Error(data.errorMessage || data.error || out.FunctionError);
  }
  return data;
}

/** MGO Analysis and Management (DST-2830) from DATA_BUCKET/mgo-analysis/latest.json. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "mgo-analysis");
  if (denied) return denied;

  const cached = await readCache();
  if (cached?.donors) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  try {
    const live = await invokeBuild();
    if (live?.donors) {
      return NextResponse.json(live, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "MGO analysis data unavailable",
        donors: [],
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      error:
        "MGO analysis cache not published yet (DATA_BUCKET/mgo-analysis/latest.json).",
      donors: [],
    },
    { status: 503 },
  );
}
