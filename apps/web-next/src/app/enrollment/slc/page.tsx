"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { fmt } from "@/lib/reports/enrollment/load";

export default function SlcPage() {
  const { data, loading, error } = useEnrollment();
  if (loading) return <div className="view active"><p>Loading…</p></div>;
  if (error || !data) return <div className="view active"><p>{error}</p></div>;
  const s = data.slc;

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Summer Leadership Conference</h1>
          <p className="rpt-sub">Applications and registration outcomes</p>
        </div>
      </div>
      <div className="kpi-strip">
        {[
          ["Applied", s.applied],
          ["Accepted", s.accepted],
          ["Registered", s.registered],
          ["Denied", s.denied],
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
              <th>Class year</th>
              <th>Applied</th>
              <th>Accepted</th>
              <th>Registered</th>
              <th>Denied</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(s.byClass).map(([cl, v]) => (
              <tr key={cl}>
                <td>{cl}</td>
                <td>{v.applied}</td>
                <td>{v.accepted}</td>
                <td>{v.registered}</td>
                <td>{v.denied}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
