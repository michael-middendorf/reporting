"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { fmt } from "@/lib/reports/enrollment/load";

export default function WithdrawalsPage() {
  const { data, loading, error } = useEnrollment();
  if (loading) return <div className="view active"><p>Loading…</p></div>;
  if (error || !data) return <div className="view active"><p>{error}</p></div>;
  const w = data.withdrawn;
  const byAc = Object.entries((w.byAC || {}) as Record<string, number>).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Withdrawals</h1>
          <p className="rpt-sub">Withdrawn applications</p>
        </div>
      </div>
      <div className="kpi-strip">
        {[
          ["Total", w.total],
          ["Post-accept", w.postAccept],
          ["No decision", w.noDecision],
        ].map(([l, v]) => (
          <div className="kpi" key={l as string}>
            <div className="kpi-label">{l as string}</div>
            <div className="kpi-val">{fmt(v as number)}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Counselor</th>
              <th>Withdrawals</th>
            </tr>
          </thead>
          <tbody>
            {byAc.map(([ac, n]) => (
              <tr key={ac || "unassigned"}>
                <td>{ac || "Unassigned"}</td>
                <td>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
