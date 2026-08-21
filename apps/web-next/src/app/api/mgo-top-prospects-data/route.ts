import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { MgoTopProspectsSnapshot } from "@/lib/reports/mgo-top-prospects/shape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY =
  process.env.MGO_TOP_PROSPECTS_CACHE_KEY || "mgo-top-prospects/latest.json";

async function readCache(): Promise<MgoTopProspectsSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as MgoTopProspectsSnapshot;
  } catch {
    return null;
  }
}

async function invokeBuild(): Promise<MgoTopProspectsSnapshot | null> {
  const fn = (process.env.MGO_TOP_PROSPECTS_FN_NAME || "").trim();
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
  const data = JSON.parse(text) as MgoTopProspectsSnapshot & {
    errorMessage?: string;
    error?: string;
  };
  if (out.FunctionError) {
    throw new Error(data.errorMessage || data.error || out.FunctionError);
  }
  return data;
}

/** FY MGO Top Prospects from DATA_BUCKET/mgo-top-prospects/latest.json. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "advancement");
  if (denied) return denied;

  const cached = await readCache();
  if (cached?.portfolios) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  try {
    const live = await invokeBuild();
    if (live?.portfolios) {
      return NextResponse.json(live, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "MGO top prospects data unavailable",
        portfolios: [],
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      error:
        "MGO top prospects cache not published yet (DATA_BUCKET/mgo-top-prospects/latest.json).",
      portfolios: [],
    },
    { status: 503 },
  );
}
