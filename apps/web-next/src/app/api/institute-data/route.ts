import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { fetchProcessedArtifact } from "@/lib/process-invoke";

/**
 * Same-origin proxy for the Institute dashboard payload.
 *
 * Instead of reading a pre-built S3 cache, this synchronously invokes the
 * InstituteData Lambda, which runs the six Slate "run as service" queries live
 * (~15s) and returns the built payload. That keeps the dashboard always-current
 * with no cron / stale cache. The invoke is IAM-signed by the SDK, so the FERPA
 * payload is never reachable over a public URL.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60; // live Slate fetch can take ~15-25s

const region = process.env.AWS_REGION || "us-east-2";

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "institute");
  if (denied) return denied;

  const fn = (process.env.INSTITUTE_FN_NAME || "").trim();
  if (!fn) {
    return NextResponse.json(
      { error: "INSTITUTE_FN_NAME is not configured" },
      { status: 500 },
    );
  }

  try {
    const out = await new LambdaClient({ region }).send(
      new InvokeCommand({
        FunctionName: fn,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(JSON.stringify({})),
      }),
    );

    const text = out.Payload ? new TextDecoder().decode(out.Payload) : "";
    if (!text) {
      return NextResponse.json(
        { error: "Institute function returned no data" },
        { status: 502 },
      );
    }
    const data = JSON.parse(text);

    // A Python handler that raises returns a 200 invoke with FunctionError set
    // and an { errorMessage, errorType } body — surface it as an upstream error.
    if (out.FunctionError) {
      const msg =
        (data && (data.errorMessage || data.error)) || out.FunctionError;
      return NextResponse.json(
        { error: `Institute data unavailable — ${msg}` },
        { status: 502 },
      );
    }

    return new NextResponse(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Live data; a short cache smooths rapid reloads without going stale.
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to load Institute data",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
