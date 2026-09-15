import { NextResponse } from "next/server";
import { currentUserEmail, sessionHasHubMfa } from "@/lib/auth";
import { canAccessReport } from "@/lib/access";
import { academicsMfaUnlocked } from "@/lib/reports/athletics-coaching/academics";
import { getAspireduMfaSession } from "@/lib/aspiredu-auth";
import { visibleOverviewSports } from "@/lib/reports/athletics/overview";
import { SPORTS } from "@/lib/reports/athletics-coaching/sports";
import {
  buildEligibilityAthletes,
  ELIGIBILITY_CURRENT_TERM,
  ELIGIBILITY_PRIOR_TERM,
  ELIGIBILITY_SECOND_LAST_TERM,
  ELIGIBILITY_SUMMER_TERM,
  filterEligibilityBySports,
  type EligibilitySnapshot,
} from "@/lib/reports/athletics/eligibility";
import { loadCensusLists } from "@/lib/reports/census/lists";
import type { SlateRow } from "@/lib/reports/athletics/types";
import { isMissingSource, loadSourceRowsOptional } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Authentication required", redirect: "/" }, { status: 401 });
  }
  if (!canAccessReport(email, "athletics")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const ferpa = await getAspireduMfaSession(req, email);
  if (!academicsMfaUnlocked({ email, hubMfa: sessionHasHubMfa(req), ferpa: Boolean(ferpa) })) {
    return NextResponse.json(
      { error: "MFA required", mfaUrl: "/auth/mfa?next=/athletics/master/eligibility" },
      { status: 401 },
    );
  }

  try {
    const [roster, lists] = await Promise.all([
      loadSourceRowsOptional<SlateRow>("athletics", "roster"),
      loadCensusLists(),
    ]);
    if (!roster?.rows.length) {
      return NextResponse.json(
        { error: "The Slate roster feed is not available yet." },
        { status: 503 },
      );
    }
    const visibleSports = visibleOverviewSports(email);
    const allowed =
      visibleSports.length === SPORTS.length ? null : visibleSports.map((sport) => sport.key);
    const athletes = filterEligibilityBySports(
      buildEligibilityAthletes(roster.rows, lists.students, lists.prior),
      allowed,
    );
    const payload: EligibilitySnapshot = {
      generatedAt: roster.latest.pulled_at || null,
      currentTerm: ELIGIBILITY_CURRENT_TERM,
      priorTerm: ELIGIBILITY_PRIOR_TERM,
      secondLastTerm: ELIGIBILITY_SECOND_LAST_TERM,
      summerTerm: ELIGIBILITY_SUMMER_TERM,
      athletes,
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (isMissingSource(error)) {
      return NextResponse.json(
        { error: "The Slate roster feed is not available yet." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load eligibility data" },
      { status: 503 },
    );
  }
}
