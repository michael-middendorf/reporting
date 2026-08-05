"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { fmt } from "@/lib/reports/enrollment/load";

export default function ActivityPage() {
  const { data, loading, error, cycle } = useEnrollment();
  if (loading) return <div className="view active"><p>Loading…</p></div>;
  if (error || !data) return <div className="view active"><p>{error}</p></div>;
  const cur = cycle === "fa26" ? data.admissions.fa26 : data.admissions.fa27;
  const byAC = (cur.byAC || {}) as Record<
    string,
    {
      created: number;
      accepted: number;
      deposited: number;
      denied: number;
      interviewed: number;
    }
  >;
  const rows = Object.entries(byAC).sort((a, b) => b[1].deposited - a[1].deposited);

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Counselor Activity</h1>
          <p className="rpt-sub">Funnel by AC assignment</p>
        </div>
      </div>
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Counselor</th>
              <th>Apps</th>
              <th>Accepted</th>
              <th>Deposited</th>
              <th>Denied</th>
              <th>Interviewed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([ac, v]) => (
              <tr key={ac || "unassigned"}>
                <td>{ac || "Unassigned"}</td>
                <td>{fmt(v.created)}</td>
                <td>{fmt(v.accepted)}</td>
                <td>{fmt(v.deposited)}</td>
                <td>{fmt(v.denied)}</td>
                <td>{fmt(v.interviewed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
