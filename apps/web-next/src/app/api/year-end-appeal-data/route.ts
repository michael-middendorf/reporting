import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { emptySnapshot, normalizeSnapshot, type YearEndSnapshot } from "@/lib/reports/year-end-appeal/shape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY = process.env.YEAR_END_CACHE_KEY || "year-end-appeal/latest.json";

async function readCache(): Promise<YearEndSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as YearEndSnapshot;
  } catch {
    return null;
  }
}

async function invokeBuild(): Promise<YearEndSnapshot | null> {
  const fn = (process.env.YEAR_END_APPEAL_FN_NAME || "").trim();
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
  const data = JSON.parse(text) as YearEndSnapshot & {
    errorMessage?: string;
    error?: string;
  };
  if (out.FunctionError) {
    throw new Error(data.errorMessage || data.error || out.FunctionError);
  }
  return data;
}

/** Year-End Appeal snapshot from DATA_BUCKET/year-end-appeal/latest.json. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "advancement");
  if (denied) return denied;

  const cached = await readCache();
  if (cached?.summary) {
    return NextResponse.json(normalizeSnapshot(cached), {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  try {
    const live = await invokeBuild();
    if (live?.summary) {
      return NextResponse.json(normalizeSnapshot(live), {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
  } catch (e) {
    return NextResponse.json(
      emptySnapshot({ error: e instanceof Error ? e.message : "Year-End Appeal data unavailable" }),
      { status: 502 },
    );
  }

  return NextResponse.json(
    emptySnapshot({
      error: "Year-End Appeal cache not published yet (DATA_BUCKET/year-end-appeal/latest.json).",
    }),
    { status: 503 },
  );
}
