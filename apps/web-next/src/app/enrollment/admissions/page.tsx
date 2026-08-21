"use client";

import { useEnrollment } from "../EnrollmentProvider";
import {
  AcceptCodesTable,
  AidTable,
  BarChart,
  FunnelHistoryCharts,
  Kpi,
  Section,
  acShort,
} from "@/components/enrollment/ui";
import { fmt } from "@/lib/reports/enrollment/load";

export default function AdmissionsPage() {
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

  const adm = data.admissions as Record<string, unknown>;
  const cur = cycle === "fa26" ? data.admissions.fa26 : data.admissions.fa27;
  // Qlik prior column is YoY point-in-time (event date <= today − 1 year).
  const prv = cycle === "fa26"
    ? ((adm.fa25Yoy as typeof data.admissions.fa26) ?? data.admissions.fa25)
    : ((adm.fa26Yoy as typeof data.admissions.fa26) ?? data.admissions.fa26);
  const fa24 = data.admissions.fa24;
  const fa25 = data.admissions.fa25;
  const fa26 = data.admissions.fa26;
  const fa27 = data.admissions.fa27;
  const label = cycle === "fa26" ? "FA26" : "FA27";
  const vs = cycle === "fa26" ? "FA25" : "FA26 (same date last yr)";

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
  ];

  // Counselor activity
  const byAC = (cur.byAC || {}) as Record<
    string,
    {
      created: number;
      submitted: number;
      accepted: number;
      deposited: number;
      denied: number;
      interviewed: number;
    }
  >;
  const acRows = Object.entries(byAC).sort((a, b) => b[1].deposited - a[1].deposited);
  const interviewBars = acRows
    .map(([ac, v]) => ({ label: acShort(ac), value: v.interviewed, tone: "secondary" as const }))
    .filter((r) => r.value > 0);
  const caseloadBars = acRows.map(([ac, v]) => ({
    label: acShort(ac),
    value: v.created,
    tone: "gold" as const,
  }));


  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">{label} Admissions Detail</h1>
          <p className="rpt-sub">
            vs {vs}
          </p>
        </div>
      </div>

      <Section label="Key Metrics" />
      <div className="kpi-strip">
        <Kpi label="Created" cur={cur.created} prv={prv.created} />
        <Kpi label="Submitted" cur={cur.submitted} prv={prv.submitted} />
        <Kpi label="Accepted" cur={cur.accepted} prv={prv.accepted} />
        <Kpi label="Interviews" cur={cur.interviewed} prv={prv.interviewed} />
        <Kpi label="Total Deposits" cur={cur.deposits} prv={prv.deposits} />
        <Kpi label="Accept Rate" cur={cur.acceptRate} prv={prv.acceptRate} format="pct" highlight />
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

      <Section label="Funnel Comparison" />
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

      <Section label="Demographics" />
      <div className="g2" style={{ gap: 16 }}>
        <div className="panel" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <caption
              style={{
                textAlign: "left",
                fontWeight: 600,
                fontSize: 12,
                color: "var(--muted, #666)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "8px 0 4px",
              }}
            >
              Religion
            </caption>
            <thead>
              <tr>
                <th></th>
                <th>Apps</th>
                <th>%</th>
                <th>Accepted</th>
                <th>%</th>
                <th>Deposited</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {(["Catholic", "Other"] as const).map((rel) => {
                const isC = rel === "Catholic";
                const apps = isC ? cur.catholic : cur.created - cur.catholic;
                const acc = isC ? cur.catholicAcc : cur.accepted - cur.catholicAcc;
                const dep = isC ? cur.catholicDep : cur.deposits - cur.catholicDep;
                const pApps = cur.created ? (apps / cur.created) * 100 : null;
                const pAcc = cur.accepted ? (acc / cur.accepted) * 100 : null;
                const pDep = cur.deposits ? (dep / cur.deposits) * 100 : null;
                return (
                  <tr key={rel}>
                    <td style={{ fontWeight: 500 }}>{rel}</td>
                    <td>{fmt(apps)}</td>
                    <td>{pApps != null ? `${pApps.toFixed(1)}%` : "—"}</td>
                    <td>{fmt(acc)}</td>
                    <td>{pAcc != null ? `${pAcc.toFixed(1)}%` : "—"}</td>
                    <td>{fmt(dep)}</td>
                    <td>{pDep != null ? `${pDep.toFixed(1)}%` : "—"}</td>
                  </tr>
                );
              })}
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
                color: "var(--muted, #666)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "8px 0 4px",
              }}
            >
              Gender
            </caption>
            <thead>
              <tr>
                <th></th>
                <th>Apps</th>
                <th>%</th>
                <th>Accepted</th>
                <th>%</th>
                <th>Deposited</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {(["Male", "Female"] as const).map((g) => {
                const isM = g === "Male";
                const apps = isM ? cur.male : cur.female;
                const acc = isM ? cur.maleAcc : cur.femaleAcc;
                const dep = isM ? cur.maleDep : cur.femaleDep;
                const pApps = cur.created ? (apps / cur.created) * 100 : null;
                const pAcc = cur.accepted ? (acc / cur.accepted) * 100 : null;
                const pDep = cur.deposits ? (dep / cur.deposits) * 100 : null;
                return (
                  <tr key={g}>
                    <td style={{ fontWeight: 500 }}>{g}</td>
                    <td>{fmt(apps)}</td>
                    <td>{pApps != null ? `${pApps.toFixed(1)}%` : "—"}</td>
                    <td>{fmt(acc)}</td>
                    <td>{pAcc != null ? `${pAcc.toFixed(1)}%` : "—"}</td>
                    <td>{fmt(dep)}</td>
                    <td>{pDep != null ? `${pDep.toFixed(1)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Section label="Counselor Activity" />
      <BarChart rows={interviewBars} />
      <div className="panel" style={{ overflowX: "auto", marginTop: 16 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Counselor</th>
              <th>Created</th>
              <th>Submitted</th>
              <th>Accepted</th>
              <th>Deposited</th>
              <th>Denied</th>
              <th>Interviewed</th>
            </tr>
          </thead>
          <tbody>
            {acRows.map(([ac, v]) => (
              <tr key={ac || "unassigned"}>
                <td>{acShort(ac)}</td>
                <td>{fmt(v.created)}</td>
                <td>{fmt(v.submitted)}</td>
                <td>{fmt(v.accepted)}</td>
                <td>{fmt(v.deposited)}</td>
                <td>{fmt(v.denied)}</td>
                <td>{fmt(v.interviewed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
