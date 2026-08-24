import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { FallAppealSnapshot } from "@/lib/reports/fall-appeal/shape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY = process.env.FALL_APPEAL_CACHE_KEY || "fall-appeal/latest.json";

async function readCache(): Promise<FallAppealSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as FallAppealSnapshot;
  } catch {
    return null;
  }
}

async function invokeBuild(): Promise<FallAppealSnapshot | null> {
  const fn = (process.env.FALL_APPEAL_FN_NAME || "").trim();
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
  const data = JSON.parse(text) as FallAppealSnapshot & {
    errorMessage?: string;
    error?: string;
  };
  if (out.FunctionError) {
    throw new Error(data.errorMessage || data.error || out.FunctionError);
  }
  return data;
}

/** Fall Appeal snapshot from DATA_BUCKET/fall-appeal/latest.json. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "advancement");
  if (denied) return denied;

  const cached = await readCache();
  if (cached?.summary) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  try {
    const live = await invokeBuild();
    if (live?.summary) {
      return NextResponse.json(live, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Fall Appeal data unavailable",
        campaign: "2026 Fall Appeal",
        empty: true,
        summary: { totalRevenue: 0, totalGifts: 0, avgGift: 0, medianGift: 0, donors: 0 },
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      error:
        "Fall Appeal cache not published yet (DATA_BUCKET/fall-appeal/latest.json).",
      campaign: "2026 Fall Appeal",
      empty: true,
      summary: { totalRevenue: 0, totalGifts: 0, avgGift: 0, medianGift: 0, donors: 0 },
    },
    { status: 503 },
  );
}
