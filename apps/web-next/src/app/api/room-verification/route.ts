import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import {
  putJsonObject,
  readJsonObject,
  ROOM_VERIFICATION_STATE_KEY,
  type RoomVerificationState,
} from "@/lib/reports/housing/store";

export const dynamic = "force-dynamic";

const emptyState = (): RoomVerificationState => ({ edits: {} });

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "housing");
  if (denied) return denied;

  try {
    const state = (await readJsonObject<RoomVerificationState>(ROOM_VERIFICATION_STATE_KEY)) || emptyState();
    if (!state.edits) state.edits = {};
    return NextResponse.json({ state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = requireReportAccess(req, "housing");
  if (denied) return denied;

  let body: { edits?: Record<string, unknown> };
  try {
    body = (await req.json()) as { edits?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await putJsonObject(ROOM_VERIFICATION_STATE_KEY, {
      edits: body.edits && typeof body.edits === "object" ? body.edits : {},
    });
    return NextResponse.json({ ok: true, persisted: "s3" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
