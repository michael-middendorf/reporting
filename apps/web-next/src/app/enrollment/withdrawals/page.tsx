"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { BarChart, Section, acShort } from "@/components/enrollment/ui";
import { fmt, fmt1 } from "@/lib/reports/enrollment/load";

export default function WithdrawalsPage() {
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
  const w = data.withdrawn;
  const byAc = Object.entries((w.byAC || {}) as Record<string, number>).sort(
    (a, b) => b[1] - a[1],
  );
  const total = w.total || 1;
  const rows = (w.rows || []) as Record<string, unknown>[];

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">
            Withdrawals {cycle === "fa26" ? "FA26 / SP27" : "FA27 / SP28"}
          </h1>
          <p className="rpt-sub">Withdrawn applications by type and counselor</p>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">Total</div>
          <div className="kpi-val">{fmt(w.total)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">No Decision %</div>
          <div className="kpi-val">{fmt1((w.noDecision / total) * 100)}%</div>
          <div className="kpi-delta">{fmt(w.noDecision)} rows</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Post-Accept %</div>
          <div className="kpi-val">{fmt1((w.postAccept / total) * 100)}%</div>
          <div className="kpi-delta">{fmt(w.postAccept)} rows</div>
        </div>
      </div>

      <Section label="Withdrawals by AC" />
      <BarChart
        rows={byAc.map(([ac, n]) => ({
          label: acShort(ac),
          value: n,
          tone: "red",
        }))}
      />

      <Section label="Withdrawal Detail" />
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference ID</th>
              <th>Name</th>
              <th>AC</th>
              <th>Date</th>
              <th>Athletic</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 250).map((r, i) => (
              <tr key={i}>
                <td>{String(r.PersonReferenceID ?? r.ReferenceID ?? "")}</td>
                <td>{String(r.Name ?? `${r.FirstName || ""} ${r.LastName || ""}`.trim())}</td>
                <td>{acShort(String(r.ACAssignment || ""))}</td>
                <td>{String(r.WithdrawnDate || "").slice(0, 10)}</td>
                <td>{String(r["AthleteNon-Athlete"] ?? r.AthleteorNonAthlete ?? "")}</td>
                <td>{String(r.WithdrawnType || "")}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6}>No withdrawal rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
