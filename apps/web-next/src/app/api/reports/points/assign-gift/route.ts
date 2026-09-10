/**
 * POST /api/reports/points/assign-gift
 *
 * action "propose": anyone with Points access assigns an MA.
 * action "accept": only that MA (session email matches roster) confirms,
 * then the dashboard scores them. Does not write a note to Virtuous.
 */
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { currentUserEmail } from "@/lib/auth";
import { upsertFlag } from "@/lib/reports/points/flags-store";
import { MA_ROSTER, maForEmail, noteTypeForIncoming } from "@/lib/reports/points/config.js";

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
      reason: `Accepted by ${email}`,
      status: "assigned",
    },
    email,
    nowIso,
  );
  return NextResponse.json({ flag });
}
