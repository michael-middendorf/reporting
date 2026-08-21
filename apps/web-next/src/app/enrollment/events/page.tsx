"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { Section } from "@/components/enrollment/ui";
import { fmt } from "@/lib/reports/enrollment/load";

export default function EventsPage() {
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
        <p>{error || "No data"}</p>
      </div>
    );

  // AME grouped by event-month recruiting cycle (Qlik FA26 Enrollment Report).
  const ame = data.ame as unknown as Record<string, unknown>;
  const campus = data.campus as unknown as Record<string, unknown>;
  const byCycle = ((ame.byCycle || campus.byCycle || {}) as Record<
    string,
    Record<string, { attended: number; registered: number; registrants?: number }>
  >);
  const cycleKeys = Object.keys(byCycle).sort();
  const FALL_MONTHS = ["Sep", "Oct", "Nov"];
  const SPRING_MONTHS = ["Feb", "Mar", "Apr"];

  // PSW
  const pswPack = data.psw as unknown as {
    byTerm?: Record<string, { att: number; total: number }>;
  } & Record<string, { att: number; total: number }>;
  const pswMap = pswPack.byTerm || pswPack;
  const pswTerms = Object.entries(pswMap)
    .filter(([k]) => k !== "byTerm" && k !== "byCycle")
    .sort((a, b) => a[0].localeCompare(b[0]));

  // SLC
  const s = data.slc;
  const sessions = Object.entries(
    (s.bySess || {}) as Record<string, { Female: number; Male: number; total: number }>,
  ).sort((a, b) => a[0].localeCompare(b[0]));
  const bins = Object.entries(
    (s.bins || {}) as Record<string, number>,
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Events & Campus Visits</h1>
          <p className="rpt-sub">AME, President's Scholarship Weekend, and Summer Leadership Conference</p>
        </div>
      </div>

      {/* ── AME ── */}
      <Section label="Ave Maria Experience (AME) — Campus Visits" />
      <div className="kpi-strip">
        {(
          [
            ["Total", (ame.total as number) ?? (campus.total as number)],
            ["Attended", campus.attended as number],
            ["Registered", campus.registered as number],
            ["Cancelled", campus.cancelled as number],
            ["No Show", campus.noShow as number],
          ] as [string, number][]
        ).map(([l, v]) => (
          <div className="kpi" key={l}>
            <div className="kpi-label">{l}</div>
            <div className="kpi-val">{fmt(v)}</div>
          </div>
        ))}
      </div>

      {cycleKeys.length > 0 && (
        <>
          <div className="g2" style={{ gap: 16, marginTop: 16 }}>
            {/* Fall AME (attendees by month) */}
            <div className="panel" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <caption
                  style={{
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: 12,
                    color: "var(--muted,#666)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "8px 0 4px",
                  }}
                >
                  Fall AME Registrants (Sept / Oct / Nov)
                </caption>
                <thead>
                  <tr>
                    <th>FA Cycle</th>
                    {FALL_MONTHS.map((m) => (
                      <th key={m}>{m}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cycleKeys.map((cy) => {
                    const cyc = byCycle[cy];
                    const monthVal = (m: string) =>
                      (cyc[m]?.registrants ?? ((cyc[m]?.attended || 0) + (cyc[m]?.registered || 0)));
                    const total = FALL_MONTHS.reduce((s, m) => s + monthVal(m), 0);
                    return (
                      <tr key={cy}>
                        <td>{cy}</td>
                        {FALL_MONTHS.map((m) => (
                          <td key={m}>{fmt(cyc[m] ? monthVal(m) : null)}</td>
                        ))}
                        <td style={{ fontWeight: 600 }}>{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Spring AME (registrants by month) */}
            <div className="panel" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <caption
                  style={{
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: 12,
                    color: "var(--muted,#666)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "8px 0 4px",
                  }}
                >
                  Spring AME Registrants (Feb / Mar / Apr)
                </caption>
                <thead>
                  <tr>
                    <th>FA Cycle</th>
                    {SPRING_MONTHS.map((m) => (
                      <th key={m}>{m}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cycleKeys.map((cy) => {
                    const cyc = byCycle[cy];
                    const total = SPRING_MONTHS.reduce(
                      (s, m) => s + (cyc[m]?.attended || 0) + (cyc[m]?.registered || 0),
                      0,
                    );
                    return (
                      <tr key={cy}>
                        <td>{cy}</td>
                        {SPRING_MONTHS.map((m) => (
                          <td key={m}>
                            {fmt(
                              cyc[m]
                                ? (cyc[m].attended || 0) + (cyc[m].registered || 0)
                                : null,
                            )}
                          </td>
                        ))}
                        <td style={{ fontWeight: 600 }}>{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── PSW ── */}
      <Section label="President's Scholarship Weekend (PSW)" />
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>Attended</th>
              <th>Total Registrations</th>
              <th>Attend Rate</th>
            </tr>
          </thead>
          <tbody>
            {pswTerms.map(([term, v]) => {
              const rate = v.total ? (v.att / v.total) * 100 : 0;
              return (
                <tr key={term}>
                  <td>{term || "—"}</td>
                  <td>{fmt(v.att)}</td>
                  <td>{fmt(v.total)}</td>
                  <td>{rate.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── SLC ── */}
      <Section label="Summer Leadership Conference (SLC)" />
      <div className="kpi-strip">
        {(
          [
            ["Applied", s.applied],
            ["Accepted", s.accepted],
            ["Registered", s.registered],
            ["Attended", s.attended],
            ["Denied", s.denied],
          ] as [string, number][]
        ).map(([l, v]) => (
          <div className="kpi" key={l}>
            <div className="kpi-label">{l}</div>
            <div className="kpi-val">{fmt(v)}</div>
          </div>
        ))}
      </div>

      <div className="g2" style={{ gap: 16, marginTop: 16 }}>
        <div className="panel" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <caption
              style={{
                textAlign: "left",
                fontWeight: 600,
                fontSize: 12,
                color: "var(--muted,#666)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "8px 0 4px",
              }}
            >
              By Class Level
            </caption>
            <thead>
              <tr>
                <th>Class Year</th>
                <th>Applied</th>
                <th>Accepted</th>
                <th>Registered</th>
                <th>Denied</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(
                s.byClass as Record<
                  string,
                  { applied: number; accepted: number; registered: number; denied: number }
                >,
              ).map(([cl, v]) => (
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

        <div className="panel" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <caption
              style={{
                textAlign: "left",
                fontWeight: 600,
                fontSize: 12,
                color: "var(--muted,#666)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "8px 0 4px",
              }}
            >
              Registration by Session & Gender
            </caption>
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
                  <td colSpan={4}>No sessions yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {bins.length > 0 && (
        <div className="panel" style={{ marginTop: 16, overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Workflow Bin / Status</th>
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
      )}
    </div>
  );
}
