/**
 * /api/reports/points/tracked-events — reporting-only MA event hours.
 *
 *   GET    -> { events: TrackedEvent[] }
 *   POST   -> body TrackedEventInput; create/update (server stamps identity)
 *   DELETE -> ?id=...  ; drop the event
 *
 * Hours × 25 points. Does not write to Virtuous. Requires login + points access.
 */
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { currentUserEmail } from "@/lib/auth";
import { MA_ROSTER, RETIRED_TRACKED_EVENT_TYPES, TRACKED_EVENT_TYPES } from "@/lib/reports/points/config.js";
import {
  readTrackedEvents,
  removeTrackedEvent,
  upsertTrackedEvent,
} from "@/lib/reports/points/tracked-events-store";
import { projectTypeFor, type TrackedEventInput } from "@/lib/reports/points/tracked-events";

const ALLOWED_TYPES = new Set(
  [...TRACKED_EVENT_TYPES, ...RETIRED_TRACKED_EVENT_TYPES].flatMap(
    (t: { id: string; type: string }) => [t.id, t.type],
  ),
);

function parseHours(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return Math.round(n * 100) / 100;
}

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;
  try {
    const events = await readTrackedEvents();
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Points tracked events read error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: TrackedEventInput;
  try {
    body = (await req.json()) as TrackedEventInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const owner = String(body?.owner || "").trim();
  const ma = MA_ROSTER.find((m: { name: string }) => m.name === owner);
  if (!ma) return NextResponse.json({ error: "owner must be an MA on the roster" }, { status: 400 });

  const day = String(body?.day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  const eventType = String(body?.eventType || "").trim();
  if (!eventType || !ALLOWED_TYPES.has(eventType)) {
    const names = TRACKED_EVENT_TYPES.map((t: { label: string }) => t.label).join(", ");
    return NextResponse.json({ error: `eventType must be one of: ${names}` }, { status: 400 });
  }

  const hours = parseHours(body?.hours);
  if (hours == null) {
    return NextResponse.json({ error: "hours must be greater than 0 and at most 24" }, { status: 400 });
  }

  const name = body?.name == null ? "" : String(body.name).trim();
  if (name.length > 200) {
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  }

  const projectType = projectTypeFor(eventType, body?.projectType);
  if (projectType.length > 200) {
    return NextResponse.json({ error: "project type too long" }, { status: 400 });
  }

  const id = body?.id == null || String(body.id).trim() === "" ? undefined : String(body.id).trim();
  if (id && (id.length > 80 || !/^[-a-zA-Z0-9]+$/.test(id))) {
    return NextResponse.json({ error: "id is invalid" }, { status: 400 });
  }

  try {
    const event = await upsertTrackedEvent(
      { id, owner: ma.name, day, eventType, name, projectType, hours },
      email,
      new Date().toISOString(),
    );
    return NextResponse.json({ event });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Points tracked events write error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }
  try {
    await removeTrackedEvent(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Points tracked events delete error", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
