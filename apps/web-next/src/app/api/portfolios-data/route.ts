import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { requireReportAccess } from "@/lib/s3-proxy";
import { scopePortfoliosForEmail } from "@/lib/reports/portfolios/scope";
import type { PortfoliosSnapshot } from "@/lib/reports/portfolios/shape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY = process.env.PORTFOLIOS_CACHE_KEY || "portfolios/latest.json";

function isSnapshot(value: PortfoliosSnapshot | null): value is PortfoliosSnapshot {
  return Boolean(value && Array.isArray(value.solicitors) && value.generated_at);
}

async function readCache(): Promise<PortfoliosSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as PortfoliosSnapshot;
  } catch {
    return null;
  }
}

async function invokeBuild(): Promise<PortfoliosSnapshot | null> {
  const fn = (process.env.PORTFOLIOS_FN_NAME || "").trim();
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
  const data = JSON.parse(text) as PortfoliosSnapshot & {
    errorMessage?: string;
    error?: string;
  };
  if (out.FunctionError) {
    throw new Error(data.errorMessage || data.error || out.FunctionError);
  }
  return data;
}

function scopedJson(email: string, snapshot: PortfoliosSnapshot) {
  return NextResponse.json(scopePortfoliosForEmail(email, snapshot), {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}

/** Portfolio snapshot from DATA_BUCKET/portfolios/latest.json, scoped per viewer. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "portfolios");
  if (denied) return denied;

  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json(
      { error: "Authentication required", redirect: "/" },
      { status: 401 },
    );
  }

  const cached = await readCache();
  if (isSnapshot(cached)) {
    return scopedJson(email, cached);
  }

  try {
    const live = await invokeBuild();
    if (isSnapshot(live)) {
      return scopedJson(email, live);
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Portfolios data unavailable",
        solicitors: [],
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      error: "Portfolios cache not published yet (DATA_BUCKET/portfolios/latest.json).",
      solicitors: [],
    },
    { status: 503 },
  );
}
