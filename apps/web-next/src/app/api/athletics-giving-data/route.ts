import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { canAccessAthleticsGiving } from "@/lib/reports/athletics-giving/access";
import {
  ATHLETICS_GIVING_CACHE_KEY,
  isGivingReady,
  type AthleticsGivingSnapshot,
} from "@/lib/reports/athletics-giving/shape";
import { isMissingSource, readJson } from "@/lib/sources";
import { redactAnonymousDonors } from "@/lib/reports/anonymous-donors";

export const dynamic = "force-dynamic";

async function defaultReadCache(): Promise<AthleticsGivingSnapshot | null> {
  try {
    return await readJson<AthleticsGivingSnapshot>(ATHLETICS_GIVING_CACHE_KEY);
  } catch (error) {
    if (isMissingSource(error)) return null;
    throw error;
  }
}

/** Test seam. Production reads DATA_BUCKET/athletics-giving/latest.json. */
export const givingCache = {
  read: defaultReadCache,
};

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Authentication required", redirect: "/" }, { status: 401 });
  }
  if (!canAccessAthleticsGiving(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const cache = await givingCache.read();
    if (!isGivingReady(cache)) {
      return NextResponse.json(
        { error: "Athletics giving totals are not published yet." },
        { status: 503 },
      );
    }
    return NextResponse.json(redactAnonymousDonors(cache, email), {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load athletics giving data" },
      { status: 503 },
    );
  }
}
