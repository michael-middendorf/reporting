import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import {
  buildEnrollmentSummary,
  enrollmentAccess,
} from "@/lib/reports/athletics-coaching/enrollment";
import { normalizeApplication } from "@/lib/reports/athletics/normalize";
import type { SlateRow } from "@/lib/reports/athletics/types";
import { isMissingSource, loadSourceRowsOptional } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const access = enrollmentAccess(currentUserEmail(req), url.searchParams.get("sport"));
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const [roster, applications] = await Promise.all([
      loadSourceRowsOptional<SlateRow>("athletics", "roster"),
      loadSourceRowsOptional<SlateRow>("athletics", "applications"),
    ]);
    const payload = buildEnrollmentSummary({
      sport: access.sport,
      rosterRows: roster?.rows ?? null,
      applicationRows: applications?.rows.map(normalizeApplication) ?? null,
      rosterPulledAt: roster?.latest.pulled_at ?? null,
      applicationsPulledAt: applications?.latest.pulled_at ?? null,
    });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    if (isMissingSource(error)) {
      const payload = buildEnrollmentSummary({
        sport: access.sport,
        rosterRows: null,
        applicationRows: null,
      });
      return NextResponse.json(payload, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load enrollment data" },
      { status: 503 },
    );
  }
}
