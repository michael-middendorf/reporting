/**
 * POST /api/reports/points/gift-note
 *
 * Saves a gift note on a Virtuous contact. The type is one of the gift
 * choices, preset to Gift on the form.
 */
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { currentUserEmail } from "@/lib/auth";
import { buildGiftNotePayload } from "@/lib/reports/points/gift-note.js";

const VIRTUOUS_NOTE_URL = "https://api.virtuoussoftware.com/api/ContactNote";

export async function POST(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;
  if (!currentUserEmail(req)) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { contactId?: unknown; type?: unknown; note?: unknown; day?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let payload: ReturnType<typeof buildGiftNotePayload>;
  try {
    payload = buildGiftNotePayload(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid note" }, { status: 400 });
  }

  const key = (process.env.VIRTUOUS_API_KEY || process.env.API_KEY || "").trim();
  if (!key) return NextResponse.json({ error: "Virtuous is not configured" }, { status: 503 });

  let res: Response;
  try {
    res = await fetch(VIRTUOUS_NOTE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach Virtuous" }, { status: 502 });
  }

  const raw = await res.text();
  let data: { id?: unknown; message?: string; type?: string } = {};
  if (raw) {
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    const message = data.message || `Virtuous returned ${res.status}`;
    return NextResponse.json({ error: message }, { status: res.status === 400 ? 400 : 502 });
  }

  return NextResponse.json({ id: data.id ?? null, type: payload.type });
}
