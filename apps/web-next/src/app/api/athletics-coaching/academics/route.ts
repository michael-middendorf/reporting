import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, getAspireduMfaSession } from "@/lib/aspiredu-auth";
import { invokeProcessor } from "@/lib/process-invoke";
import {
  COACHING_LAMBDA_UNAVAILABLE,
  buildAcademicsSummary,
  coachingLambdaPayload,
  coachingMfaUrl,
  enrollmentAccess,
  isCoachingActionUnavailable,
  matchedRosterRows,
} from "@/lib/reports/athletics-coaching/academics";
import type { SlateRow } from "@/lib/reports/athletics/types";
import { isMissingSource, loadSourceRowsOptional } from "@/lib/sources";

export const dynamic = "force-dynamic";

const headers = { ...aspireduPrivateHeaders, "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const access = enrollmentAccess(currentUserEmail(req), url.searchParams.get("sport"));
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers });
  }

  const mfa = await getAspireduMfaSession(req, access.email);
  if (!mfa) {
    return NextResponse.json(
      { error: "MFA required", mfaUrl: coachingMfaUrl(access.sport) },
      { status: 401, headers },
    );
  }

  try {
    const roster = await loadSourceRowsOptional<SlateRow>("athletics", "roster");
    if (!roster) {
      return NextResponse.json(
        buildAcademicsSummary({ sport: access.sport, rosterRows: null }),
        { headers },
      );
    }

    const rows = matchedRosterRows(roster.rows, access.sport);
    if (!rows.length) {
      return NextResponse.json(
        buildAcademicsSummary({
          sport: access.sport,
          rosterRows: roster.rows,
          rosterPulledAt: roster.latest.pulled_at ?? null,
        }),
        { headers },
      );
    }

    const functionName = process.env.ASPIREDU_STUDENTS_FUNCTION?.trim();
    if (!functionName) {
      return NextResponse.json(
        { error: "AspireDU student reporting is not configured" },
        { status: 503, headers },
      );
    }

    let lambdaResult: unknown;
    try {
      lambdaResult = await invokeProcessor(
        functionName,
        coachingLambdaPayload(mfa.email, access.sport, rows),
      );
    } catch (error) {
      if (isCoachingActionUnavailable(error)) {
        return NextResponse.json({ error: COACHING_LAMBDA_UNAVAILABLE }, { status: 503, headers });
      }
      throw error;
    }
    if (isCoachingActionUnavailable(lambdaResult)) {
      return NextResponse.json({ error: COACHING_LAMBDA_UNAVAILABLE }, { status: 503, headers });
    }

    return NextResponse.json(
      buildAcademicsSummary({
        sport: access.sport,
        rosterRows: roster.rows,
        lambdaResult,
        rosterPulledAt: roster.latest.pulled_at ?? null,
      }),
      { headers },
    );
  } catch (error) {
    if (isMissingSource(error)) {
      return NextResponse.json(
        buildAcademicsSummary({ sport: access.sport, rosterRows: null }),
        { headers },
      );
    }
    if (isCoachingActionUnavailable(error)) {
      return NextResponse.json({ error: COACHING_LAMBDA_UNAVAILABLE }, { status: 503, headers });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load academic snapshots" },
      { status: 503, headers },
    );
  }
}
