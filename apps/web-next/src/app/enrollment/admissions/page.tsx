"use client";

import { useMemo } from "react";
import { useEnrollment } from "../EnrollmentProvider";
import { FallAdmissionsReport } from "@/components/enrollment/fall-report";
import {
  AcceptCodesTable,
  AidTable,
  FunnelHistoryCharts,
  Kpi,
  Section,
} from "@/components/enrollment/ui";
import { buildFallReport } from "@/lib/reports/enrollment/fall-report";
import { fmt } from "@/lib/reports/enrollment/load";

export default function AdmissionsPage() {
  const { data, loading, error, cycle } = useEnrollment();
  const reportYear = cycle === "fa26" ? 2026 : 2027;
  const fallReport = useMemo(() => {
    if (!data) return null;
    return buildFallReport(
      (data.admissions.allRows || []) as Record<string, unknown>[],
      reportYear,
      data.generatedAt,
    );
  }, [data, reportYear]);

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

  const cur = cycle === "fa26" ? data.admissions.fa26 : data.admissions.fa27;
  const prv = cycle === "fa26" ? data.admissions.fa25 : data.admissions.fa26;
  const fa24 = data.admissions.fa24;
  const fa25 = data.admissions.fa25;
  const fa26 = data.admissions.fa26;
  const fa27 = data.admissions.fa27;
  const label = cycle === "fa26" ? "FA26" : "FA27";
  const vs = cycle === "fa26" ? "FA25" : "FA26";

  const history =
    cycle === "fa26"
      ? [
          { label: "FA24", tone: "muted" as const, stats: fa24 },
          { label: "FA25", tone: "secondary" as const, stats: fa25 },
          { label: "FA26", tone: "gold" as const, stats: fa26 },
        ]
      : [
          { label: "FA25", tone: "muted" as const, stats: fa25 },
          { label: "FA26", tone: "secondary" as const, stats: fa26 },
          { label: "FA27", tone: "gold" as const, stats: fa27 },
        ];

  const funnelRows: [string, number | null | undefined, number | null | undefined][] = [
    ["Applications", cur.created, prv.created],
    ["Submitted", cur.submitted, prv.submitted],
    ["Accepted", cur.accepted, prv.accepted],
    ["Conditional accepts", cur.conditional, prv.conditional],
    ["Net deposits", cur.deposits, prv.deposits],
    ["Gross deposits", cur.depositsGross, prv.depositsGross],
    ["Deposit withdrawals", cur.depositsWithdrawn, prv.depositsWithdrawn],
    ["Denied", cur.denied, prv.denied],
    ["Interviewed", cur.interviewed, prv.interviewed],
    ["Withdrawn (any)", cur.withdrawn, prv.withdrawn],
  ];

  const denom = cur.created || 1;

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">{label} Enrollment</h1>
          <p className="rpt-sub">
            Point-in-time vs {vs}. Withdrawal cutoff {cur.withdrawalCutoff}.
          </p>
        </div>
        <span className={`cycle-badge ${cycle === "fa26" ? "cb-26" : "cb-27"}`}>
          {label} View
        </span>
      </div>

      <Section label="Key Metrics" />
      <div className="kpi-strip">
        <Kpi label="Created" cur={cur.created} prv={prv.created} />
        <Kpi label="Submitted" cur={cur.submitted} prv={prv.submitted} />
        <Kpi label="Accepted" cur={cur.accepted} prv={prv.accepted} />
        <Kpi label="Interviews" cur={cur.interviewed} prv={prv.interviewed} />
        <Kpi label="Total Deposits" cur={cur.deposits} prv={prv.deposits} />
        {cycle === "fa26" ? (
          <Kpi label="Accept Rate" cur={cur.acceptRate} prv={prv.acceptRate} format="pct" highlight />
        ) : (
          <Kpi label="Denied" cur={cur.denied} prv={prv.denied} highlight />
        )}
      </div>

      <Section label="Academic Profile — Averages" />
      <div className="kpi-strip">
        <Kpi label="Avg GPA" cur={cur.gpa} prv={prv.gpa} format="1" />
        <Kpi label="Avg ACT" cur={cur.act} prv={prv.act} format="1" />
        <Kpi label="Avg SAT" cur={cur.sat} prv={prv.sat} format="1" />
        <Kpi label="Avg CLT" cur={cur.clt} prv={prv.clt} format="1" />
        <Kpi label="Submit → Accept" cur={cur.daysSubmitAccept} format="days" />
        <Kpi label="Accept → Deposit" cur={cur.daysAcceptDeposit} format="days" />
      </div>

      <Section label="Historical Trend — Application Funnel" />
      <FunnelHistoryCharts terms={history} />

      <Section label="Funnel comparison" />
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>{label}</th>
              <th>{vs}</th>
            </tr>
          </thead>
          <tbody>
            {funnelRows.map(([name, c, p]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{fmt(c)}</td>
                <td>{fmt(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Section label="Financial Aid & Discount Rate" />
      <AidTable
        curLabel={label}
        prvLabel={vs}
        curAcc={cur.aidAcc}
        prvAcc={prv.aidAcc}
        curDep={cur.aidDep}
        prvDep={prv.aidDep}
      />

      <Section label="Acceptances by Code" />
      <AcceptCodesTable codes={cur.codes} />

      {cycle === "fa27" && (
        <>
          <Section label="Demographics" />
          <div className="kpi-strip">
            <Kpi label="% Catholic" cur={(cur.catholic / denom) * 100} format="pct" />
            <Kpi label="% Male" cur={(cur.male / denom) * 100} format="pct" />
            <Kpi label="% Female" cur={(cur.female / denom) * 100} format="pct" />
            <Kpi label="Denied" cur={cur.denied} />
            <Kpi label="Withdrawn" cur={cur.withdrawn} />
          </div>
          <p className="rpt-sub" style={{ marginTop: 8 }}>
            Catholic {fmt(cur.catholic)} · Male {fmt(cur.male)} · Female {fmt(cur.female)} · Apps{" "}
            {fmt(cur.created)}
          </p>
        </>
      )}

      {fallReport && <FallAdmissionsReport report={fallReport} />}
    </div>
  );
}
