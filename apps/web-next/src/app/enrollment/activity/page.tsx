"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { BarChart, Section, acShort } from "@/components/enrollment/ui";
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
  const cur = cycle === "fa26" ? data.admissions.fa26 : data.admissions.fa27;
  const label = cycle === "fa26" ? "FA26" : "FA27";
  const byAC = (cur.byAC || {}) as Record<
    string,
    {
      created: number;
      submitted: number;
      accepted: number;
      deposited: number;
      denied: number;
      interviewed: number;
    }
  >;
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

      <Section label="Interviews by Counselor" />
      <BarChart rows={interviewBars} />

      <Section label="Caseload (Applications) by Counselor" />
      <BarChart rows={caseloadBars} />

      <Section label="Funnel By Admissions Counselor" />
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Counselor</th>
              <th>Created</th>
              <th>Submitted</th>
              <th>Accepted</th>
              <th>Deposited</th>
              <th>Denied</th>
              <th>Interviewed</th>
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
