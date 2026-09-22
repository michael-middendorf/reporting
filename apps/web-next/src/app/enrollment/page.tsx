"use client";

import { useEnrollment } from "./EnrollmentProvider";
import { Delta, MetricLabel } from "@/components/enrollment/ui";
import { cycleMeta, pickCurPrv } from "@/lib/reports/enrollment/cycle";
import { DEFS } from "@/lib/reports/enrollment/defs";
import { fmt } from "@/lib/reports/enrollment/load";

function fmtPct(v: number | null | undefined) {
  return v != null ? `${v.toFixed(1)}%` : "—";
}
function fmtDelta(delta: number | null | undefined, pct?: boolean) {
  if (delta == null) return "—";
  const sign = delta > 0 ? "+" : "";
  return pct ? `${sign}${delta.toFixed(1)}pp` : `${sign}${Math.round(delta).toLocaleString()}`;
}
type AmeCyc = Record<string, { attended: number; registered: number; registrants?: number; chg?: number }>;

export default function EnrollmentOverviewPage() {
  const { data, error, loading, cycle } = useEnrollment();
  if (loading)
    return (
      <div className="view active">
        <p>Loading…</p>
      </div>
    );
  if (error)
    return (
      <div className="view active">
        <p>Error: {error}</p>
      </div>
    );
  if (!data) return null;

  const adm = data.admissions;
  const { label, vs, curKey, prvKey } = cycleMeta(cycle);
  const { cur, prv } = pickCurPrv(adm, cycle);
  const c = cur as Record<string, number | null>;
  const p = prv as Record<string, number | null>;
  const recPrv = cycle === "fa27" ? p : undefined;

  const ameData = data.ame as unknown as Record<string, Record<string, AmeCyc>>;
  const curCyc = (ameData.byCycle || {})[curKey] || {};
  const prvCyc = (ameData.byCycleYoy || ameData.byCycle || {})[prvKey] || {};

  const pswData = data.psw as unknown as {
    byCycle?: Record<string, { att: number; total?: number; registered?: number }>;
    byCycleYoy?: Record<string, { att: number; total?: number; registered?: number }>;
    byTerm?: Record<string, { att: number; total?: number; registered?: number }>;
  };
  const pswByCycle = pswData.byCycle || {};
  const pswByCycleYoy = pswData.byCycleYoy || {};
  const pswCurEntry = pswByCycle[curKey] ?? pswData.byTerm?.[curKey] ?? null;
  // Do not fall back to full last-cycle totals when nobody had signed up yet.
  const pswPrvEntry = pswByCycleYoy[prvKey] ?? null;

  const slc = data.slc as unknown as {
    registered?: number | null;
    byTerm?: Record<string, { registered: number; attended: number }>;
    byTermYoy?: Record<string, { registered: number; attended: number }>;
  };
  const slcCur = slc.byTerm?.[curKey];
  const slcPrv = slc.byTermYoy?.[prvKey] ?? slc.byTerm?.[prvKey];
  const slcReg = slcCur?.registered ?? slc.registered ?? 0;
  const slcRegPrv = slcPrv?.registered ?? 0;
  const slcAtt = slcCur?.attended ?? 0;
  const slcAttPrv = slcPrv?.attended ?? 0;

  const chg = ((cur as { chg?: Record<string, number | null> }).chg || {}) as Record<string, number | null>;
  function delta7d(field: string): number | null {
    const v = chg[field];
    return v == null ? null : v;
  }

  type Row = {
    label: string;
    info: string;
    cur: number | null | undefined;
    prv: number | null | undefined;
    delta?: number | null;
    pct?: boolean;
    bold?: boolean;
    divider?: boolean;
    negativeIsGood?: boolean;
  };

  function ameDelta(mo: string): number | null {
    const v = curCyc[mo]?.chg;
    return v == null ? null : v;
  }

  const rows: Row[] = [
    { label: "Applications Created",   info: DEFS.created, cur: c.created,           prv: p.created,           delta: delta7d("created") },
    { label: "Applications Submitted", info: DEFS.submitted, cur: c.submitted,       prv: p.submitted,         delta: delta7d("submitted") },
    { label: "Applications Accepted",  info: DEFS.accepted, cur: c.accepted,          prv: p.accepted,          delta: delta7d("accepted") },
    { label: "Acceptance %",           info: DEFS.acceptRate, cur: c.acceptRate,      prv: p.acceptRate,        delta: delta7d("acceptRate"),        pct: true },
    { label: "Yield",                  info: DEFS.yield, cur: c.yield,                prv: p.yield,             delta: delta7d("yield"),             pct: true },
    { label: "Conditionally Accepted", info: DEFS.conditional, cur: c.conditional,    prv: p.conditional,       delta: delta7d("conditional") },
    { label: "Interviews Completed",   info: DEFS.interviewed, cur: c.interviewed,    prv: p.interviewed,       delta: delta7d("interviewed") },
    { label: "Interviewed athletes", info: DEFS.interviewedAthletes, cur: c.interviewedAthletes, prv: p.interviewedAthletes, delta: delta7d("interviewedAthletes") },
    { label: "Athlete %", info: DEFS.interviewedAthletePct, cur: c.interviewedAthletePct, prv: p.interviewedAthletePct, delta: delta7d("interviewedAthletePct"), pct: true },
    { label: "AC Rec 3s", info: DEFS.acRec3, cur: c.acRec3, prv: recPrv?.acRec3 },
    { label: "AC Rec 4s", info: DEFS.acRec4, cur: c.acRec4, prv: recPrv?.acRec4 },
    { label: "AC Rec 3s & 4s", info: DEFS.acRec34, cur: c.acRec34, prv: recPrv?.acRec34 },
    { label: "Deposits Submitted",     info: DEFS.depositsGross, cur: c.depositsGross, prv: p.depositsGross,     delta: delta7d("depositsGross") },
    { label: "Deposits Withdrawn",     info: DEFS.depositsWithdrawn, cur: c.depositsWithdrawn, prv: p.depositsWithdrawn, delta: delta7d("depositsWithdrawn"), negativeIsGood: true },
    { label: "Total Deposits",         info: DEFS.depositsNet, cur: c.deposits,        prv: p.deposits,          delta: delta7d("deposits"),          bold: true },
    { label: "Sep AME Registered", info: DEFS.ameRegisteredStatus, cur: curCyc.Sep?.registered || 0, prv: prvCyc.Sep?.registered || 0, delta: ameDelta("Sep"), divider: true },
    { label: "Sep AME Attended", info: DEFS.ameAttendedMonth, cur: curCyc.Sep?.attended || 0, prv: prvCyc.Sep?.attended || 0 },
    { label: "Oct AME Registered", info: DEFS.ameRegisteredStatus, cur: curCyc.Oct?.registered || 0, prv: prvCyc.Oct?.registered || 0, delta: ameDelta("Oct") },
    { label: "Oct AME Attended", info: DEFS.ameAttendedMonth, cur: curCyc.Oct?.attended || 0, prv: prvCyc.Oct?.attended || 0 },
    { label: "Nov AME Registered", info: DEFS.ameRegisteredStatus, cur: curCyc.Nov?.registered || 0, prv: prvCyc.Nov?.registered || 0, delta: ameDelta("Nov") },
    { label: "Nov AME Attended", info: DEFS.ameAttendedMonth, cur: curCyc.Nov?.attended || 0, prv: prvCyc.Nov?.attended || 0 },
    { label: "PSW Registered", info: DEFS.pswRegisteredStatus, cur: pswCurEntry?.registered || 0, prv: pswPrvEntry?.registered || 0 },
    { label: "PSW Attended", info: DEFS.pswAttended, cur: pswCurEntry?.att || 0, prv: pswPrvEntry?.att || 0 },
    { label: "Feb AME Registered", info: DEFS.ameRegisteredStatus, cur: curCyc.Feb?.registered || 0, prv: prvCyc.Feb?.registered || 0, delta: ameDelta("Feb") },
    { label: "Feb AME Attended", info: DEFS.ameAttendedMonth, cur: curCyc.Feb?.attended || 0, prv: prvCyc.Feb?.attended || 0 },
    { label: "Mar AME Registered", info: DEFS.ameRegisteredStatus, cur: curCyc.Mar?.registered || 0, prv: prvCyc.Mar?.registered || 0, delta: ameDelta("Mar") },
    { label: "Mar AME Attended", info: DEFS.ameAttendedMonth, cur: curCyc.Mar?.attended || 0, prv: prvCyc.Mar?.attended || 0 },
    { label: "Apr AME Registered", info: DEFS.ameRegisteredStatus, cur: curCyc.Apr?.registered || 0, prv: prvCyc.Apr?.registered || 0, delta: ameDelta("Apr") },
    { label: "Apr AME Attended", info: DEFS.ameAttendedMonth, cur: curCyc.Apr?.attended || 0, prv: prvCyc.Apr?.attended || 0 },
    { label: "SLC Registered", info: DEFS.slcRegistered, cur: slcReg, prv: slcRegPrv },
    { label: "SLC Attended", info: DEFS.slcAttended, cur: slcAtt, prv: slcAttPrv },
  ];

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Enrollment Overview</h1>
          <p className="rpt-sub">
            {label} vs {vs} · undergraduate, year-over-year as of this date · net deposits{" "}
            <Delta cur={cur.deposits} prv={prv.deposits} />
          </p>
        </div>
      </div>

      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Metric</th>
              <th style={{ textAlign: "right" }}><MetricLabel label={label} info={DEFS.ug} flip /></th>
              <th style={{ textAlign: "right" }}><MetricLabel label={vs} info={DEFS.yoy} flip /></th>
              <th style={{ textAlign: "right" }}><MetricLabel label="+/− 7 days" info={DEFS.delta7d} flip /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                style={{
                  borderTop: row.divider
                    ? "2px solid var(--border, #e5e7eb)"
                    : undefined,
                  fontWeight: row.bold ? 600 : undefined,
                }}
              >
                <td><MetricLabel label={row.label} info={row.info} /></td>
                <td style={{ textAlign: "right" }}>
                  {row.pct ? fmtPct(row.cur) : fmt(row.cur)}
                </td>
                <td style={{ textAlign: "right" }}>
                  {row.pct ? fmtPct(row.prv) : fmt(row.prv)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    color: (() => {
                      const d = row.delta;
                      if (d == null || d === 0) return undefined;
                      const good = row.negativeIsGood ? d < 0 : d > 0;
                      return good ? "var(--green,#16a34a)" : "var(--red,#dc2626)";
                    })(),
                  }}
                >
                  {fmtDelta(row.delta, row.pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
