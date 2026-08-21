"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { Kpi, MetricLabel, Section } from "@/components/enrollment/ui";
import { DEFS } from "@/lib/reports/enrollment/defs";
import { fmt } from "@/lib/reports/enrollment/load";

type AmeMonth = { attended: number; registered: number; registrants?: number };
type AmeCycle = Record<string, AmeMonth>;

function ameMonthVal(cyc: AmeCycle | undefined, mo: string): number {
  const cell = cyc?.[mo];
  if (!cell) return 0;
  if (cell.registrants != null) return cell.registrants;
  return (cell.attended || 0) + (cell.registered || 0);
}

function AmeMonthTable({
  caption,
  months,
  curLabel,
  prvLabel,
  curCyc,
  prvCyc,
}: {
  caption: string;
  months: string[];
  curLabel: string;
  prvLabel: string;
  curCyc: AmeCycle;
  prvCyc: AmeCycle;
}) {
  const yoyRows = [
    { label: curLabel, cyc: curCyc, bold: true },
    { label: prvLabel, cyc: prvCyc, bold: false },
  ];
  return (
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
          <MetricLabel label={caption} info={DEFS.ameRegistrants} />
        </caption>
        <thead>
          <tr>
            <th></th>
            {months.map((m) => (
              <th key={m}>{m}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {yoyRows.map((row) => {
            const total = months.reduce((s, m) => s + ameMonthVal(row.cyc, m), 0);
            return (
              <tr key={row.label} style={{ fontWeight: row.bold ? 600 : undefined }}>
                <td>{row.label}</td>
                {months.map((m) => (
                  <td key={m}>{fmt(ameMonthVal(row.cyc, m))}</td>
                ))}
                <td style={{ fontWeight: 600 }}>{fmt(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function EventsPage() {
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
        <p>{error || "No data"}</p>
      </div>
    );

  const ame = data.ame as unknown as Record<string, unknown>;
  const campus = data.campus as unknown as Record<string, unknown>;
  type AmeFy = { total: number; attended: number; registered: number; cancelled: number; noShow: number };
  const byFy = (ame.byFy || {}) as Record<string, AmeFy>;
  const byCycle = (ame.byCycle || campus.byCycle || {}) as Record<string, AmeCycle>;
  const byCycleYoy = (ame.byCycleYoy || {}) as Record<string, AmeCycle>;
  const FALL_MONTHS = ["Sep", "Oct", "Nov"];
  const SPRING_MONTHS = ["Feb", "Mar", "Apr"];
  const curKey = cycle === "fa26" ? "Fall 2026" : "Fall 2027";
  const prvKey = cycle === "fa26" ? "Fall 2025" : "Fall 2026";
  const curLabel = cycle === "fa26" ? "FA26" : "FA27";
  const prvLabel = cycle === "fa26" ? "FA25" : "FA26";
  const fy = byFy[curKey] || { total: 0, attended: 0, registered: 0, cancelled: 0, noShow: 0 };
  const curCyc = byCycle[curKey] || {};
  const prvCyc = byCycleYoy[prvKey] || {};

  // PSW is one January weekend per year. byCycle keys off event date, not
  // the student's application Term (which is why Fall/Spring used to appear).
  const pswPack = data.psw as unknown as {
    byCycle?: Record<string, { att: number; total: number; noShow?: number; cancelled?: number }>;
    byTerm?: Record<string, { att: number; total: number; noShow?: number; cancelled?: number }>;
  };
  const pswMap = pswPack.byCycle || {};
  const pswEvents = Object.entries(pswMap)
    .filter(([k, v]) => k && (v.total || 0) > 0)
    .sort((a, b) => b[0].localeCompare(a[0]));
  function pswEventLabel(cycleKey: string) {
    const m = String(cycleKey).match(/(\d{4})/);
    return m ? `January ${m[1]}` : cycleKey;
  }

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
      <Section label="Ave Maria Experience (AME)" info={DEFS.ameYoy} />
      <p className="rpt-sub" style={{ margin: "0 0 12px" }}>
        KPI counts are the selected term&rsquo;s fiscal year (July 1–June 30). Month tables are year-over-year by event month.
      </p>
      <div className="kpi-strip">
        <Kpi label="Total" cur={fy.total} info={DEFS.ameTotal} />
        <Kpi label="Registered" cur={fy.attended + fy.registered} info={DEFS.ameFyRegistered} />
        <Kpi label="Attended" cur={fy.attended} info={DEFS.ameFyAttended} />
        <Kpi label="Cancelled" cur={fy.cancelled} info={DEFS.ameFyCancelled} />
        <Kpi label="No Show" cur={fy.noShow} info={DEFS.ameFyNoShow} />
      </div>

      <div className="g2" style={{ gap: 16, marginTop: 16 }}>
        <AmeMonthTable
          caption="Fall AME Registrants (Sept / Oct / Nov)"
          months={FALL_MONTHS}
          curLabel={curLabel}
          prvLabel={prvLabel}
          curCyc={curCyc}
          prvCyc={prvCyc}
        />
        <AmeMonthTable
          caption="Spring AME Registrants (Feb / Mar / Apr)"
          months={SPRING_MONTHS}
          curLabel={curLabel}
          prvLabel={prvLabel}
          curCyc={curCyc}
          prvCyc={prvCyc}
        />
      </div>

      {/* ── PSW ── */}
      <Section label="President's Scholarship Weekend (PSW)" info={DEFS.pswRegistrants} />
      <p className="rpt-sub" style={{ margin: "0 0 12px" }}>
        One weekend per year, typically January. Counts are by event date, not application term.
      </p>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Event</th>
              <th><MetricLabel label="Attended" info={DEFS.pswAttended} /></th>
              <th><MetricLabel label="No Show" info={DEFS.pswNoShow} /></th>
              <th><MetricLabel label="Cancelled" info={DEFS.pswCancelled} /></th>
              <th><MetricLabel label="Total Registrations" info={DEFS.pswTotal} /></th>
              <th><MetricLabel label="Attend Rate" info={DEFS.pswRate} flip /></th>
            </tr>
          </thead>
          <tbody>
            {pswEvents.map(([cycleKey, v]) => {
              const att = v.att || 0;
              const total = v.total || 0;
              const rate = total ? (att / total) * 100 : 0;
              return (
                <tr key={cycleKey}>
                  <td>{pswEventLabel(cycleKey)}</td>
                  <td>{fmt(att)}</td>
                  <td>{fmt(v.noShow || 0)}</td>
                  <td>{fmt(v.cancelled || 0)}</td>
                  <td>{fmt(total)}</td>
                  <td>{rate.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── SLC ── */}
      <Section label="Summer Leadership Conference (SLC)" info={DEFS.slcRegistrants} />
      <div className="kpi-strip">
        <Kpi label="Applied" cur={s.applied} info={DEFS.slcApplied} />
        <Kpi label="Accepted" cur={s.accepted} info={DEFS.slcAccepted} />
        <Kpi label="Registered" cur={s.registered} info={DEFS.slcRegistered} />
        <Kpi label="Attended" cur={s.attended} info={DEFS.slcAttended} />
        <Kpi label="Denied" cur={s.denied} info={DEFS.slcDenied} />
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
              <MetricLabel label="By Class Level" info={DEFS.slcClass} />
            </caption>
            <thead>
              <tr>
                <th>Class Year</th>
                <th><MetricLabel label="Applied" info={DEFS.slcApplied} /></th>
                <th><MetricLabel label="Accepted" info={DEFS.slcAccepted} /></th>
                <th><MetricLabel label="Registered" info={DEFS.slcRegistered} /></th>
                <th><MetricLabel label="Denied" info={DEFS.slcDenied} /></th>
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
              <MetricLabel label="Registration by Session & Gender" info={DEFS.slcSession} />
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
                <th><MetricLabel label="Workflow Bin / Status" info={DEFS.slcBin} /></th>
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
