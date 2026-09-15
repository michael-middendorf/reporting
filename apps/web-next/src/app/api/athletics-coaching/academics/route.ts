import { NextResponse } from "next/server";
import { currentUserEmail, sessionHasHubMfa } from "@/lib/auth";
import { aspireduPrivateHeaders, getAspireduMfaSession } from "@/lib/aspiredu-auth";
import { invokeProcessor } from "@/lib/process-invoke";
import {
  COACHING_LAMBDA_UNAVAILABLE,
  academicsMfaUnlocked,
  buildAcademicsSummary,
  coachingLambdaPayload,
  coachingMfaUrl,
  enrollmentAccess,
  isCoachingActionUnavailable,
  matchedRosterRows,
  mergeOfficeHoursLedger,
  officeHoursLedgerObjectKey,
  officeHoursNeedsHistory,
  type OfficeHoursHistoryBackfill,
  type OfficeHoursLedger,
} from "@/lib/reports/athletics-coaching/academics";
import { backfillOfficeHoursFromSnapshots } from "@/lib/reports/athletics-coaching/office-hours-history";
import { putJsonObject, readJsonObject } from "@/lib/reports/housing/store";
import type { SlateRow } from "@/lib/reports/athletics/types";
import { isMissingSource, loadSourceRowsOptional } from "@/lib/sources";

export const dynamic = "force-dynamic";

const headers = { ...aspireduPrivateHeaders, "Cache-Control": "no-store, max-age=0" };

function emptyOfficeHoursLedger(): OfficeHoursLedger {
  return { updatedAt: "", entries: {} };
}

async function loadOfficeHoursLedger(sport: string): Promise<OfficeHoursLedger | null> {
  try {
    const stored = await readJsonObject<OfficeHoursLedger>(officeHoursLedgerObjectKey(sport));
    if (!stored) return emptyOfficeHoursLedger();
    const entries =
      stored.entries && typeof stored.entries === "object" && !Array.isArray(stored.entries)
        ? stored.entries
        : {};
    return {
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : "",
      entries,
    };
  } catch (error) {
    console.warn("office-hours ledger read failed", error);
    return null;
  }
}

async function saveOfficeHoursLedger(sport: string, ledger: OfficeHoursLedger): Promise<void> {
  try {
    await putJsonObject(officeHoursLedgerObjectKey(sport), ledger);
  } catch (error) {
    console.warn("office-hours ledger write failed", error);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const access = enrollmentAccess(currentUserEmail(req), url.searchParams.get("sport"));
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers });
  }

  const ferpa = await getAspireduMfaSession(req, access.email);
  if (
    !academicsMfaUnlocked({
      email: access.email,
      hubMfa: sessionHasHubMfa(req),
      ferpa: Boolean(ferpa),
    })
  ) {
    return NextResponse.json(
      { error: "MFA required", mfaUrl: coachingMfaUrl(access.sport) },
      { status: 401, headers },
    );
  }
  const callerEmail = ferpa?.email ?? access.email;

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
        coachingLambdaPayload(callerEmail, access.sport, rows),
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

    const officeHoursLedger = await loadOfficeHoursLedger(access.sport);
    const draft = buildAcademicsSummary({
      sport: access.sport,
      rosterRows: roster.rows,
      lambdaResult,
      rosterPulledAt: roster.latest.pulled_at ?? null,
    });
    let nextLedger = officeHoursLedger;
    if (officeHoursLedger) {
      const asOfIso = draft.asOf || new Date().toISOString();
      let backfill: OfficeHoursHistoryBackfill = {};
      if (officeHoursNeedsHistory(draft.officeHours, officeHoursLedger)) {
        backfill = await backfillOfficeHoursFromSnapshots(draft.officeHours);
      }
      nextLedger = mergeOfficeHoursLedger(officeHoursLedger, draft.officeHours, asOfIso, backfill);
      await saveOfficeHoursLedger(access.sport, nextLedger);
    }
    const summary = buildAcademicsSummary({
      sport: access.sport,
      rosterRows: roster.rows,
      lambdaResult,
      rosterPulledAt: roster.latest.pulled_at ?? null,
      officeHoursLedger: nextLedger,
    });

    return NextResponse.json(summary, { headers });
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
