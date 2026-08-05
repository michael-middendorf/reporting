"use client";

import { useEffect, useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import {
  aggregate,
  dailyTotals,
  scoreAll,
  scoreEventsForDisplay,
  tierFor,
  TIERS,
} from "@/lib/reports/points/scoring";
import "@/styles/points.css";

type RangeKey = "today" | "7" | "14" | "week" | "all" | "custom";

const RANGES: Record<string, { label: string; days?: number; weekToDate?: boolean }> = {
  today: { label: "Today", days: 1 },
  "7": { label: "Last 7 days", days: 7 },
  "14": { label: "Last 14 days", days: 14 },
  week: { label: "This week", weekToDate: true },
  all: { label: "All" },
};

function bounds(key: RangeKey, customStart: string | null, customEnd: string | null) {
  if (key === "custom") {
    return {
      start: customStart ? new Date(customStart + "T00:00:00") : null,
      end: customEnd ? new Date(customEnd + "T00:00:00") : null,
    };
  }
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cfg = RANGES[key];
  if (!cfg || (!cfg.days && !cfg.weekToDate)) return { start: null, end: null };
  if (cfg.weekToDate) {
    const day = (end.getDay() + 6) % 7;
    return { start: new Date(end.getFullYear(), end.getMonth(), end.getDate() - day), end: null };
  }
  return {
    start: new Date(end.getFullYear(), end.getMonth(), end.getDate() - (cfg.days || 1) + 1),
    end: null,
  };
}

async function loadRaw() {
  const get = async (name: string) => {
    const res = await apiFetch(`/api/reports/points/${name}`);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.json();
  };
  const [notes, events, meta] = await Promise.all([
    get("notes.json"),
    get("events.json"),
    get("meta.json"),
  ]);
  const arr = (x: unknown) =>
    Array.isArray(x) ? x : ((x as { records?: unknown[] })?.records || []);
  return { notes: arr(notes), events: arr(events), meta: meta || {} };
}

export default function PointsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>> | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [range, setRange] = useState<RangeKey>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading…");

  useEffect(() => {
    loadRaw()
      .then((raw) => {
        // Points scoring modules are plain JS — cast through unknown.
        const scored = scoreAll({ notes: raw.notes }) as unknown as Array<
          Record<string, unknown>
        >;
        const ev = scoreEventsForDisplay(raw.events) as unknown as Array<
          Record<string, unknown>
        >;
        setRows(scored);
        setEvents(ev);
        setMeta(raw.meta as Record<string, unknown>);
        setStatus(`${raw.notes.length.toLocaleString()} raw notes`);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const model = useMemo(() => {
    const { start, end } = bounds(range, customStart || null, customEnd || null);
    return aggregate(rows || [], { start, end }) as {
      totals: { points?: number; avgPerWeekday?: number; activities?: number };
      owners: Array<{
        name: string;
        points: number;
        avgPerWeekday: number;
        byWeek?: unknown;
      }>;
      rows: unknown[];
    };
  }, [rows, range, customStart, customEnd]);

  const daily = useMemo(
    () => dailyTotals(model.rows) as Array<{ date: string; points: number; weekend?: boolean }>,
    [model.rows],
  );
  const selectedOwner = model.owners.find((o) => o.name === selected);

  return (
    <AccessGate report="points">
      <div className="points-root">
        <ReportTopBar
          title="MA Points"
          nav={[
            { href: "/points", label: "Dashboard" },
            { href: "/points/methodology", label: "Methodology" },
          ]}
        />
        <main className="wrap" style={{ padding: "24px 20px 48px", maxWidth: 1100, margin: "0 auto" }}>
          <h1>Points Dashboard</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0 20px" }}>
            {Object.entries(RANGES).map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                className={range === key ? "active" : ""}
                onClick={() => {
                  setRange(key as RangeKey);
                  setCustomStart("");
                  setCustomEnd("");
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid #c8d6e8",
                  background: range === key ? "#0c233f" : "#fff",
                  color: range === key ? "#fff" : "#0c233f",
                  cursor: "pointer",
                }}
              >
                {cfg.label}
              </button>
            ))}
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              From
              <input
                type="date"
                value={customStart}
                onChange={(e) => {
                  setCustomStart(e.target.value);
                  setRange("custom");
                }}
              />
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              To
              <input
                type="date"
                value={customEnd}
                onChange={(e) => {
                  setCustomEnd(e.target.value);
                  setRange("custom");
                }}
              />
            </label>
            <span style={{ opacity: 0.7 }}>{error || status}</span>
          </div>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
              gap: 12,
              marginBottom: 24,
            }}
          >
            {[
              ["Team points", model.totals?.points],
              ["Weekday avg", model.totals?.avgPerWeekday?.toFixed?.(1)],
              ["Active MAs", model.owners?.length],
              ["Activities", model.totals?.activities],
            ].map(([l, v]) => (
              <div key={String(l)} style={{ background: "#fff", border: "1px solid #d7e0ec", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.65 }}>{l as string}</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{v ?? "—"}</div>
              </div>
            ))}
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2>Leaderboard</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
              {model.owners.map((o: { name: string; points: number; avgPerWeekday: number }) => {
                const tier = tierFor(o.avgPerWeekday || 0);
                return (
                  <button
                    key={o.name}
                    type="button"
                    onClick={() => setSelected(o.name === selected ? null : o.name)}
                    style={{
                      textAlign: "left",
                      background: selected === o.name ? "#f7f1e4" : "#fff",
                      border: "1px solid #d7e0ec",
                      borderRadius: 12,
                      padding: 14,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{o.name}</div>
                    <div style={{ fontSize: 22 }}>{o.points}</div>
                    <div style={{ fontSize: 12, color: tier.color }}>{tier.label}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {selectedOwner && (
            <section style={{ marginBottom: 28, background: "#fff", borderRadius: 12, padding: 16 }}>
              <h2>{selectedOwner.name} — weekly breakdown</h2>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                {JSON.stringify(selectedOwner.byWeek || selectedOwner, null, 2)}
              </pre>
            </section>
          )}

          <section style={{ marginBottom: 28 }}>
            <h2>Daily team points</h2>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 160, background: "#fff", padding: 12, borderRadius: 12 }}>
              {daily.map((d: { date: string; points: number; weekend?: boolean }) => {
                const max = Math.max(1, ...daily.map((x: { points: number }) => x.points));
                const h = (d.points / max) * 130;
                return (
                  <div
                    key={d.date}
                    title={`${d.date}: ${d.points}`}
                    style={{
                      flex: 1,
                      height: Math.max(2, h),
                      background: d.weekend ? "#c5d0df" : "#0c233f",
                      borderRadius: 3,
                    }}
                  />
                );
              })}
            </div>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2>All MAs</h2>
            <table style={{ width: "100%", background: "#fff", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">MA</th>
                  <th align="right">Points</th>
                  <th align="right">Weekday avg</th>
                  <th align="left">Tier</th>
                </tr>
              </thead>
              <tbody>
                {model.owners.map((o: { name: string; points: number; avgPerWeekday: number }) => (
                  <tr key={o.name}>
                    <td>{o.name}</td>
                    <td align="right">{o.points}</td>
                    <td align="right">{(o.avgPerWeekday || 0).toFixed(1)}</td>
                    <td>{tierFor(o.avgPerWeekday || 0).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Events (reference only)</h2>
            <p style={{ opacity: 0.7 }}>{(events || []).length} events in range (not attributed to MAs)</p>
            <ul>
              {((events || []) as { date?: Date; name?: string; points?: number }[])
                .slice(0, 30)
                .map((e, i) => (
                  <li key={i}>
                    {String(e.date || "")} — {e.name || "Event"} ({e.points ?? 0} pts)
                  </li>
                ))}
            </ul>
          </section>

          <section style={{ marginTop: 24 }}>
            <h3>Tiers</h3>
            <ul>
              {TIERS.map((t: { id: string; label: string; min: number }) => (
                <li key={t.id}>
                  {t.label}: ≥ {t.min} avg pts / weekday
                </li>
              ))}
            </ul>
          </section>
          {meta?.generated_at != null && (
            <p style={{ opacity: 0.6, marginTop: 16 }}>Refreshed {String(meta.generated_at)}</p>
          )}
        </main>
      </div>
    </AccessGate>
  );
}
