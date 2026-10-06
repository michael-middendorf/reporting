"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { AthleticsPage, useAthletics } from "@/components/athletics/AthleticsShell";
import { eligibleSigned, STAGE_COLORS, stageName } from "@/lib/reports/athletics/normalize";
import { formatCurrency } from "@/components/athletics/DataTable";

const AWARD_DETAILS_KEY = "ath-show-award-details";

// Saved preference read through useSyncExternalStore: the server snapshot is the
// default (shown), and the client value applies after hydration without an effect.
function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function storedShowAwards(): boolean {
  try {
    return window.localStorage.getItem(AWARD_DETAILS_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function AthleticsOverviewPage() {
  const { filteredApplications: applications, filteredProspects: prospects } = useAthletics();
  const savedShowAwards = useSyncExternalStore(subscribeToStorage, storedShowAwards, () => true);
  const [toggledShowAwards, setToggledShowAwards] = useState<boolean | null>(null);
  const showAwards = toggledShowAwards ?? savedShowAwards;

  function toggleAwards() {
    const next = !showAwards;
    window.localStorage.setItem(AWARD_DETAILS_KEY, next ? "1" : "0");
    setToggledShowAwards(next);
  }
  const signed = applications.filter(eligibleSigned);
  const signedScholarships = signed.filter((record) => record.athleticScholarship > 0);
  const allScholarships = applications.filter((record) => record.athleticScholarship > 0);
  const totalSigned = signedScholarships.reduce((sum, record) => sum + record.athleticScholarship, 0);
  const totalAll = allScholarships.reduce((sum, record) => sum + record.athleticScholarship, 0);
  const discretionary = applications.reduce((sum, record) => sum + record.athleticDiscretionaryFund, 0);
  const impact = applications.reduce((sum, record) => sum + record.impactAwards, 0);
  const faithSix = applications.filter((record) => record.faithFootball === 6000).length;
  const faithTen = applications.filter((record) => record.faithFootball === 10000).length;
  const stages = Object.entries(STAGE_COLORS).map(([label, color]) => [
    label,
    applications.filter((record) => stageName(record) === label).length,
    color,
  ] as const);
  const maxStage = Math.max(1, ...stages.map((stage) => stage[1]));

  return (
    <AthleticsPage title="Recruiting">
      <div className="ath-overview">
        <div className="ath-overview-metrics">
          <div className="ath-kpi-grid ath-kpi-grid-primary">
            <Metric label="Applications" value={applications.length.toLocaleString()} detail="Matching current filters" />
            <Metric label="Prospects / Inquiries" value={prospects.length.toLocaleString()} detail="Have not applied" />
            <Metric label="Total Scholarship Signed" value={formatCurrency(totalSigned)} detail={`${signedScholarships.length.toLocaleString()} non-zero awards`} />
            <Metric label="Average Scholarship Signed" value={formatCurrency(signedScholarships.length ? totalSigned / signedScholarships.length : 0)} detail="Signed/deposited varsity recruits" />
            <Metric label="Total Scholarship All" value={formatCurrency(totalAll)} detail={`${allScholarships.length.toLocaleString()} awards`} />
            <Metric label="Average Scholarship All" value={formatCurrency(allScholarships.length ? totalAll / allScholarships.length : 0)} detail="Excludes blank and zero awards" />
          </div>
          <div className="ath-overview-awards">
            <div className="ath-section-heading-row">
              <h2>Award details</h2>
              <button type="button" className="ath-text-btn" onClick={toggleAwards} aria-expanded={showAwards}>
                {showAwards ? "Hide" : "Show"}
              </button>
            </div>
            {showAwards ? (
              <div className="ath-kpi-grid ath-kpi-grid-awards">
                <Metric label="Athletic Discretionary Fund" value={formatCurrency(discretionary)} />
                <Metric label="Faith & Football — $6,000" value={faithSix.toLocaleString()} detail="Recipients" />
                <Metric label="Faith & Football — $10,000" value={faithTen.toLocaleString()} detail="Recipients" />
                <Metric label="Impact Player Awards" value={formatCurrency(impact)} />
              </div>
            ) : null}
          </div>
        </div>
        <section className="ath-card">
          <div className="ath-card-title">
            <h2>Applicant stage</h2>
            <Link href="/athletics/master/recruiting/sectors">Open boards →</Link>
          </div>
          <div className="ath-stage-bars">
            {stages.map(([label, count, color]) => (
              <div className="ath-stage-row" key={label}>
                <span><i style={{ background: color }} />{label}</span>
                <div><b style={{ width: `${Math.max(2, count / maxStage * 100)}%`, background: color }} /></div>
                <strong>{count.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AthleticsPage>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="ath-kpi"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}
