import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import {
  invokeHousingRebuild,
  putBytes,
  readResidents,
  UPLOAD_KINDS,
  UPLOAD_PREFIX,
} from "@/lib/reports/housing/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 40 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const denied = requireReportAccess(req, "housing");
  if (denied) return denied;

  const { kind } = await ctx.params;
  const fname = UPLOAD_KINDS[kind];
  if (!fname) {
    return NextResponse.json({ error: "unknown upload kind" }, { status: 400 });
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length <= 0 || buf.length > MAX_BYTES) {
    return NextResponse.json({ error: "empty or too-large file" }, { status: 400 });
  }

  try {
    const before = (await readResidents())?.generated || "";
    await putBytes(`${UPLOAD_PREFIX}/${fname}`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await invokeHousingRebuild();
    return NextResponse.json({
      ok: true,
      stored: fname,
      bytes: buf.length,
      persisted: "s3",
      generated_before: before,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
