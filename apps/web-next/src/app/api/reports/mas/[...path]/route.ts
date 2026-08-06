import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { fetchProcessedArtifact } from "@/lib/process-invoke";

type Ctx = { params: Promise<{ path: string[] }> };

/** MAS artifacts derived on-read from sources/virtuous via MasProcess Lambda. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "mas");
  if (denied) return denied;

  const { path } = await ctx.params;
  if (!path?.length) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  const artifact = path.join("/");

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
        },
      });
    }
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, max-age=120" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("MAS process error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
