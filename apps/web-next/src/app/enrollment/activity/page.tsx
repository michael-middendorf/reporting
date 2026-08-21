"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { BarChart, MetricLabel, Section, acShort } from "@/components/enrollment/ui";
import { activityByAC, type AcFunnel } from "@/lib/reports/enrollment/counselors";
import { cycleMeta, pickCurPrv } from "@/lib/reports/enrollment/cycle";
import { DEFS } from "@/lib/reports/enrollment/defs";
import { fmt } from "@/lib/reports/enrollment/load";

export default function ActivityPage() {
  const { data, loading, error, cycle } = useEnrollment();
  if (loading)
    return (
      <div className="view active">
        <p>Loading…</p>
      </div>
    );
  if (error || !data)
    return (
      <div className="view active">
        <p>{error}</p>
      </div>
    );
  const { label } = cycleMeta(cycle);
  const { cur } = pickCurPrv(data.admissions, cycle);
  const byAC = activityByAC((cur.byAC || {}) as Record<string, AcFunnel>);
  const rows = Object.entries(byAC).sort((a, b) => b[1].deposited - a[1].deposited);
  const interviewBars = rows
    .map(([ac, v]) => ({ label: acShort(ac), value: v.interviewed, tone: "secondary" as const }))
    .filter((r) => r.value > 0);
  const caseloadBars = rows.map(([ac, v]) => ({
    label: acShort(ac),
    value: v.created,
    tone: "gold" as const,
  }));

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Counselor Activity</h1>
          <p className="rpt-sub">{label} funnel and interviews by AC assignment</p>
        </div>
      </div>

      <Section label="Interviews by Counselor" info={DEFS.interviewsByAc} />
      <BarChart rows={interviewBars} info={DEFS.interviewsByAc} />

      <Section label="Caseload (Applications) by Counselor" info={DEFS.caseload} />
      <BarChart rows={caseloadBars} info={DEFS.caseload} />

      <Section label="Funnel By Admissions Counselor" info={DEFS.counselor} />
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Counselor</th>
              <th><MetricLabel label="Created" info={DEFS.created} /></th>
              <th><MetricLabel label="Submitted" info={DEFS.submitted} /></th>
              <th><MetricLabel label="Accepted" info={DEFS.accepted} /></th>
              <th><MetricLabel label="Deposited" info={DEFS.depositsNet} /></th>
              <th><MetricLabel label="Denied" info={DEFS.denied} /></th>
              <th><MetricLabel label="Interviewed" info={DEFS.interviewed} /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([ac, v]) => (
              <tr key={ac || "unassigned"}>
                <td>{acShort(ac)}</td>
                <td>{fmt(v.created)}</td>
                <td>{fmt(v.submitted)}</td>
                <td>{fmt(v.accepted)}</td>
                <td>{fmt(v.deposited)}</td>
                <td>{fmt(v.denied)}</td>
                <td>{fmt(v.interviewed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="notice" style={{ marginTop: 16 }}>
        Outreach tables (emails, calls, SMS, Goodkind) are not available in the current Slate
        cache — same gap as the legacy hub.
      </div>
    </div>
  );
}
