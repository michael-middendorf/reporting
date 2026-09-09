import { NextResponse } from "next/server";
import { requireHousingPreviewAccess } from "@/lib/s3-proxy";
import {
  putJsonObject,
  readJsonObject,
  readResidents,
  VERIFICATION_STATE_KEY,
  type VerificationState,
} from "@/lib/reports/housing/store";

export const dynamic = "force-dynamic";

const emptyState = (): VerificationState => ({ edits: {}, notes: [] });

export async function GET(req: Request) {
  const denied = requireHousingPreviewAccess(req);
  if (denied) return denied;

  try {
    const residents = await readResidents();
    const state = (await readJsonObject<VerificationState>(VERIFICATION_STATE_KEY)) || emptyState();
    if (!state.edits) state.edits = {};
    if (!Array.isArray(state.notes)) state.notes = [];
    return NextResponse.json(
      { candidates: residents?.verification_candidates || [], state },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = requireHousingPreviewAccess(req);
  if (denied) return denied;

  let body: { edits?: Record<string, unknown>; notes?: unknown[] };
  try {
    body = (await req.json()) as { edits?: Record<string, unknown>; notes?: unknown[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await putJsonObject(VERIFICATION_STATE_KEY, {
      edits: body.edits && typeof body.edits === "object" ? body.edits : {},
      notes: Array.isArray(body.notes) ? body.notes : [],
    });
    return NextResponse.json({ ok: true, persisted: "s3" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
