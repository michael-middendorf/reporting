"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { Section } from "@/components/enrollment/ui";
import { fmt } from "@/lib/reports/enrollment/load";

export default function SlcPage() {
  const { data, loading, error } = useEnrollment();
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
  const s = data.slc;
  const sessions = Object.entries(s.bySess || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const bins = Object.entries(s.bins || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Summer Leadership Conference</h1>
          <p className="rpt-sub">Applications and registration outcomes</p>
        </div>
      </div>

      <Section label="Year Over Year" />
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

      <Section label="Applied — By Class Level" />
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

      <Section label="Registration by Session & Gender" />
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Female</th>
              <th>Male</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(([sess, v]) => (
              <tr key={sess}>
                <td>{sess || "—"}</td>
                <td>{v.Female}</td>
                <td>{v.Male}</td>
                <td>{v.total}</td>
              </tr>
            ))}
            {!sessions.length && (
              <tr>
                <td colSpan={4}>No registered sessions yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Section label="Registrant Status / Workflow Bins" />
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Bin / Status</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {bins.map(([b, n]) => (
              <tr key={b || "blank"}>
                <td>{b || "(blank)"}</td>
                <td>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
