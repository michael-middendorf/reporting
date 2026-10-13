"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  METHODOLOGY,
  NO_EXPENSES_TEXT,
  SEATS_NOTE,
  TREND_SERIES,
  buildKpis,
  buildTables,
  easternDate,
  expenseLines,
  formatCompact,
  formatDelta,
  formatEasternStamp,
  formatMoney,
  niceMax,
  shortDate,
  trendPoints,
  type GalaResponse,
  type GalaTable,
  type TrendPoint,
  type TrendSeriesKey,
} from "@/lib/reports/gala/shape";
import "@/styles/annunciation.css";
import "@/styles/mgo-analysis.css";
import "@/styles/gala.css";

type LoadError = { error?: string };

function MoneyTable({ table, caption }: { table: GalaTable; caption: string }) {
  return (
    <section aria-label={table.title}>
      <h2 className="gala-h">{table.title}</h2>
      <div className="ac-table-wrap">
        <table className="ac-table gala-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" className="ac-num">Amount</th>
              <th scope="col" className="ac-num">Since last day</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr
                key={r.key}
                className={r.kind === "gross" ? "gala-row-total" : r.kind === "net" ? "gala-row-net" : undefined}
              >
                <td>{r.label}</td>
                <td className="ac-num">{formatMoney(r.amount)}</td>
                <td className="ac-num gala-delta">{formatDelta(r.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Colorblind-safe, distinguishable by dash as well as hue.
const SERIES_STYLE: Record<TrendSeriesKey, { color: string; dash?: string }> = {
  grossAC: { color: "#0D2B5E" },
  grossActual: { color: "#B8892A" },
  netAC: { color: "#2E7D6B", dash: "6 4" },
};

const W = 760;
const H = 300;
const M = { top: 16, right: 24, bottom: 34, left: 64 };

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (!points.length) return <p className="ac-empty">No history yet. The trend starts with the first daily snapshot.</p>;
  const values = points.flatMap((p) => TREND_SERIES.map((s) => p[s.key]));
  const lo = Math.min(0, ...values);
  const hi = niceMax(Math.max(...values));
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * (hi - lo));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const summary = `Daily gala totals from ${points[0].date} to ${points[points.length - 1].date}: gross with commitments, gross received, and net with commitments.`;

  return (
    <div className="gala-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <title>Daily trend</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="#D8E2F0" strokeWidth={1} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#4A6490">
              {formatCompact(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="#4A6490">
              {shortDate(p.date)}
            </text>
          ) : null,
        )}
        {TREND_SERIES.map((s) => {
          const st = SERIES_STYLE[s.key];
          const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(" ");
          return (
            <g key={s.key}>
              {points.length > 1 && (
                <path d={path} fill="none" stroke={st.color} strokeWidth={2.5} strokeDasharray={st.dash} />
              )}
              {points.map((p, i) => (
                <circle key={p.date} cx={x(i)} cy={y(p[s.key])} r={points.length > 20 ? 2 : 3.5} fill={st.color}>
                  <title>{`${s.label}, ${p.date}: ${formatMoney(p[s.key])}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="gala-legend">
        {TREND_SERIES.map((s) => (
          <span key={s.key} style={{ color: SERIES_STYLE[s.key].color }}>
            <span className="gala-swatch" style={SERIES_STYLE[s.key].dash ? { borderTopStyle: "dashed" } : undefined} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function GalaPage() {
  const [data, setData] = useState<GalaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // setState only runs in promise callbacks, so the mount effect does not set state synchronously.
  function fetchData() {
    return apiFetch("/api/gala-data")
      .then(async (r) => {
        const json = (await r.json()) as GalaResponse & LoadError;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void fetchData();
  }, []);

  function load() {
    setLoading(true);
    void fetchData();
  }

  const view = useMemo(() => {
    if (!data) return null;
    const history = data.history ?? [];
    return {
      kpis: buildKpis(data.latest, history),
      tables: buildTables(data.latest, history),
      points: trendPoints(history),
      expenses: expenseLines(data.latest),
    };
  }, [data]);

  const p = data?.latest;

  return (
    <main className="ac-page mga-page gala-page">
      <div className="ac-head">
        <div>
          <h1>Chancellor&apos;s Gala</h1>
          <p className="ac-sub">
            {p ? `As of ${formatEasternStamp(p.asOf)} ET` : "Live gala revenue, commitments, expenses and net"}
            {p?.publishedAt ? ` · Published ${formatEasternStamp(p.publishedAt)} ET` : ""}
          </p>
        </div>
        <button type="button" className="ac-refresh" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="ac-error">
          <p>{error}</p>
        </div>
      )}

      {!error && p && view && (
        <>
          <div className="ac-cards">
            {view.kpis.map((k) => (
              <div className="ac-card" key={k.label}>
                <span className="ac-card-num">{formatMoney(k.value)}</span>
                <span className="ac-card-label">{k.label}</span>
                {k.delta !== null && <span className="gala-delta">{formatDelta(k.delta)} since last day</span>}
              </div>
            ))}
          </div>

          <div className="gala-tables">
            <MoneyTable table={view.tables.combined} caption="Gala totals including commitments" />
            <MoneyTable table={view.tables.actual} caption="Gala totals received" />
          </div>
          {view.tables.previousDate && (
            <p className="ac-sub">Changes compare with the {view.tables.previousDate} snapshot.</p>
          )}

          <h2 className="gala-h">Daily trend</h2>
          <TrendChart points={view.points} />

          <h2 className="gala-h">Expenses by category</h2>
          {view.expenses.length === 0 ? (
            <p className="ac-note">{NO_EXPENSES_TEXT}</p>
          ) : (
            <div className="ac-table-wrap">
              <table className="ac-table gala-table">
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col" className="ac-num">Budgeted</th>
                    <th scope="col" className="ac-num">Committed</th>
                    <th scope="col" className="ac-num">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {view.expenses.map((e) => (
                    <tr key={e.category}>
                      <td>{e.category}</td>
                      <td className="ac-num">{e.budgeted === null ? "" : formatMoney(e.budgeted)}</td>
                      <td className="ac-num">{formatMoney(e.committed)}</td>
                      <td className="ac-num">{formatMoney(e.paid)}</td>
                    </tr>
                  ))}
                  <tr className="gala-row-total">
                    <td>Total</td>
                    <td className="ac-num" />
                    <td className="ac-num">{formatMoney(p.expenses.committed)}</td>
                    <td className="ac-num">{formatMoney(p.expenses.paid)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <h2 className="gala-h">Seats</h2>
          <div className="gala-seats">
            <span><strong>{p.seats.sold.toLocaleString("en-US")}</strong>sold</span>
            <span><strong>{p.seats.comp.toLocaleString("en-US")}</strong>comp</span>
            <span><strong>{p.seats.reserved.toLocaleString("en-US")}</strong>reserved</span>
          </div>
          <p className="ac-sub">{SEATS_NOTE}</p>

          <h2 className="gala-h">Data quality</h2>
          {p.dataQuality.length === 0 ? (
            <p className="ac-sub">No data quality flags.</p>
          ) : (
            <ul className="gala-quality">
              {p.dataQuality.map((q, i) => (
                <li key={`${q.code}-${i}`}>
                  {q.message}
                  {typeof q.count === "number" ? `: ${q.count.toLocaleString("en-US")}` : ""}
                  {typeof q.amount === "number" ? ` (${formatMoney(q.amount)})` : ""}
                </li>
              ))}
            </ul>
          )}

          <footer className="mga-foot">
            <h2>Methodology</h2>
            <p>{METHODOLOGY}</p>
            <p>
              Event date {p.event.eventDate}. Snapshot day {easternDate(p.asOf) || "unknown"}.
            </p>
          </footer>
        </>
      )}
    </main>
  );
}
