"use client";

import { useEnrollment } from "./EnrollmentProvider";
import { Delta } from "@/components/enrollment/ui";
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

/** Registrants = Registered + Attended for every AME month. */
function ameVal(cyc: AmeCyc, mo: string): number {
  if (!cyc[mo]) return 0;
  if (cyc[mo].registrants != null) return cyc[mo].registrants;
  return (cyc[mo].attended || 0) + (cyc[mo].registered || 0);
}
function ameLabel(mo: string): string {
  return `${mo} AME Registrants`;
}
function pswVal(entry: { att: number; total: number } | null | undefined): number {
  if (!entry) return 0;
  return entry.total || 0;
}

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

  const adm = data.admissions as Record<string, unknown>;
  const cur = cycle === "fa26" ? data.admissions.fa26 : data.admissions.fa27;
  // Qlik prior column is YoY point-in-time (event date <= today − 1 year).
  const prv = cycle === "fa26"
    ? ((adm.fa25Yoy as typeof data.admissions.fa26) ?? data.admissions.fa25)
    : ((adm.fa26Yoy as typeof data.admissions.fa26) ?? data.admissions.fa26);
  const c = cur as Record<string, number | null>;
  const p = prv as Record<string, number | null>;
  const label = cycle === "fa26" ? "FA26" : "FA27";
  const vs = cycle === "fa26" ? "FA25" : "FA26 (same date last yr)";

  const curKey = cycle === "fa26" ? "Fall 2026" : "Fall 2027";
  const prvKey = cycle === "fa26" ? "Fall 2025" : "Fall 2026";

  const ameData = data.ame as unknown as Record<string, Record<string, AmeCyc>>;
  const curCyc = (ameData.byCycle || {})[curKey] || {};
  const prvCyc = (ameData.byCycleYoy || ameData.byCycle || {})[prvKey] || {};

  const pswData = data.psw as unknown as {
    byCycle?: Record<string, { att: number; total: number }>;
    byCycleYoy?: Record<string, { att: number; total: number }>;
    byTerm?: Record<string, { att: number; total: number }>;
  };
  const pswByCycle = pswData.byCycle || {};
  const pswByCycleYoy = pswData.byCycleYoy || {};
  const pswCurEntry = pswByCycle[curKey] ?? pswData.byTerm?.[curKey] ?? null;
  const pswPrvEntry = pswByCycleYoy[prvKey] ?? pswByCycle[prvKey] ?? pswData.byTerm?.[prvKey] ?? null;

  const slc = data.slc as unknown as {
    registered?: number | null;
    byTerm?: Record<string, { registered: number; attended: number }>;
    byTermYoy?: Record<string, { registered: number; attended: number }>;
  };
  const slcCur = slc.byTerm?.[curKey];
  const slcPrv = slc.byTermYoy?.[prvKey] ?? slc.byTerm?.[prvKey];
  const slcReg = slcCur?.registered ?? slc.registered ?? 0;
  const slcRegPrv = slcPrv?.registered ?? 0;

  const chg = ((cur as { chg?: Record<string, number | null> }).chg || {}) as Record<string, number | null>;
  function delta7d(field: string): number | null {
    const v = chg[field];
    return v == null ? null : v;
  }

  type Row = {
    label: string;
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
    { label: "Applications Created",   cur: c.created,           prv: p.created,           delta: delta7d("created") },
    { label: "Applications Submitted", cur: c.submitted,         prv: p.submitted,         delta: delta7d("submitted") },
    { label: "Applications Accepted",  cur: c.accepted,          prv: p.accepted,          delta: delta7d("accepted") },
    { label: "Acceptance %",           cur: c.acceptRate,        prv: p.acceptRate,        delta: delta7d("acceptRate"),        pct: true },
    { label: "Yield",                  cur: c.yield,             prv: p.yield,             delta: delta7d("yield"),             pct: true },
    { label: "Conditionally Accepted", cur: c.conditional,       prv: p.conditional,       delta: delta7d("conditional") },
    { label: "Interviews Completed",   cur: c.interviewed,       prv: p.interviewed,       delta: delta7d("interviewed") },
    { label: "Deposits Submitted",     cur: c.depositsGross,     prv: p.depositsGross,     delta: delta7d("depositsGross") },
    { label: "Deposits Withdrawn",     cur: c.depositsWithdrawn, prv: p.depositsWithdrawn, delta: delta7d("depositsWithdrawn"), negativeIsGood: true },
    { label: "Total Deposits",         cur: c.deposits,          prv: p.deposits,          delta: delta7d("deposits"),          bold: true },
    { label: ameLabel("Sep"), cur: ameVal(curCyc, "Sep"), prv: ameVal(prvCyc, "Sep"), delta: ameDelta("Sep"), divider: true },
    { label: ameLabel("Oct"), cur: ameVal(curCyc, "Oct"), prv: ameVal(prvCyc, "Oct"), delta: ameDelta("Oct") },
    { label: ameLabel("Nov"), cur: ameVal(curCyc, "Nov"), prv: ameVal(prvCyc, "Nov"), delta: ameDelta("Nov") },
    { label: "PSW Registrants", cur: pswVal(pswCurEntry), prv: pswVal(pswPrvEntry), delta: null },
    { label: ameLabel("Feb"), cur: ameVal(curCyc, "Feb"), prv: ameVal(prvCyc, "Feb"), delta: ameDelta("Feb") },
    { label: ameLabel("Mar"), cur: ameVal(curCyc, "Mar"), prv: ameVal(prvCyc, "Mar"), delta: ameDelta("Mar") },
    { label: ameLabel("Apr"), cur: ameVal(curCyc, "Apr"), prv: ameVal(prvCyc, "Apr"), delta: ameDelta("Apr") },
    { label: "SLC Registrants",        cur: slcReg, prv: slcRegPrv, delta: null },
  ];

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Enrollment Overview</h1>
          <p className="rpt-sub">
            {label} vs {vs} · net deposits{" "}
            <Delta cur={cur.deposits} prv={prv.deposits} />
          </p>
        </div>
      </div>

      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Metric</th>
              <th style={{ textAlign: "right" }}>{label}</th>
              <th style={{ textAlign: "right" }}>{vs}</th>
              <th style={{ textAlign: "right" }}>+/− 7 days</th>
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
                <td>{row.label}</td>
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
