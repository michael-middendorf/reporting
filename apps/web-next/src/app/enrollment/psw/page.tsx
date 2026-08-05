"use client";

import { useEnrollment } from "../EnrollmentProvider";

export default function PswPage() {
  const { data, loading, error } = useEnrollment();
  if (loading) return <div className="view active"><p>Loading…</p></div>;
  if (error || !data) return <div className="view active"><p>{error}</p></div>;
  const entries = Object.entries(data.psw);
  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">President’s Scholarship Weekend</h1>
          <p className="rpt-sub">Attendance by term</p>
        </div>
      </div>
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>Attended</th>
              <th>Total</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([term, v]) => {
              const row = v as { att: number; total: number };
              const rate = row.total ? ((row.att / row.total) * 100).toFixed(1) : "—";
              return (
                <tr key={term}>
                  <td>{term || "—"}</td>
                  <td>{row.att}</td>
                  <td>{row.total}</td>
                  <td>{rate}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
