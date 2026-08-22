import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { AdvancementOverviewSnapshot } from "@/lib/reports/advancement-overview/shape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY =
  process.env.ADVANCEMENT_OVERVIEW_CACHE_KEY || "advancement-overview/latest.json";

async function readCache(): Promise<AdvancementOverviewSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as AdvancementOverviewSnapshot;
  } catch {
    return null;
  }
}

async function invokeBuild(): Promise<AdvancementOverviewSnapshot | null> {
  const fn = (process.env.ADVANCEMENT_OVERVIEW_FN_NAME || "").trim();
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
  const data = JSON.parse(text) as AdvancementOverviewSnapshot & {
    errorMessage?: string;
    error?: string;
  };
  if (out.FunctionError) {
    throw new Error(data.errorMessage || data.error || out.FunctionError);
  }
  return data;
}

function cacheIsCurrent(cached: AdvancementOverviewSnapshot | null): boolean {
  return Boolean(
    cached?.kpis &&
      Array.isArray(cached.fiscalYears) &&
      cached.fiscalYears.length >= 2,
  );
}

/** FY Advancement Overview from DATA_BUCKET/advancement-overview/latest.json. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "advancement");
  if (denied) return denied;

  const cached = await readCache();
  if (cacheIsCurrent(cached)) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  try {
    const live = await invokeBuild();
    if (live?.kpis) {
      return NextResponse.json(live, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
  } catch (e) {
    if (cached?.kpis) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Advancement overview data unavailable",
      },
      { status: 502 },
    );
  }

  if (cached?.kpis) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  return NextResponse.json(
    {
      error:
        "Advancement overview cache not published yet (DATA_BUCKET/advancement-overview/latest.json).",
    },
    { status: 503 },
  );
}
