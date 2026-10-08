"use client";

import Link from "next/link";
import {
  CyberLoadView,
  EmptyState,
  KpiGrid,
  PageHead,
  formatAsOf,
  useCyberData,
  useCyberRegister,
} from "@/components/cyber/CyberUi";
import { RiskTable, topRisks } from "@/components/cyber/RiskViews";
import { kpisForSection } from "@/lib/cyber/shape";

const HEADLINE_PLANNED = [
  "Microsoft Secure Score %",
  "MFA coverage",
  "Global Admins",
  "Critical/high vulnerabilities past SLA",
  "Mean time to remediate",
  "Defender coverage",
  "Open incidents",
  "Backup success",
  "Overdue risk treatments",
  "GLBA program items complete",
];

export default function CybersecurityOverviewPage() {
  const data = useCyberData();
  const register = useCyberRegister();
  return (
    <main className="cy">
      <PageHead
        title="Board scorecard"
        sub="Headline security KPIs, the top open risks, and what changed since the last meeting. Counts and statuses only."
      />
      <CyberLoadView load={data} planned={HEADLINE_PLANNED}>
        {(d) => {
          const kpis = kpisForSection(d.snapshot, "overview");
          return (
            <>
              <p className="cy-sub">Snapshot published {formatAsOf(d.snapshot.generatedAt)}.</p>
              {kpis.length ? <KpiGrid kpis={kpis} /> : <EmptyState planned={HEADLINE_PLANNED} />}
              {d.snapshot.changes && d.snapshot.changes.length > 0 && (
                <>
                  <h2>What changed since the last meeting</h2>
                  <ul className="cy-list">
                    {d.snapshot.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          );
        }}
      </CyberLoadView>

      <h2>Top 5 open risks</h2>
      {register.kind === "ok" ? (
        <>
          <RiskTable risks={topRisks(register.data.risks)} compact />
          <p className="cy-sub" style={{ marginTop: 8 }}>
            <Link href="/cybersecurity/risks">Open the full risk register</Link>
          </p>
        </>
      ) : (
        <CyberLoadView load={register}>{() => null}</CyberLoadView>
      )}
    </main>
  );
}
