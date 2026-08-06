"use client";

import { useEffect, useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import {
  aggregate,
  BUCKETS,
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

type Owner = {
  name: string;
  points: number;
  avgPerWeekday: number;
  conversations?: number;
  dials?: number;
  convRate?: number;
  count?: number;
  weekdaysWorked?: number;
  buckets?: Record<string, number>;
  bucketPoints?: Record<string, number>;
  weekList?: { key: string; points: number; conversations: number; dials: number }[];
  tier?: { id: string; label: string; color?: string; min: number };
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

function MixBar({ buckets }: { buckets?: Record<string, number> }) {
  const total = Object.values(buckets || {}).reduce((s, n) => s + n, 0) || 1;
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
      {BUCKETS.map((b: { id: string; color: string; label: string }) => {
        const n = buckets?.[b.id] || 0;
        if (!n) return null;
        return (
          <div
            key={b.id}
            title={`${b.label}: ${n}`}
            style={{ width: `${(n / total) * 100}%`, background: b.color }}
          />
        );
      })}
    </div>
  );
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
        const scored = scoreAll({ notes: raw.notes }) as unknown as Array<Record<string, unknown>>;
        const ev = scoreEventsForDisplay(raw.events) as unknown as Array<Record<string, unknown>>;
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
      totals: {
        points?: number;
        count?: number;
        conversations?: number;
        dials?: number;
        convRate?: number;
        weekdays?: number;
      };
      owners: Owner[];
      rows: unknown[];
      buckets: typeof BUCKETS;
    };
  }, [rows, range, customStart, customEnd]);

  const daily = useMemo(
    () => dailyTotals(model.rows) as Array<{ date: string; points: number; weekend?: boolean }>,
    [model.rows],
  );
  const selectedOwner = model.owners.find((o) => o.name === selected);
  const teamMix = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of model.owners) {
      for (const [k, v] of Object.entries(o.bucketPoints || o.buckets || {})) {
        map[k] = (map[k] || 0) + Number(v || 0);
      }
    }
    return map;
  }, [model.owners]);
  const mixPeak = Math.max(1, ...Object.values(teamMix));

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
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 12,
              marginBottom: 24,
            }}
          >
            {[
              ["Total Points", model.totals?.points, `${model.totals?.count ?? 0} activities`],
              [
                "Conversations",
                model.totals?.conversations,
                `Dial rate ${((model.totals?.convRate || 0) * 100).toFixed(0)}%`,
              ],
              ["Weekdays Covered", model.totals?.weekdays, "Across selected range"],
              [
                "Team Avg / Weekday",
                model.totals?.weekdays
                  ? ((model.totals.points || 0) / model.totals.weekdays).toFixed(1)
                  : "—",
                `${model.owners.length} MAs`,
              ],
            ].map(([l, v, sub]) => (
              <div
                key={String(l)}
                style={{ background: "#fff", border: "1px solid #d7e0ec", borderRadius: 10, padding: 12 }}
              >
                <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.65 }}>{l as string}</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{v ?? "—"}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{sub as string}</div>
              </div>
            ))}
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2>Leaderboard</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
              {model.owners.map((o, idx) => {
                const tier = o.tier || tierFor(o.avgPerWeekday || 0);
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
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <strong>
                        #{idx + 1} {o.name}
                      </strong>
                      <span style={{ color: tier.color || "#0c233f", fontSize: 12 }}>{tier.label}</span>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{o.points}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Avg/wkdy {(o.avgPerWeekday || 0).toFixed(1)} · Convos {o.conversations ?? 0} · Rate{" "}
                      {(((o.convRate || 0) as number) * 100).toFixed(0)}%
                    </div>
                    <MixBar buckets={o.buckets} />
                  </button>
                );
              })}
            </div>
          </section>

          {selectedOwner && (
            <section style={{ marginBottom: 28, background: "#fff", borderRadius: 12, padding: 16 }}>
              <h2>{selectedOwner.name} — weekly breakdown</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Week</th>
                    <th align="right">Points</th>
                    <th align="right">Convos</th>
                    <th align="right">Dials</th>
                    <th align="right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedOwner.weekList || []).map((w) => (
                    <tr key={w.key}>
                      <td>{w.key}</td>
                      <td align="right">{w.points}</td>
                      <td align="right">{w.conversations}</td>
                      <td align="right">{w.dials}</td>
                      <td align="right">
                        {w.dials ? `${((w.conversations / w.dials) * 100).toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section style={{ marginBottom: 28 }}>
            <h2>Activity mix (team points)</h2>
            <div style={{ background: "#fff", borderRadius: 12, padding: 16 }}>
              {BUCKETS.map((b: { id: string; label: string; color: string }) => {
                const v = teamMix[b.id] || 0;
                return (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 140, fontSize: 13 }}>{b.label}</div>
                    <div style={{ flex: 1, height: 14, background: "#eef3fa", borderRadius: 4 }}>
                      <div
                        style={{
                          width: `${(v / mixPeak) * 100}%`,
                          height: "100%",
                          background: b.color,
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <div style={{ width: 56, textAlign: "right", fontWeight: 700 }}>{v}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2>Daily team points</h2>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 3,
                height: 160,
                background: "#fff",
                padding: 12,
                borderRadius: 12,
              }}
            >
              {daily.map((d) => {
                const max = Math.max(1, ...daily.map((x) => x.points));
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
            <table style={{ width: "100%", background: "#fff", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th align="left">MA</th>
                  <th align="right">Points</th>
                  <th align="right">Avg/wkdy</th>
                  <th align="left">Tier</th>
                  <th align="right">Convos</th>
                  <th align="right">Dials</th>
                  <th align="right">Rate</th>
                  <th align="right">Activities</th>
                </tr>
              </thead>
              <tbody>
                {model.owners.map((o) => {
                  const tier = o.tier || tierFor(o.avgPerWeekday || 0);
                  return (
                    <tr key={o.name}>
                      <td>{o.name}</td>
                      <td align="right">{o.points}</td>
                      <td align="right">{(o.avgPerWeekday || 0).toFixed(1)}</td>
                      <td style={{ color: tier.color }}>{tier.label}</td>
                      <td align="right">{o.conversations ?? 0}</td>
                      <td align="right">{o.dials ?? 0}</td>
                      <td align="right">{(((o.convRate || 0) as number) * 100).toFixed(0)}%</td>
                      <td align="right">{o.count ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2>Events (reference only)</h2>
            <table style={{ width: "100%", background: "#fff", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th align="left">Event</th>
                  <th align="left">Date</th>
                  <th align="left">Rule</th>
                  <th align="right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {((events || []) as { date?: Date | string; name?: string; points?: number; rule?: string; label?: string }[])
                  .slice(0, 50)
                  .map((e, i) => (
                    <tr key={i}>
                      <td>{e.name || "Event"}</td>
                      <td>{String(e.date || "").slice(0, 10)}</td>
                      <td>{e.rule || e.label || "—"}</td>
                      <td align="right">{e.points ?? 0}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Tiers</h3>
            <ul>
              {TIERS.map((t) => (
                <li key={t.id} style={{ color: t.color }}>
                  {t.label}: ≥ {t.min} avg pts / weekday
                  {t.payout != null ? ` · $${t.payout.toLocaleString()}` : ""}
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
