/**
 * /api/reports/points/flags — shared count/remove overrides for the Points report.
 *
 *   GET    -> { flags: { [noteId]: ReviewFlag } }        (read the shared map)
 *   POST   -> body FlagInput; create/update an override   (server stamps identity)
 *   DELETE -> ?noteId=...  ; drop the override (count again)
 *
 * Status "removed" excludes that task from totals. DELETE (or no flag) counts it.
 * Status "assigned" credits an MGO-coded gift (`gift:{id}`) to flag.owner.
 * All verbs require login + access to the `points` report. The reviewer's email
 * (from the signed session) is the authoritative `flaggedBy` / `updatedBy` — the
 * client cannot spoof it. This explicit `flags/` segment takes precedence over
 * the sibling `[...path]` data proxy for the `/flags` path.
 */
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { currentUserEmail } from "@/lib/auth";
import { readFlags, removeFlag, upsertFlag } from "@/lib/reports/points/flags-store";
import type { FlagInput } from "@/lib/reports/points/flags";

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;
  try {
    const flags = await readFlags();
    return NextResponse.json({ flags }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Points flags read error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: FlagInput;
  try {
    body = (await req.json()) as FlagInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || body.noteId == null || String(body.noteId).trim() === "") {
    return NextResponse.json({ error: "noteId is required" }, { status: 400 });
  }
  const allowed = new Set(["open", "resolved", "removed", "pending", "assigned"]);
  if (body.status && !allowed.has(body.status)) {
    return NextResponse.json({ error: "status must be 'removed', 'open', 'resolved', 'pending', or 'assigned'" }, { status: 400 });
  }
  if (body.reason != null && String(body.reason).length > 2000) {
    return NextResponse.json({ error: "reason too long" }, { status: 400 });
  }

  try {
    const nowIso = new Date().toISOString();
    const flag = await upsertFlag(body, email, nowIso);
    return NextResponse.json({ flag });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Points flags write error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;

  const noteId = new URL(req.url).searchParams.get("noteId");
  if (!noteId) {
    return NextResponse.json({ error: "noteId query param is required" }, { status: 400 });
  }
  try {
    await removeFlag(noteId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Points flags delete error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
