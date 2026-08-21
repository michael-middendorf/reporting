"use client";

import { deltaPct, fmt, fmt1 } from "@/lib/reports/enrollment/load";

const ACCEPT_CODE_LABEL: Record<string, string> = {
  AT: "Accept (Full Accept)",
  CA: "Conditional Accept",
  ADMI: "Admin Accept",
  CMRV: "Committee Accept",
  CTA: "Contingent Accept",
};

export function Delta({
  cur,
  prv,
  suffix = "%",
  invert = false,
}: {
  cur?: number | null;
  prv?: number | null;
  suffix?: string;
  invert?: boolean;
}) {
  const d = deltaPct(cur ?? null, prv ?? null);
  if (d == null) return <span className="delta-flat">—</span>;
  if (Math.abs(d) < 0.05) return <span className="delta-flat">≈ Flat</span>;
  const up = d > 0;
  const good = invert ? !up : up;
  return (
    <span className={good ? "delta-up" : "delta-dn"}>
      {up ? "↑ +" : "↓ "}
      {Math.abs(d).toFixed(1)}
      {suffix}
    </span>
  );
}

export function Section({ label }: { label: string }) {
  return (
    <div className="sec-row">
      <span className="sec-lbl">{label}</span>
      <span className="sec-rule" />
    </div>
  );
}

export function Kpi({
  label,
  cur,
  prv,
  format = "int",
  highlight,
  invert,
}: {
  label: string;
  cur?: number | null;
  prv?: number | null;
  format?: "int" | "1" | "pct" | "days";
  highlight?: boolean;
  invert?: boolean;
}) {
  const display =
    format === "1" || format === "pct"
      ? format === "pct"
        ? `${fmt1(cur)}%`
        : fmt1(cur)
      : format === "days"
        ? cur == null
          ? "—"
          : `${Math.round(cur)}d`
        : fmt(cur);
  const prevDisplay =
    prv == null
      ? null
      : format === "1" || format === "pct"
        ? format === "pct"
          ? `${fmt1(prv)}%`
          : fmt1(prv)
        : format === "days"
          ? `${Math.round(prv)}d`
          : fmt(prv);
  return (
    <div className={`kpi${highlight ? " hl" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-val">{display}</div>
      {(prv != null || prevDisplay) && (
        <div className="kpi-delta">
          {prevDisplay != null && <span className="kpi-prv-val">{prevDisplay} </span>}
          <Delta cur={cur} prv={prv} invert={invert} />
        </div>
      )}
    </div>
  );
}

export type BarRow = { label: string; value: number; tone?: "gold" | "secondary" | "muted" | "red" };

export function BarChart({
  title,
  rows,
  max,
}: {
  title?: string;
  rows: BarRow[];
  max?: number;
}) {
  const peak = max ?? Math.max(1, ...rows.map((r) => r.value || 0));
  return (
    <div className="bar-chart">
      {title && <h3>{title}</h3>}
      {rows.map((r) => {
        const pct = Math.max(0, Math.min(100, ((r.value || 0) / peak) * 100));
        const fillClass =
          r.tone === "gold"
            ? "bc-fill gold"
            : r.tone === "secondary"
              ? "bc-fill secondary"
              : r.tone === "red"
                ? "bc-fill red"
                : "bc-fill";
        return (
          <div className="bc-row" key={r.label}>
            <div className="bc-lbl">{r.label}</div>
            <div className="bc-track">
              <div className={fillClass} style={{ width: `${pct}%` }} />
            </div>
            <div className="bc-n">{fmt(r.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function FunnelHistoryCharts({
  terms,
}: {
  terms: { label: string; tone: BarRow["tone"]; stats: { created: number; accepted: number; deposits: number; submitted?: number } }[];
}) {
  const metrics: { key: "created" | "submitted" | "accepted" | "deposits"; title: string }[] = [
    { key: "created", title: "Created / Apps" },
    { key: "submitted", title: "Submitted" },
    { key: "accepted", title: "Accepted" },
    { key: "deposits", title: "Net Deposits" },
  ];
  return (
    <div className="g2" style={{ gap: 16 }}>
      {metrics.map((m) => (
        <BarChart
          key={m.key}
          title={m.title}
          rows={terms.map((t) => ({
            label: t.label,
            value: (t.stats[m.key] as number) ?? t.stats.created,
            tone: t.tone,
          }))}
        />
      ))}
    </div>
  );
}

export function AidTable({
  curLabel,
  prvLabel,
  curAcc,
  prvAcc,
  curDep,
  prvDep,
}: {
  curLabel: string;
  prvLabel: string;
  curAcc?: { ua: number | null; tot: number | null; fund: number | null; drUa: number | null; drTot: number | null };
  prvAcc?: { ua: number | null; tot: number | null; fund: number | null; drUa: number | null; drTot: number | null };
  curDep?: { ua: number | null; tot: number | null; fund: number | null; drUa: number | null; drTot: number | null };
  prvDep?: { ua: number | null; tot: number | null; fund: number | null; drUa: number | null; drTot: number | null };
}) {
  const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
  const pct = (n: number | null | undefined) => (n == null ? "—" : `${fmt1(n)}%`);
  const rows: [string, string, string, string, string][] = [
    ["Avg Unfunded (Accepted)", money(curAcc?.ua), money(prvAcc?.ua), money(curDep?.ua), money(prvDep?.ua)],
    ["Unfunded DR (Accepted)", pct(curAcc?.drUa), pct(prvAcc?.drUa), pct(curDep?.drUa), pct(prvDep?.drUa)],
    ["Avg Funded (Accepted)", money(curAcc?.fund), money(prvAcc?.fund), money(curDep?.fund), money(prvDep?.fund)],
    ["Avg Total Aid (Accepted)", money(curAcc?.tot), money(prvAcc?.tot), money(curDep?.tot), money(prvDep?.tot)],
    ["Total DR (Accepted)", pct(curAcc?.drTot), pct(prvAcc?.drTot), pct(curDep?.drTot), pct(prvDep?.drTot)],
  ];
  return (
    <div className="panel" style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>{curLabel} Acc</th>
            <th>{prvLabel} Acc</th>
            <th>{curLabel} Dep</th>
            <th>{prvLabel} Dep</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AcceptCodesTable({ codes }: { codes?: Record<string, number> }) {
  const entries = Object.entries(codes || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="rpt-sub">No accept codes yet.</p>;
  return (
    <div className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Label</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([code, n]) => (
            <tr key={code}>
              <td>{code}</td>
              <td>{ACCEPT_CODE_LABEL[code] || code}</td>
              <td>{fmt(n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function acShort(ac: string) {
  if (!ac) return "Unassigned";
  const map: Record<string, string> = {
    "abel.cordero": "Abel C",
    "annie.esposito": "Annie E",
    "caroline.g.savoie": "Caroline S",
    "christine.m.gulas": "Christine G",
    "lillian.doyle": "Lillian D",
    "madelyn.r.byers": "Madelyn B",
    "michael.j.mcgrath": "Michael M",
    "joseph.r.pinho": "Joseph P",
    "katherine.n.lyons": "Katherine L",
  };
  return (
    map[ac] ||
    ac
      .split(".")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ")
  );
}
