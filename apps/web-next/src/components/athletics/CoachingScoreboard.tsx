"use client";

import Link from "next/link";
import type { AcademicsSummary } from "@/lib/reports/athletics-coaching/academics";
import type { EnrollmentSummary } from "@/lib/reports/athletics-coaching/enrollment";
import type { SportFundraising } from "@/lib/reports/athletics-coaching/fundraising";
import { formatCount, formatMoney } from "./CoachingHub";
import { useSportFetch } from "./useSportFetch";

const SPORT_FETCH = { noStore: true, mfa: true } as const;

export function CoachingScoreboard({ sportKey }: { sportKey: string }) {
  const fundraising = useSportFetch<SportFundraising>(
    `/api/athletics-coaching/fundraising?sport=${encodeURIComponent(sportKey)}`,
    SPORT_FETCH,
  );
  const enrollment = useSportFetch<EnrollmentSummary>(
    `/api/athletics-coaching/enrollment?sport=${encodeURIComponent(sportKey)}`,
    SPORT_FETCH,
  );
  const academics = useSportFetch<AcademicsSummary>(
    `/api/athletics-coaching/academics?sport=${encodeURIComponent(sportKey)}`,
    SPORT_FETCH,
  );

  const fundraisingValue = (() => {
    if (fundraising.loading) return "Loading…";
    if (fundraising.error) return fundraising.error;
    const data = fundraising.data;
    if (!data) return "n/a";
    if (!data.mapped) return "No sport fund mapped";
    if (data.reason === "unavailable") return "Unavailable";
    return formatMoney(data.fytdAmount);
  })();

  const rosterValue = (() => {
    if (enrollment.loading) return "Loading…";
    if (enrollment.error) return enrollment.error;
    const data = enrollment.data;
    if (!data) return "n/a";
    return formatCount(data.roster.available ? data.roster.count : null);
  })();

  const signedValue = (() => {
    if (enrollment.loading || enrollment.error || !enrollment.data) return null;
    return formatCount(enrollment.data.signed.available ? enrollment.data.signed.count : null);
  })();

  const academicsReady = !academics.loading && !academics.error && !academics.mfaUrl && academics.data?.rosterAvailable;

  return (
    <div className="ath-coach-bands ath-coach-scoreboard">
      <Link href={`/athletics/coaching/${sportKey}/fundraising`} className="ath-coach-band ath-coach-scorecard">
        <h2>Fundraising</h2>
        <div className="ath-coach-kpis">
          <div className="ath-kpi">
            <span>FYTD</span>
            <strong>{fundraisingValue}</strong>
            <small>{fundraising.data?.fiscalYearLabel || "This fiscal year"}</small>
          </div>
        </div>
        <strong className="ath-coach-open">Open fundraising →</strong>
      </Link>

      <Link href={`/athletics/coaching/${sportKey}/enrollment`} className="ath-coach-band ath-coach-scorecard">
        <h2>Enrollment</h2>
        <div className="ath-coach-kpis">
          <div className="ath-kpi">
            <span>Current roster</span>
            <strong>{rosterValue}</strong>
            <small>
              {enrollment.data?.roster.available ? "From the Slate roster feed" : "Awaiting roster secret"}
            </small>
          </div>
          <div className="ath-kpi">
            <span>Signed / deposited</span>
            <strong>{signedValue ?? (enrollment.loading ? "Loading…" : "n/a")}</strong>
            <small>Fall 2027 incoming</small>
          </div>
        </div>
        <strong className="ath-coach-open">Open enrollment →</strong>
      </Link>

      <Link href={`/athletics/coaching/${sportKey}/academics`} className="ath-coach-band ath-coach-scorecard">
        <h2>Academics</h2>
        {academics.loading ? <p>Loading academic snapshots…</p> : null}
        {academics.mfaUrl ? (
          <p>
            Named athlete academics need an authenticator code. Continue on the academics page.
          </p>
        ) : null}
        {academics.error ? <p>{academics.error}</p> : null}
        {!academics.loading && !academics.error && !academics.mfaUrl && academics.data && !academics.data.rosterAvailable ? (
          <p>The roster feed is not in yet.</p>
        ) : null}
        {academicsReady && academics.data ? (
          <div className="ath-coach-kpis">
            <div className="ath-kpi">
              <span>Team GPA</span>
              <strong>{academics.data.teamGpa == null ? "n/a" : academics.data.teamGpa.toFixed(2)}</strong>
              <small>from current course grades, unweighted</small>
            </div>
            <div className="ath-kpi">
              <span>Missing class</span>
              <strong>
                {academics.data.peopleMissingClass} of {academics.data.matchedCount}
              </strong>
              <small>Athletes with 2 or more session absences</small>
            </div>
            {sportKey === "ultimate-frisbee" ? (
              <div className="ath-kpi">
                <span>Office hours</span>
                <strong>{formatCount(academics.data.officeHours.length)}</strong>
                <small>Courses without an A or B</small>
              </div>
            ) : null}
          </div>
        ) : null}
        <strong className="ath-coach-open">Open academics →</strong>
      </Link>
    </div>
  );
}
