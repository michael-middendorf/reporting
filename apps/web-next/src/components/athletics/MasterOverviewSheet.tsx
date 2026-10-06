"use client";

import Link from "next/link";
import { useAthletics } from "@/components/athletics/AthleticsShell";
import { formatCount, formatMoney } from "@/components/athletics/CoachingHub";
import { recruitingOverviewStats } from "@/lib/reports/athletics/overview-stats";
import type { AcademicsSummary } from "@/lib/reports/athletics-coaching/academics";
import type { SportFundraising } from "@/lib/reports/athletics-coaching/fundraising";
import { formatCurrency } from "@/components/athletics/DataTable";
import { useSportFetch } from "@/components/athletics/useSportFetch";
import { useMemo } from "react";

const SPORT_FETCH = { noStore: true, mfa: true } as const;

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <article className="ath-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

export function MasterOverviewSheet({ sportKey }: { sportKey: string }) {
  const { applications, prospects, loading: recruitingLoading, error: recruitingError } = useAthletics();
  const recruiting = useMemo(
    () => recruitingOverviewStats(applications, prospects, sportKey),
    [applications, prospects, sportKey],
  );
  const fundraising = useSportFetch<SportFundraising>(
    `/api/athletics-coaching/fundraising?sport=${encodeURIComponent(sportKey)}`,
    SPORT_FETCH,
  );
  const academics = useSportFetch<AcademicsSummary>(
    `/api/athletics-coaching/academics?sport=${encodeURIComponent(sportKey)}`,
    SPORT_FETCH,
  );
  const academicsReady =
    !academics.loading && !academics.error && !academics.mfaUrl && academics.data?.rosterAvailable;

  const dash = (loading: boolean, value: string) => (loading ? "Loading…" : value);
  const fyLabel = fundraising.data?.fiscalYearLabel || "This fiscal year";

  return (
    <div className="ath-master-sheet">
      <section>
        <div className="ath-section-heading-row">
          <h2>Recruiting</h2>
          <Link href="/athletics/master/recruiting">Open recruiting →</Link>
        </div>
        {recruitingError ? <p className="ath-muted">{recruitingError}</p> : null}
        <div className="ath-kpi-grid ath-kpi-grid-primary">
          <Metric
            label="Applications"
            value={dash(recruitingLoading, recruiting.applications.toLocaleString())}
            detail="This sport"
          />
          <Metric
            label="Prospects / Inquiries"
            value={dash(recruitingLoading, recruiting.prospects.toLocaleString())}
            detail="Have not applied"
          />
          <Metric
            label="Total Scholarship Signed"
            value={dash(recruitingLoading, formatCurrency(recruiting.totalScholarshipSigned))}
            detail={`${recruiting.signedWithAid.toLocaleString()} non-zero awards · Fall 2027`}
          />
          <Metric
            label="Average Scholarship Signed"
            value={dash(
              recruitingLoading,
              recruiting.avgScholarshipSigned == null ? "n/a" : formatCurrency(recruiting.avgScholarshipSigned),
            )}
            detail="Fall 2027 signed/deposited"
          />
          <Metric
            label="Total Scholarship All"
            value={dash(recruitingLoading, formatCurrency(recruiting.totalScholarshipAll))}
            detail={`${recruiting.allAwards.toLocaleString()} awards`}
          />
          <Metric
            label="Average Scholarship All"
            value={dash(
              recruitingLoading,
              recruiting.avgScholarshipAll == null ? "n/a" : formatCurrency(recruiting.avgScholarshipAll),
            )}
            detail="Excludes blank and zero awards"
          />
        </div>
      </section>

      <section>
        <div className="ath-section-heading-row">
          <h2>Academics</h2>
          <Link href={`/athletics/coaching/${sportKey}/academics`}>Open academics →</Link>
        </div>
        {academics.loading ? <p className="ath-muted">Loading academic snapshots…</p> : null}
        {academics.mfaUrl ? (
          <p className="ath-muted">
            Named athlete academics need an authenticator code. Continue on the academics page.
          </p>
        ) : null}
        {academics.error ? <p className="ath-muted">{academics.error}</p> : null}
        {!academics.loading && !academics.error && !academics.mfaUrl && academics.data && !academics.data.rosterAvailable ? (
          <p className="ath-muted">The roster feed is not in yet.</p>
        ) : null}
        {academicsReady && academics.data ? (
          <div className="ath-kpi-grid ath-kpi-grid-primary">
            <Metric
              label="Team GPA"
              value={academics.data.teamGpa == null ? "n/a" : academics.data.teamGpa.toFixed(2)}
              detail="Current course grades, unweighted"
            />
            <Metric
              label="Missing class"
              value={`${academics.data.peopleMissingClass} of ${academics.data.matchedCount}`}
              detail="Athletes with 2 or more session absences"
            />
            <Metric
              label="Current roster"
              value={academics.data.matchedCount.toLocaleString()}
              detail="Matched to AspireDU snapshots"
            />
          </div>
        ) : null}
      </section>

      <section>
        <div className="ath-section-heading-row">
          <h2>Fundraising</h2>
          <Link href="/athletics/master/giving">Open giving →</Link>
        </div>
        <div className="ath-kpi-grid ath-kpi-grid-primary">
          <Metric
            label="FYTD"
            value={
              fundraising.loading
                ? "Loading…"
                : fundraising.error
                  ? fundraising.error
                  : !fundraising.data?.mapped
                    ? "No sport fund mapped"
                    : fundraising.data.reason === "unavailable"
                      ? "Unavailable"
                      : formatMoney(fundraising.data.fytdAmount)
            }
            detail={fyLabel}
          />
          <Metric
            label="FYTD gifts"
            value={
              fundraising.loading
                ? "Loading…"
                : formatCount(fundraising.data?.mapped ? fundraising.data.fytdGiftCount : null)
            }
            detail="Sport fund designations"
          />
          <Metric
            label="All-time"
            value={
              fundraising.loading
                ? "Loading…"
                : formatMoney(fundraising.data?.mapped ? fundraising.data.allTimeAmount : null)
            }
            detail="This sport fund"
          />
        </div>
      </section>
    </div>
  );
}
