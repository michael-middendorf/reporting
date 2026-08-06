"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { Section } from "@/components/enrollment/ui";
import { fmt } from "@/lib/reports/enrollment/load";

export default function PswPage() {
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
  const terms = Object.entries(data.psw).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">President’s Scholarship Weekend</h1>
          <p className="rpt-sub">
            Eligibility criteria (legacy): GPA ≥ 3.7 and ACT/SAT/CLT test thresholds. Live
            eligibility buckets will return when admissions×PSW join is wired.
          </p>
        </div>
      </div>

      <Section label="PSW Attendee Results — By Term" />
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>Attended</th>
              <th>Total registrations</th>
              <th>Attend rate</th>
            </tr>
          </thead>
          <tbody>
            {terms.map(([term, v]) => {
              const row = v as { att: number; total: number };
              const rate = row.total ? (row.att / row.total) * 100 : 0;
              return (
                <tr key={term}>
                  <td>{term || "—"}</td>
                  <td>{fmt(row.att)}</td>
                  <td>{fmt(row.total)}</td>
                  <td>{rate.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
