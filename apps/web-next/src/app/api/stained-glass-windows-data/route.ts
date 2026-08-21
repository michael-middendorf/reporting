import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { StainedGlassSnapshot } from "@/lib/reports/stained-glass-windows/shape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY =
  process.env.STAINED_GLASS_WINDOWS_CACHE_KEY || "stained-glass-windows/latest.json";

async function readCache(): Promise<StainedGlassSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as StainedGlassSnapshot;
  } catch {
    return null;
  }
}

async function invokeBuild(): Promise<StainedGlassSnapshot | null> {
  const fn = (process.env.STAINED_GLASS_WINDOWS_FN_NAME || "").trim();
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
  const data = JSON.parse(text) as StainedGlassSnapshot & {
    errorMessage?: string;
    error?: string;
  };
  if (out.FunctionError) {
    throw new Error(data.errorMessage || data.error || out.FunctionError);
  }
  return data;
}

/** Named stained-glass windows from DATA_BUCKET/stained-glass-windows/latest.json. */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "advancement");
  if (denied) return denied;

  const cached = await readCache();
  if (cached?.windows) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  try {
    const live = await invokeBuild();
    if (live?.windows) {
      return NextResponse.json(live, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Stained glass window data unavailable",
        windows: [],
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      error:
        "Stained glass window cache not published yet (DATA_BUCKET/stained-glass-windows/latest.json).",
      windows: [],
    },
    { status: 503 },
  );
}
