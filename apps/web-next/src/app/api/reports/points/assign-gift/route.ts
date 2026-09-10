/**
 * POST /api/reports/points/assign-gift
 *
 * action "propose": anyone with Points access assigns an MA. No Virtuous write.
 * action "accept": only that MA (session email matches roster) confirms.
 *   Then we write the gift note to Virtuous and score them on the dashboard.
 *
 * Virtuous always stamps createdByUser as the API user. We cannot impersonate
 * the MA. The note body records who accepted; scoring uses the assignment flag.
 */
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { currentUserEmail } from "@/lib/auth";
import { upsertFlag } from "@/lib/reports/points/flags-store";
import { MA_ROSTER, maForEmail, noteTypeForIncoming } from "@/lib/reports/points/config.js";

const VIRTUOUS_BASE = process.env.VIRTUOUS_BASE_URL || "https://api.virtuoussoftware.com";

function money(n: unknown) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function virtuousDay(iso: string) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

export async function POST(req: Request) {
  const denied = requireReportAccess(req, "points");
  if (denied) return denied;
  const email = currentUserEmail(req);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: {
    action?: string;
    giftId?: unknown;
    contactId?: unknown;
    contactName?: string | null;
    owner?: string;
    day?: string;
    amount?: number;
    kind?: string;
    assist?: boolean;
    type?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action || "propose").trim();
  if (action !== "propose" && action !== "accept") {
    return NextResponse.json({ error: "action must be propose or accept" }, { status: 400 });
  }

  const owner = String(body.owner || "").trim();
  const ma = MA_ROSTER.find((m: { name: string }) => m.name === owner);
  if (!ma) return NextResponse.json({ error: "owner must be an MA on the roster" }, { status: 400 });

  const contactId = body.contactId == null || body.contactId === "" ? null : Number(body.contactId);
  if (!contactId || !Number.isFinite(contactId)) {
    return NextResponse.json({ error: "contactId is required" }, { status: 400 });
  }
  const giftId = body.giftId == null || body.giftId === "" ? "" : String(body.giftId);
  if (!giftId) return NextResponse.json({ error: "giftId is required" }, { status: 400 });
  const day = String(body.day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  const assist = !!body.assist;
  const type = String(body.type || noteTypeForIncoming(body.kind, assist)).trim();
  const nowIso = new Date().toISOString();

  if (action === "propose") {
    const flag = await upsertFlag(
      {
        noteId: `gift:${giftId}`,
        contactId: String(contactId),
        contactName: body.contactName || null,
        owner: ma.name,
        day,
        type,
        label: assist ? "Gift assist (pending)" : "Assigned gift (pending)",
        points: 100,
        reason: `Proposed by ${email}; waiting for ${ma.name} to accept`,
        status: "pending",
      },
      email,
      nowIso,
    );
    return NextResponse.json({ flag });
  }

  const self = maForEmail(email);
  if (!self || self.name !== ma.name) {
    return NextResponse.json(
      { error: `Only ${ma.name} can accept this assignment. Sign in as that MA.` },
      { status: 403 },
    );
  }
  if (!ma.email) {
    return NextResponse.json(
      { error: `${ma.name} has no roster email, so we cannot confirm it is them.` },
      { status: 400 },
    );
  }

  const key = process.env.VIRTUOUS_API_KEY || "";
  if (!key || key === "PLACEHOLDER") {
    return NextResponse.json({ error: "Virtuous API key is not configured" }, { status: 503 });
  }

  const noteHtml =
    `<p>Logged from MA Points after <strong>${ma.name}</strong> accepted this gift` +
    (giftId ? ` (${giftId}` : "") +
    (body.amount != null ? `${giftId ? ", " : " ("}${money(body.amount)}` : "") +
    (giftId || body.amount != null ? ")" : "") +
    `.</p><p>Accepted by ${email}.</p>`;

  let virtuousId: number | string | null = null;
  try {
    const res = await fetch(`${VIRTUOUS_BASE}/api/ContactNote`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactId,
        type,
        noteDate: virtuousDay(day),
        note: noteHtml,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `Virtuous refused the note (${res.status}): ${text.slice(0, 400)}` },
        { status: 502 },
      );
    }
    try {
      const parsed = JSON.parse(text) as { id?: number };
      virtuousId = parsed.id ?? null;
    } catch {
      virtuousId = null;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Could not reach Virtuous: ${msg}` }, { status: 502 });
  }

  const flag = await upsertFlag(
    {
      noteId: `gift:${giftId}`,
      contactId: String(contactId),
      contactName: body.contactName || null,
      owner: ma.name,
      day,
      type,
      label: assist ? "Gift assist" : "Assigned gift",
      points: 100,
      reason: `Accepted by ${email}; Virtuous note ${virtuousId ?? "created"}`,
      status: "assigned",
    },
    email,
    nowIso,
  );
  return NextResponse.json({ flag, virtuousId });
}
