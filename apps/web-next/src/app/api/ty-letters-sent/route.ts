import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { requireReportAccess } from "@/lib/s3-proxy";
import { isGiftId } from "@/lib/reports/ty-letters/shape";
import { sentStore, sentTableName } from "@/lib/reports/ty-letters/sent-store";
import { tyLettersCache } from "../ty-letters-data/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  // Same as the cybersecurity register: on top of SameSite=Lax session cookies,
  // writes require application/json, which a cross-site HTML form cannot send.
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) return null;
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** POST { giftId: "123", sent: boolean }: set or clear a card's Sent flag. */
export async function POST(req: Request) {
  const denied = requireReportAccess(req, "ty-letters");
  if (denied) return denied;
  const email = currentUserEmail(req);
  if (!email) return json({ error: "Authentication required" }, 401);
  if (!sentTableName()) return json({ error: "Sent flags are not configured." }, 503);

  const body = await readJson(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  if (!isGiftId(body.giftId)) return json({ error: "giftId must be digits only" }, 400);
  if (typeof body.sent !== "boolean") return json({ error: "sent must be true or false" }, 400);

  // Only gifts on the published cards can be flagged, so the table cannot be
  // filled with arbitrary ids.
  const snap = await tyLettersCache.read();
  if (!snap || !Array.isArray(snap.cards)) {
    return json({ error: "Thank-you letter cards are not published yet." }, 503);
  }
  const giftId = body.giftId;
  if (!snap.cards.some((c) => c.giftId === giftId)) return json({ error: "Unknown gift" }, 404);

  const flag = await sentStore.setSent(body.giftId, body.sent, email);
  console.log(
    JSON.stringify({ evt: "ty_letter_sent", email, giftId: body.giftId, sent: body.sent, ts: new Date().toISOString() }),
  );
  return json(flag);
}
