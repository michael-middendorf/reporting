import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { fetchProcessedArtifact } from "@/lib/process-invoke";

type Ctx = { params: Promise<{ path: string[] }> };

/** Alumni artifacts derived on-read via AlumniProcess Lambda (no derived S3 writes). */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "alumni");
  if (denied) return denied;

  const { path } = await ctx.params;
  if (!path?.length) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  const artifact = path.join("/");

  try {
    const body = await fetchProcessedArtifact("ALUMNI_PROCESS_FUNCTION", artifact, {
      mode: "incremental",
    });
    if (typeof body === "string") {
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": artifact.endsWith(".csv")
            ? "text/csv; charset=utf-8"
            : "text/plain; charset=utf-8",
          "Cache-Control": "private, max-age=300",
        },
      });
    }
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Alumni process error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
