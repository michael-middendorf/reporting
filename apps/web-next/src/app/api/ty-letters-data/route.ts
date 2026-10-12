import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import type { TyLettersSnapshot } from "@/lib/reports/ty-letters/shape";
import { sentStore, sentTableName } from "@/lib/reports/ty-letters/sent-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const region = process.env.AWS_REGION || "us-east-2";
const CACHE_KEY = process.env.TY_LETTERS_CACHE_KEY || "ty-letters/latest.json";
const NO_STORE = { "Cache-Control": "private, no-store" };

async function readS3(): Promise<TyLettersSnapshot | null> {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(
      new GetObjectCommand({ Bucket: bucket, Key: CACHE_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return null;
    return JSON.parse(text) as TyLettersSnapshot;
  } catch {
    return null;
  }
}

/** Test seam. Production reads DATA_BUCKET/ty-letters/latest.json. */
export const tyLettersCache = { read: readS3 };

/**
 * Thank-you letter donor cards (DST-3062) with shared Sent flags merged in.
 * Cache-only on purpose, like MGO Analysis: the TyLettersData Lambda can run
 * for minutes against the shared Virtuous rate limit, so page loads never
 * invoke it. Its early-morning cron publishes the snapshot.
 */
export async function GET(req: Request) {
  const denied = requireReportAccess(req, "ty-letters");
  if (denied) return denied;

  const snap = await tyLettersCache.read();
  if (!snap || !Array.isArray(snap.cards)) {
    return NextResponse.json(
      {
        error:
          "Thank-you letter cards are not published yet. They refresh early each morning; try again later.",
        cards: [],
      },
      { status: 503, headers: NO_STORE },
    );
  }

  let flagsError: string | null = null;
  if (sentTableName() && snap.cards.length) {
    try {
      const flags = await sentStore.getMany(snap.cards.map((c) => c.giftId));
      for (const card of snap.cards) {
        const f = flags.get(card.giftId);
        card.sent = f?.sent ?? false;
        card.sentBy = f?.sent ? f.sentBy : null;
        card.sentAt = f?.sent ? f.sentAt : null;
      }
    } catch (e) {
      console.error("ty-letters sent flags read failed", e instanceof Error ? e.name : "error");
      flagsError = "Sent flags could not be loaded.";
    }
  } else if (!sentTableName()) {
    flagsError = "Sent flags are not configured.";
  }

  return NextResponse.json({ ...snap, sentError: flagsError }, { headers: NO_STORE });
}
