import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { enrollmentAccess } from "@/lib/reports/athletics-coaching/enrollment";
import {
  FUNDRAISING_CACHE_KEY,
  sportFundraisingFromCache,
  type FundraisingCache,
} from "@/lib/reports/athletics-coaching/fundraising";
import { isMissingSource, readJson } from "@/lib/sources";

export const dynamic = "force-dynamic";

async function defaultReadFundraisingCache(): Promise<FundraisingCache | null> {
  try {
    return await readJson<FundraisingCache>(FUNDRAISING_CACHE_KEY);
  } catch (error) {
    if (isMissingSource(error)) return null;
    throw error;
  }
}

/** Test seam. Production reads DATA_BUCKET/athletics-coaching-fundraising/latest.json. */
export const fundraisingCache = {
  read: defaultReadFundraisingCache,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const access = enrollmentAccess(currentUserEmail(req), url.searchParams.get("sport"));
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const cache = await fundraisingCache.read();
    if (!cache) {
      return NextResponse.json(
        { error: "Fundraising totals are not published yet." },
        { status: 503 },
      );
    }
    const payload = sportFundraisingFromCache(cache, access.sport);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load fundraising data" },
      { status: 503 },
    );
  }
}
