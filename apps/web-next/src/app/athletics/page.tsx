"use client";

import Link from "next/link";
import { AthleticsPage, useAthletics } from "@/components/athletics/AthleticsShell";
import { eligibleSigned, STAGE_COLORS, stageName } from "@/lib/reports/athletics/normalize";
import { formatCurrency } from "@/components/athletics/DataTable";

export default function AthleticsOverviewPage() {
  const { filteredApplications: applications, filteredProspects: prospects } = useAthletics();
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
    <AthleticsPage title="Athletics Master" description="A department-wide view of recruiting, scholarships, commitments, and the prospect pipeline.">
      <section className="ath-overview-section">
        <div className="ath-section-heading"><h2>Department snapshot</h2><p>Scholarships and recruiting activity matching the current filters.</p></div>
        <div className="ath-kpi-grid ath-kpi-grid-primary">
          <Metric label="Applications" value={applications.length.toLocaleString()} detail="Matching current filters" />
          <Metric label="Prospects / Inquiries" value={prospects.length.toLocaleString()} detail="Have not applied" />
          <Metric label="Total Scholarship Signed" value={formatCurrency(totalSigned)} detail={`${signedScholarships.length.toLocaleString()} non-zero awards`} />
          <Metric label="Average Scholarship Signed" value={formatCurrency(signedScholarships.length ? totalSigned / signedScholarships.length : 0)} detail="Signed/deposited varsity recruits" />
          <Metric label="Total Scholarship All" value={formatCurrency(totalAll)} detail={`${allScholarships.length.toLocaleString()} awards`} />
          <Metric label="Average Scholarship All" value={formatCurrency(allScholarships.length ? totalAll / allScholarships.length : 0)} detail="Excludes blank and zero awards" />
        </div>
      </section>

      <section className="ath-overview-section">
        <div className="ath-section-heading"><h2>Award details</h2><p>Department-controlled and specialized athletic awards.</p></div>
        <div className="ath-kpi-grid ath-kpi-grid-awards">
          <Metric label="Athletic Discretionary Fund" value={formatCurrency(discretionary)} />
          <Metric label="Faith & Football — $6,000" value={faithSix.toLocaleString()} detail="Recipients" />
          <Metric label="Faith & Football — $10,000" value={faithTen.toLocaleString()} detail="Recipients" />
          <Metric label="Impact Player Awards" value={formatCurrency(impact)} />
        </div>
      </section>

      <section className="ath-overview-section">
        <div className="ath-section-heading"><h2>Recruiting pipeline</h2><p>Applicants by their furthest current stage.</p></div>
        <section className="ath-card">
          <div className="ath-card-title"><div><h2>Applicant stage</h2><p>Colors match the Athletics sector boards.</p></div><Link href="/athletics/sectors">Open boards →</Link></div>
          <div className="ath-stage-bars">
            {stages.map(([label, count, color]) => <div className="ath-stage-row" key={label}><span><i style={{ background: color }} />{label}</span><div><b style={{ width: `${Math.max(2, count / maxStage * 100)}%`, background: color }} /></div><strong>{count.toLocaleString()}</strong></div>)}
          </div>
        </section>
      </section>
    </AthleticsPage>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="ath-kpi"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}
