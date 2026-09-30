import { readFile } from "node:fs/promises";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import {
  isPipelineReady,
  type AdvancementPipelineSnapshot,
} from "@/lib/reports/advancement-pipeline/shape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY =
  process.env.ADVANCEMENT_PIPELINE_CACHE_KEY || "advancement-overview/pipeline.json";

async function readS3(): Promise<AdvancementPipelineSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as AdvancementPipelineSnapshot;
  } catch {
    return null;
  }
}

async function readLocal(): Promise<AdvancementPipelineSnapshot | null> {
  if (process.env.NODE_ENV === "production") return null;
  const path = (process.env.ADVANCEMENT_PIPELINE_LOCAL_JSON || "").trim();
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as AdvancementPipelineSnapshot;
  } catch {
    return null;
  }
}

/**
 * The Advancement Overview Lambda writes pipeline.json right after latest.json,
 * so a cold cache is filled by invoking it once and reading S3 again. Returns
 * false when the function name is not configured.
 */
async function invokeOverviewBuild(): Promise<boolean> {
  const fn = (process.env.ADVANCEMENT_OVERVIEW_FN_NAME || "").trim();
  if (!fn) return false;
  const out = await new LambdaClient({ region }).send(
    new InvokeCommand({
      FunctionName: fn,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify({})),
    }),
  );
  if (out.FunctionError) {
    const text = out.Payload ? new TextDecoder().decode(out.Payload) : "";
    let message = out.FunctionError;
    try {
      const data = JSON.parse(text) as { errorMessage?: string };
      message = data.errorMessage || message;
    } catch {
      // keep FunctionError
    }
    throw new Error(message);
  }
  return true;
}

/** Test seam. Production reads DATA_BUCKET/advancement-overview/pipeline.json. */
export const pipelineCache = {
  readLocal,
  read: readS3,
  build: invokeOverviewBuild,
};

function ok(data: AdvancementPipelineSnapshot, maxAge: number) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": `private, max-age=${maxAge}` },
  });
}

/** Gift pipeline detail (asks by stage) for /advancement/pipeline. */
export async function GET(req: Request) {
  // Server-side gate: the /advancement layout also admits chapel, points, and
  // portfolios users, so the page gate alone is not enough.
  const denied = requireReportAccess(req, "advancement");
  if (denied) return denied;

  const local = await pipelineCache.readLocal();
  if (isPipelineReady(local)) return ok(local, 5);

  const cached = await pipelineCache.read();
  if (isPipelineReady(cached)) return ok(cached, 30);

  try {
    if (await pipelineCache.build()) {
      const fresh = await pipelineCache.read();
      if (isPipelineReady(fresh)) return ok(fresh, 30);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gift pipeline data unavailable" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      error:
        "Gift pipeline detail is not published yet. It refreshes every 15 minutes with the Advancement Overview.",
    },
    { status: 503 },
  );
}
