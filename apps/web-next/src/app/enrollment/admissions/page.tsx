"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { deltaPct, fmt, fmt1 } from "@/lib/reports/enrollment/load";

function Delta({ cur, prv }: { cur?: number | null; prv?: number | null }) {
  const d = deltaPct(cur ?? null, prv ?? null);
  if (d == null) return <span>—</span>;
  if (Math.abs(d) < 0.05) return <span className="delta-flat">≈ Flat</span>;
  const up = d > 0;
  return (
    <span className={up ? "delta-up" : "delta-dn"}>
      {up ? "↑ +" : "↓ "}
      {Math.abs(d).toFixed(1)}%
    </span>
  );
}

function Kpi({
  label,
  cur,
  prv,
}: {
  label: string;
  cur?: number | null;
  prv?: number | null;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-val">{fmt(cur)}</div>
      <div className="kpi-delta">
        <Delta cur={cur} prv={prv} />
      </div>
    </div>
  );
}

export default function AdmissionsPage() {
  const { data, loading, error, cycle } = useEnrollment();
  if (loading) return <div className="view active"><p>Loading…</p></div>;
  if (error || !data) return <div className="view active"><p>{error || "No data"}</p></div>;

  const cur = cycle === "fa26" ? data.admissions.fa26 : data.admissions.fa27;
  const prv = cycle === "fa26" ? data.admissions.fa25 : data.admissions.fa26;
  const label = cycle === "fa26" ? "FA26" : "FA27";
  const vs = cycle === "fa26" ? "FA25" : "FA26";

  const rows: [string, number | null | undefined, number | null | undefined][] = [
    ["Applications", cur.created, prv.created],
    ["Accepted", cur.accepted, prv.accepted],
    ["Net deposits", cur.deposits, prv.deposits],
    ["Gross deposits", cur.depositsGross, prv.depositsGross],
    ["Deposit withdrawals", cur.depositsWithdrawn, prv.depositsWithdrawn],
    ["Denied", cur.denied, prv.denied],
    ["Interviewed", cur.interviewed, prv.interviewed],
  ];

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

      <div className="kpi-strip">
        <Kpi label="Net deposits" cur={cur.deposits} prv={prv.deposits} />
        <Kpi label="Accepted" cur={cur.accepted} prv={prv.accepted} />
        <Kpi label="Apps" cur={cur.created} prv={prv.created} />
        <Kpi label="Accept rate %" cur={cur.acceptRate} prv={prv.acceptRate} />
        <Kpi label="Avg GPA" cur={cur.gpa} prv={prv.gpa} />
        <Kpi label="Avg ACT" cur={cur.act} prv={prv.act} />
      </div>

      <div className="sec-row">
        <span className="sec-lbl">Funnel comparison</span>
        <span className="sec-rule" />
      </div>
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>{label}</th>
              <th>{vs}</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, c, p]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{name.includes("rate") || name.includes("GPA") || name.includes("ACT") ? fmt1(c) : fmt(c)}</td>
                <td>{fmt(p)}</td>
                <td>
                  <Delta cur={c} prv={p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sec-row">
        <span className="sec-lbl">Aid (accepted)</span>
        <span className="sec-rule" />
      </div>
      <div className="g3">
        <div className="panel">
          <div className="kl">Avg unfunded aid</div>
          <div className="kn">{fmt(cur.aidAcc?.ua)}</div>
        </div>
        <div className="panel">
          <div className="kl">Avg total scholarship</div>
          <div className="kn">{fmt(cur.aidAcc?.tot)}</div>
        </div>
        <div className="panel">
          <div className="kl">Discount rate (total)</div>
          <div className="kn">{fmt1(cur.aidAcc?.drTot)}%</div>
        </div>
      </div>
    </div>
  );
}
