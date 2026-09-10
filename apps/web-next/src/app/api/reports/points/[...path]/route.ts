import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { loadSourceRows, loadSourceRowsOptional } from "@/lib/sources";
import { giftSolicitor, prepareGifts } from "@/lib/reports/points/scoring";

type Ctx = { params: Promise<{ path: string[] }> };

const MA_NAMES = new Set([
  "Sean Kelly",
  "Joseph Blaso",
  "Alanna McCann",
  "Caleb Metzen",
  "Elena Barnes",
  "Betsy Scaletty",
  "Natalia Abrams",
]);

const EVENT_FIELDS = [
  "id",
  "name",
  "startDateTime",
  "endDateTime",
  "locationName",
  "createdByUser",
] as const;

const GIFT_FIELDS = [
  "id",
  "contactId",
  "contactName",
  "giftDate",
  "amount",
  "giftType",
  "frequency",
  "segment",
  "project",
  "solicitor",
  "recurringGiftId",
  "acIncrease",
  "priorMonthly",
  "newMonthly",
] as const;

/** Serve points payloads from sources/virtuous/{contact_notes,events}. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;

  const { path } = await ctx.params;
  const file = path?.[0];
  if (!file) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  try {
    if (file === "notes.json") {
      const { rows, latest } = await loadSourceRows<Record<string, unknown>>(
        "virtuous",
        "contact_notes",
      );
      const notes = rows.filter((r) => MA_NAMES.has(String(r.createdByUser || "").trim()));
      return NextResponse.json(notes, {
        headers: { "X-AMU-Source-Dt": latest.dt, "Cache-Control": "private, max-age=60" },
      });
    }
    if (file === "gifts.json") {
      const notes = await loadSourceRows<Record<string, unknown>>("virtuous", "contact_notes");
      const contactIds = new Set<number>();
      for (const r of notes.rows) {
        if (!MA_NAMES.has(String(r.createdByUser || "").trim())) continue;
        const cid = Number(r.contactId);
        if (Number.isFinite(cid)) contactIds.add(cid);
      }
      const gifts = await loadSourceRows<Record<string, unknown>>("virtuous", "gifts");
      const recurring = await loadSourceRowsOptional<Record<string, unknown>>(
        "virtuous",
        "recurring_gifts",
      );
      const posted = gifts.rows.filter((r) => contactIds.has(Number(r.contactId)));
      const names = new Map<number, string>();
      const contacts = await loadSourceRowsOptional<Record<string, unknown>>("virtuous", "contacts");
      for (const c of contacts?.rows || []) {
        const cid = Number(c.id ?? c.contactId);
        const name = String(c.name || c.contactName || "").trim();
        if (Number.isFinite(cid) && name) names.set(cid, name);
      }
      for (const r of notes.rows) {
        const cid = Number(r.contactId);
        const name = String(r.contactName || "").trim();
        if (Number.isFinite(cid) && name) names.set(cid, name);
      }
      for (const r of posted) {
        const cid = Number(r.contactId);
        const name = String(r.contactName || "").trim();
        if (Number.isFinite(cid) && name) names.set(cid, name);
      }
      const namedPosted = posted.map((r) => {
        const cid = Number(r.contactId);
        const contactName = String(r.contactName || "").trim() || names.get(cid) || "";
        return { ...r, contactName };
      });
      const recRows = (recurring?.rows || [])
        .filter((r) => contactIds.has(Number(r.contactId)))
        .map((r) => {
          const cid = Number(r.contactId);
          const contactName = String(r.contactName || "").trim() || names.get(cid) || "";
          return { ...r, contactName };
        });
      const kept = (prepareGifts(namedPosted, recRows) as Record<string, unknown>[]).map((r) => {
        const lean: Record<string, unknown> = {};
        for (const k of GIFT_FIELDS) lean[k] = r[k];
        const solicitor = giftSolicitor(r);
        if (solicitor) lean.solicitor = solicitor;
        return lean;
      });
      return NextResponse.json(kept, {
        headers: { "X-AMU-Source-Dt": gifts.latest.dt, "Cache-Control": "private, max-age=60" },
      });
    }
    if (file === "events.json") {
      const { rows, latest } = await loadSourceRows<Record<string, unknown>>("virtuous", "events");
      const events = rows.map((r) => {
        const lean: Record<string, unknown> = {};
        for (const k of EVENT_FIELDS) lean[k] = r[k];
        return lean;
      });
      return NextResponse.json(events, {
        headers: { "X-AMU-Source-Dt": latest.dt, "Cache-Control": "private, max-age=60" },
      });
    }
    if (file === "meta.json") {
      const notes = await loadSourceRows("virtuous", "contact_notes");
      const events = await loadSourceRows("virtuous", "events");
      const gifts = await loadSourceRows("virtuous", "gifts").catch(() => ({
        rows: [] as unknown[],
        latest: { pulled_at: null },
      }));
      const kept = notes.rows.filter((r) =>
        MA_NAMES.has(String((r as { createdByUser?: string }).createdByUser || "").trim()),
      );
      return NextResponse.json({
        sample: false,
        provenance: "sources/virtuous contact_notes + events + gifts + recurring_gifts (roster-filtered for points).",
        generated_at: notes.latest.pulled_at,
        note_window_days: 365,
        record_counts: { notes: kept.length, events: events.rows.length, gifts: gifts.rows.length },
        roster: [...MA_NAMES],
      });
    }
    return NextResponse.json({ error: `Unknown points file: ${file}` }, { status: 404 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("NoSuchKey") || msg.includes("NotFound") ? 404 : 502;
    console.error("Points data proxy error", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
