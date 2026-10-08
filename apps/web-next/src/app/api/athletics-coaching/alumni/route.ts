import { NextResponse } from "next/server";
import { currentUserEmail, sessionHasHubMfa } from "@/lib/auth";
import { aspireduPrivateHeaders, getAspireduMfaSession } from "@/lib/aspiredu-auth";
import { buildAlumniSummary } from "@/lib/reports/athletics-coaching/alumni";
import { academicsMfaUnlocked, coachingMfaUrl } from "@/lib/reports/athletics-coaching/academics";
import type { SlateRow } from "@/lib/reports/athletics/types";
import { sportDashboardAccess } from "@/lib/reports/athletics/overview";
import { isMissingSource, loadSourceRowsOptional } from "@/lib/sources";

export const dynamic = "force-dynamic";

const headers = { ...aspireduPrivateHeaders, "Cache-Control": "no-store, max-age=0" };

/**
 * Graduated former athletes for one sport. Names, class year, degree, and
 * years on the team are returned to anyone who can open the team dashboard.
 * Personal emails are returned only after the same MFA unlock as named-athlete
 * academics; otherwise they are stripped here and emailsHidden is true.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const access = sportDashboardAccess(currentUserEmail(req), url.searchParams.get("sport"));
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers });
  }

  const ferpa = await getAspireduMfaSession(req, access.email);
  const showEmails = academicsMfaUnlocked({
    email: access.email,
    hubMfa: sessionHasHubMfa(req),
    ferpa: Boolean(ferpa),
  });
  const mfaUrl = showEmails ? undefined : coachingMfaUrl(access.sport, "alumni");

  try {
    const [athleticAlumni, graduates, slate] = await Promise.all([
      loadSourceRowsOptional<Record<string, unknown>>("powercampus", "athletic_alumni"),
      loadSourceRowsOptional<Record<string, unknown>>("powercampus", "graduates"),
      loadSourceRowsOptional<SlateRow>("athletics", "association_history"),
    ]);
    const summary = buildAlumniSummary({
      sport: access.sport,
      athleticAlumniRows: athleticAlumni?.rows ?? null,
      graduateRows: graduates?.rows ?? null,
      slateRows: slate?.rows ?? null,
      generatedAt: athleticAlumni?.latest.pulled_at ?? graduates?.latest.pulled_at ?? null,
      showEmails,
    });
    return NextResponse.json({ ...summary, ...(mfaUrl ? { mfaUrl } : {}) }, { headers });
  } catch (error) {
    if (isMissingSource(error)) {
      const summary = buildAlumniSummary({
        sport: access.sport,
        athleticAlumniRows: null,
        graduateRows: null,
        slateRows: null,
        showEmails,
      });
      return NextResponse.json({ ...summary, ...(mfaUrl ? { mfaUrl } : {}) }, { headers });
    }
    console.error("athletics-coaching alumni failed", error);
    return NextResponse.json({ error: "Unable to load alumni" }, { status: 503, headers });
  }
}
