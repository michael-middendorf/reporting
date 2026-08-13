import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { dataBucket, requireReportAccess, s3 } from "@/lib/s3-proxy";
import { fetchProcessedArtifact } from "@/lib/process-invoke";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

type Ctx = { params: Promise<{ path: string[] }> };

const region = process.env.AWS_REGION || "us-east-2";

function safeCacheKey(artifact: string) {
  const cleaned = artifact
    .split("/")
    .map((p) => decodeURIComponent(p))
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
  if (!cleaned || cleaned.includes("..")) return null;
  return `cache/mas/${cleaned}`;
}

async function readMasCache(artifact: string): Promise<unknown | null> {
  const key = safeCacheKey(artifact);
  const bucket = dataBucket();
  if (!key || !bucket) return null;
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await out.Body?.transformToByteArray();
    if (!bytes) return null;
    const text = Buffer.from(bytes).toString("utf-8");
    if (artifact.endsWith(".csv") || artifact.endsWith(".txt")) return text;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function warmMasProcess() {
  const name = (process.env.MAS_PROCESS_FUNCTION || "").trim();
  if (!name) return;
  try {
    await new LambdaClient({ region }).send(
      new InvokeCommand({
        FunctionName: name,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ warm_only: true })),
      }),
    );
  } catch (e) {
    console.error("MAS warm invoke failed", e);
  }
}

/** MAS artifacts: prefer cache/mas (filled by MasProcess); fall back to sync invoke. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "mas");
  if (denied) return denied;

  const { path } = await ctx.params;
  if (!path?.length) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  const artifact = path.join("/");

  try {
    const cached = await readMasCache(artifact);
    if (cached != null) {
      if (typeof cached === "string") {
        return new NextResponse(cached, {
          status: 200,
          headers: {
            "Content-Type": artifact.endsWith(".csv")
              ? "text/csv; charset=utf-8"
              : "text/plain; charset=utf-8",
            "Cache-Control": "private, max-age=120",
            "X-AMU-Cache": "hit",
          },
        });
      }
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, max-age=120", "X-AMU-Cache": "hit" },
      });
    }

    // Cache miss: kick async warm (pipeline ~2m > CloudFront 60s) and try sync once
    // for small artifacts / warm Lambda memory.
    void warmMasProcess();
    try {
      const body = await fetchProcessedArtifact("MAS_PROCESS_FUNCTION", artifact);
      if (typeof body === "string") {
        return new NextResponse(body, {
          status: 200,
          headers: {
            "Content-Type": artifact.endsWith(".csv")
              ? "text/csv; charset=utf-8"
              : "text/plain; charset=utf-8",
            "Cache-Control": "private, max-age=120",
            "X-AMU-Cache": "miss-sync",
          },
        });
      }
      return NextResponse.json(body, {
        headers: { "Cache-Control": "private, max-age=120", "X-AMU-Cache": "miss-sync" },
      });
    } catch {
      return NextResponse.json(
        {
          error: "MAS report is refreshing — retry in about two minutes",
          warming: true,
        },
        { status: 503, headers: { "Retry-After": "90" } },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("MAS process error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
