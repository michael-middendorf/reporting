"use client";

import Link from "next/link";
import { useAthletics } from "@/components/athletics/AthleticsShell";
import { formatCount, formatMoney } from "@/components/athletics/CoachingHub";
import { apiFetch } from "@/lib/api";
import { recruitingOverviewStats } from "@/lib/reports/athletics/overview-stats";
import type { AcademicsSummary } from "@/lib/reports/athletics-coaching/academics";
import type { SportFundraising } from "@/lib/reports/athletics-coaching/fundraising";
import { sportByKey } from "@/lib/reports/athletics-coaching/sports";
import { formatCurrency } from "@/components/athletics/DataTable";
import { useEffect, useMemo, useState } from "react";

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

export function MasterOverviewSheet({ sportKey }: { sportKey: string }) {
  const sport = sportByKey[sportKey];
  const { applications, loading: recruitingLoading, error: recruitingError } = useAthletics();
  const recruiting = useMemo(
    () => recruitingOverviewStats(applications, sportKey),
    [applications, sportKey],
  );
  const fundraising = useSportFetch<SportFundraising>(
    `/api/athletics-coaching/fundraising?sport=${encodeURIComponent(sportKey)}`,
  );
  const academics = useSportFetch<AcademicsSummary>(
    `/api/athletics-coaching/academics?sport=${encodeURIComponent(sportKey)}`,
  );
  const academicsReady =
    !academics.loading && !academics.error && !academics.mfaUrl && academics.data?.rosterAvailable;

  const fundraisingValue = (() => {
    if (fundraising.loading) return "Loading…";
    if (fundraising.error) return fundraising.error;
    const data = fundraising.data;
    if (!data) return "n/a";
    if (!data.mapped) return "No sport fund mapped";
    if (data.reason === "unavailable") return "Unavailable";
    return formatMoney(data.fytdAmount);
  })();

  return (
    <div className="ath-coach-bands ath-coach-scoreboard">
      <Link href="/athletics/master/recruiting" className="ath-coach-band ath-coach-scorecard">
        <h2>Recruiting</h2>
        {recruitingError ? <p>{recruitingError}</p> : null}
        <div className="ath-coach-kpis">
          <div className="ath-kpi">
            <span>Applications</span>
            <strong>{recruitingLoading ? "Loading…" : recruiting.applications.toLocaleString()}</strong>
            <small>{sport?.label || "This sport"}</small>
          </div>
          <div className="ath-kpi">
            <span>Signed / deposited</span>
            <strong>{recruitingLoading ? "Loading…" : recruiting.signed.toLocaleString()}</strong>
            <small>Fall 2027 incoming</small>
          </div>
          <div className="ath-kpi">
            <span>Avg scholarship signed</span>
            <strong>
              {recruitingLoading
                ? "Loading…"
                : recruiting.avgScholarshipSigned == null
                  ? "n/a"
                  : formatCurrency(recruiting.avgScholarshipSigned)}
            </strong>
            <small>
              {recruiting.signedWithAid
                ? `${recruiting.signedWithAid} non-zero award${recruiting.signedWithAid === 1 ? "" : "s"}`
                : "No signed awards"}
            </small>
          </div>
        </div>
        <strong className="ath-coach-open">Open recruiting →</strong>
      </Link>

      <Link href={`/athletics/coaching/${sportKey}/academics`} className="ath-coach-band ath-coach-scorecard">
        <h2>Academics</h2>
        {academics.loading ? <p>Loading academic snapshots…</p> : null}
        {academics.mfaUrl ? (
          <p>
            Named athlete academics need an authenticator code.{" "}
            <span>Continue on the academics page.</span>
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
          </div>
        ) : null}
        <strong className="ath-coach-open">Open academics →</strong>
      </Link>

      <Link href="/athletics/master/giving" className="ath-coach-band ath-coach-scorecard">
        <h2>Fundraising</h2>
        <div className="ath-coach-kpis">
          <div className="ath-kpi">
            <span>FYTD</span>
            <strong>{fundraisingValue}</strong>
            <small>{fundraising.data?.fiscalYearLabel || "This fiscal year"}</small>
          </div>
          <div className="ath-kpi">
            <span>FYTD gifts</span>
            <strong>
              {fundraising.loading
                ? "Loading…"
                : formatCount(fundraising.data?.mapped ? fundraising.data.fytdGiftCount : null)}
            </strong>
            <small>Sport fund designations</small>
          </div>
        </div>
        <strong className="ath-coach-open">Open giving →</strong>
      </Link>
    </div>
  );
}
