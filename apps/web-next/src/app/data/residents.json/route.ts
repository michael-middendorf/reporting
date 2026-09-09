import { NextResponse } from "next/server";
import { requireHousingPreviewAccess } from "@/lib/s3-proxy";
import { readResidents } from "@/lib/reports/housing/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireHousingPreviewAccess(req);
  if (denied) return denied;

  try {
    const payload = await readResidents();
    if (!payload) {
      return NextResponse.json(
        {
          error:
            "Housing residents not published yet (cache/housing/residents.json). Wait for HousingRefresh.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
