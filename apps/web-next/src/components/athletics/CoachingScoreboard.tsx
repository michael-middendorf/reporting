"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AcademicsSummary } from "@/lib/reports/athletics-coaching/academics";
import type { EnrollmentSummary } from "@/lib/reports/athletics-coaching/enrollment";
import type { SportFundraising } from "@/lib/reports/athletics-coaching/fundraising";
import { formatCount, formatMoney } from "./CoachingHub";

type LoadState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  mfaUrl?: string | null;
};

function useSportFetch<T>(url: string): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaUrl, setMfaUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMfaUrl(null);
    apiFetch(url, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (response.status === 401 && body.mfaUrl) {
          if (!cancelled) setMfaUrl(String(body.mfaUrl));
          return;
        }
        if (!response.ok) throw new Error(body.error || "Unable to load");
        if (!cancelled) setData(body as T);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, error, loading, mfaUrl };
}

export function CoachingScoreboard({ sportKey }: { sportKey: string }) {
  const fundraising = useSportFetch<SportFundraising>(
    `/api/athletics-coaching/fundraising?sport=${encodeURIComponent(sportKey)}`,
  );
  const enrollment = useSportFetch<EnrollmentSummary>(
    `/api/athletics-coaching/enrollment?sport=${encodeURIComponent(sportKey)}`,
  );
  const academics = useSportFetch<AcademicsSummary>(
    `/api/athletics-coaching/academics?sport=${encodeURIComponent(sportKey)}`,
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
            <small>From the Slate roster feed</small>
          </div>
          <div className="ath-kpi">
            <span>Signed / deposited</span>
            <strong>{signedValue ?? (enrollment.loading ? "Loading…" : "n/a")}</strong>
            <small>Varsity LOI signed or deposited</small>
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
              <small>Athletes with recorded absences</small>
            </div>
            <div className="ath-kpi">
              <span>Office hours</span>
              <strong>{formatCount(academics.data.officeHours.length)}</strong>
              <small>Courses without an A or B</small>
            </div>
          </div>
        ) : null}
        <strong className="ath-coach-open">Open academics →</strong>
      </Link>
    </div>
  );
}
