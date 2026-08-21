"use client";

import { DEFS } from "@/lib/reports/enrollment/defs";
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

export function InfoTip({
  text,
  flip,
}: {
  text: string;
  flip?: boolean;
}) {
  return (
    <span
      className={`enr-info${flip ? " flip" : ""}`}
      tabIndex={0}
      aria-label={text}
      onClick={(e) => e.stopPropagation()}
    >
      i<span className="enr-tip">{text}</span>
    </span>
  );
}

export function MetricLabel({
  label,
  info,
  flip,
}: {
  label: string;
  info?: string;
  flip?: boolean;
}) {
  return (
    <span className="enr-metric-label">
      {label}
      {info ? <InfoTip text={info} flip={flip} /> : null}
    </span>
  );
}

export function Section({ label, info }: { label: string; info?: string }) {
  return (
    <div className="sec-row">
      <span className="sec-lbl">
        {label}
        {info ? <InfoTip text={info} /> : null}
      </span>
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
  info,
}: {
  label: string;
  cur?: number | null;
  prv?: number | null;
  format?: "int" | "1" | "pct" | "days";
  highlight?: boolean;
  invert?: boolean;
  info?: string;
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
      <div className="kpi-label">
        {label}
        {info ? <InfoTip text={info} flip /> : null}
      </div>
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
  info,
}: {
  title?: string;
  rows: BarRow[];
  max?: number;
  info?: string;
}) {
  const peak = max ?? Math.max(1, ...rows.map((r) => r.value || 0));
  return (
    <div className="bar-chart">
      {title && (
        <h3>
          {title}
          {info ? <InfoTip text={info} /> : null}
        </h3>
      )}
      {rows.map((r) => {
        const pct = Math.max(0, Math.min(100, ((r.value || 0) / peak) * 100));
        const fillClass =
          r.tone === "gold"
            ? "bc-fill gold"
            : r.tone === "secondary"
              ? "bc-fill secondary"
              : r.tone === "red"
                ? "bc-fill red"
                : r.tone === "muted"
                  ? "bc-fill muted"
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
  const metrics: {
    key: "created" | "submitted" | "accepted" | "deposits";
    title: string;
    info: string;
  }[] = [
    { key: "created", title: "Created / Apps", info: DEFS.historyCreated },
    { key: "submitted", title: "Submitted", info: DEFS.historySubmitted },
    { key: "accepted", title: "Accepted", info: DEFS.historyAccepted },
    { key: "deposits", title: "Net Deposits", info: DEFS.historyDeposits },
  ];
  return (
    <div className="g2" style={{ gap: 16 }}>
      {metrics.map((m) => (
        <BarChart
          key={m.key}
          title={m.title}
          info={m.info}
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
  const rows: { label: string; info: string; cells: string[] }[] = [
    { label: "Avg Unfunded", info: DEFS.aidUnfunded, cells: [money(curAcc?.ua), money(prvAcc?.ua), money(curDep?.ua), money(prvDep?.ua)] },
    { label: "Unfunded DR", info: DEFS.aidDr, cells: [pct(curAcc?.drUa), pct(prvAcc?.drUa), pct(curDep?.drUa), pct(prvDep?.drUa)] },
    { label: "Avg Funded", info: DEFS.aidFunded, cells: [money(curAcc?.fund), money(prvAcc?.fund), money(curDep?.fund), money(prvDep?.fund)] },
    { label: "Avg Total Aid", info: DEFS.aidTotal, cells: [money(curAcc?.tot), money(prvAcc?.tot), money(curDep?.tot), money(prvDep?.tot)] },
    { label: "Total DR", info: DEFS.aidDr, cells: [pct(curAcc?.drTot), pct(prvAcc?.drTot), pct(curDep?.drTot), pct(prvDep?.drTot)] },
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
            <tr key={r.label}>
              <td><MetricLabel label={r.label} info={r.info} /></td>
              {r.cells.map((c, i) => (
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
            <th><MetricLabel label="Count" info={DEFS.acceptCodes} /></th>
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

export { acShort } from "@/lib/reports/enrollment/counselors";
