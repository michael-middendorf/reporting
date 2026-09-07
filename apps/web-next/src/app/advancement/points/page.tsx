"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  aggregate,
  BUCKETS,
  buildCalculationCSV,
  CONFLICTS,
  dailyTotals,
  downloadText,
  scoreAll,
  scoreEventsForDisplay,
  tierFor,
  TIERS,
  virtuousContactUrl,
} from "@/lib/reports/points/scoring";
import type { FlagInput, ReviewFlag } from "@/lib/reports/points/flags";
import "@/styles/points.css";

type RangeKey = "today" | "7" | "14" | "week" | "all" | "custom";

const RANGES: Record<string, { label: string; days?: number; weekToDate?: boolean }> = {
  "7": { label: "Last 7 days", days: 7 },
  "14": { label: "Last 14 days", days: 14 },
  today: { label: "Today", days: 1 },
  week: { label: "This week", weekToDate: true },
  all: { label: "All" },
};

const RANGE_KEYS = ["7", "14", "today", "week", "all"] as const;

type Owner = {
  name: string;
  short?: string;
  points: number;
  avgPerWeekday: number;
  conversations?: number;
  dials?: number;
  convRate?: number;
  count?: number;
  gifts?: number;
  giftAmount?: number;
  weekdaysWorked?: number;
  buckets?: Record<string, number>;
  bucketPoints?: Record<string, number>;
  weekList?: {
    key: string;
    points: number;
    conversations: number;
    dials: number;
    gifts?: number;
    giftAmount?: number;
  }[];
  tier?: { id: string; label: string; color?: string; min: number };
};

type GiftRow = {
  owner: string;
  contactName?: string;
  day?: string;
  giftType?: string;
  project?: string;
  amount?: number;
};

type WeekRec = {
  conversations?: number;
  dials?: number;
  points?: number;
  gifts?: number;
  giftAmount?: number;
};

type WeekGridRow = {
  key: string;
  label: string;
  byOwner: Record<string, WeekRec>;
  totals: WeekRec & { convRate?: number; avgPoints?: number };
};

type BestRec = { value: number; week: string | null };
type Bests = {
  owners: Array<{ name: string; short?: string } & Record<string, BestRec | string | undefined>>;
  team: Record<string, BestRec>;
  metrics: Array<{ id: string; label: string }>;
};

const money = (n: number | undefined) => `$${Math.round(n || 0).toLocaleString()}`;
const pct = (n: number | undefined) => `${((n || 0) * 100).toFixed(1)}%`;

/** One scored activity row (from points.js scoreNote / aggregate model.rows). */
type Row = {
  owner: string;
  type: string;
  label: string;
  bucket: string;
  points: number;
  day: string;
  weekday?: boolean;
  contactId?: string | number | null;
  contactName?: string | null;
  noteId?: string | number | null;
  source?: string | null;
  conflict?: string | null;
  unmatched?: boolean;
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
  const [notes, events, gifts, meta] = await Promise.all([
    get("notes.json"),
    get("events.json"),
    get("gifts.json").catch(() => []),
    get("meta.json"),
  ]);
  const arr = (x: unknown) =>
    Array.isArray(x) ? x : ((x as { records?: unknown[] })?.records || []);
  return { notes: arr(notes), events: arr(events), gifts: arr(gifts), meta: meta || {} };
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
  const [flags, setFlags] = useState<Record<string, ReviewFlag>>({});
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [showQueue, setShowQueue] = useState(true);

  useEffect(() => {
    loadRaw()
      .then((raw) => {
        const scored = scoreAll({ notes: raw.notes, gifts: raw.gifts }) as unknown as Array<Record<string, unknown>>;
        const ev = scoreEventsForDisplay(raw.events) as unknown as Array<Record<string, unknown>>;
        setRows(scored);
        setEvents(ev);
        setMeta(raw.meta as Record<string, unknown>);
        setStatus(`${raw.notes.length.toLocaleString()} raw notes · ${raw.gifts.length.toLocaleString()} gifts`);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Shared review-flag queue (persisted in S3; see /api/reports/points/flags).
  useEffect(() => {
    apiFetch("/api/reports/points/flags")
      .then((r) => (r.ok ? r.json() : { flags: {} }))
      .then((d) => setFlags((d?.flags as Record<string, ReviewFlag>) || {}))
      .catch(() => {});
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
        gifts?: number;
        giftAmount?: number;
      };
      owners: Owner[];
      tableOwners: Owner[];
      rows: unknown[];
      buckets: typeof BUCKETS;
      gifts: GiftRow[];
      weekGrid: WeekGridRow[];
      bests: Bests;
    };
  }, [rows, range, customStart, customEnd]);

  const daily = useMemo(
    () => dailyTotals(model.rows) as Array<{ day?: string; date: string | Date; points: number }>,
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
  const mixPeak = Math.max(
    1,
    ...Object.entries(teamMix)
      .filter(([k]) => k !== "donation")
      .map(([, v]) => v),
  );

  const rangeLabel =
    range === "custom"
      ? `${customStart || "…"} to ${customEnd || "…"}`
      : RANGES[range]?.label || "All";

  const flagList = useMemo(
    () =>
      Object.values(flags).sort((a, b) =>
        a.status === b.status
          ? (b.flaggedAt || "").localeCompare(a.flaggedAt || "")
          : a.status === "open"
            ? -1
            : 1,
      ),
    [flags],
  );
  const openFlagCount = flagList.filter((f) => f.status === "open").length;

  const ownerRows = useMemo(() => {
    if (!selectedOwner) return [] as Row[];
    return (model.rows as Row[])
      .filter((r) => r.owner === selectedOwner.name)
      .sort((a, b) => b.day.localeCompare(a.day) || b.points - a.points);
  }, [model.rows, selectedOwner]);

  async function saveFlag(input: FlagInput) {
    setFlagBusy(String(input.noteId));
    setFlagError(null);
    try {
      const res = await apiFetch("/api/reports/points/flags", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      const flag = data.flag as ReviewFlag;
      setFlags((f) => ({ ...f, [String(flag.noteId)]: flag }));
    } catch (e) {
      setFlagError(`Could not save flag: ${String(e)}`);
    } finally {
      setFlagBusy(null);
    }
  }

  async function deleteFlag(noteId: string) {
    setFlagBusy(noteId);
    setFlagError(null);
    try {
      const res = await apiFetch(
        `/api/reports/points/flags?noteId=${encodeURIComponent(noteId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || res.statusText);
      }
      setFlags((f) => {
        const n = { ...f };
        delete n[noteId];
        return n;
      });
    } catch (e) {
      setFlagError(`Could not remove flag: ${String(e)}`);
    } finally {
      setFlagBusy(null);
    }
  }

  function onFlag(r: Row) {
    const reason = window.prompt(
      `Flag this task for review?\n\n${r.owner} · ${r.day} · ${r.label} (${r.points} pts)\n\nReason / what to verify:`,
      "",
    );
    if (reason == null) return; // cancelled
    saveFlag({
      noteId: String(r.noteId),
      contactId: r.contactId != null ? String(r.contactId) : null,
      contactName: r.contactName || null,
      owner: r.owner,
      day: r.day,
      type: r.type,
      label: r.label,
      points: r.points,
      reason: reason.trim(),
    });
  }

  function exportCalculation() {
    const now = new Date();
    const generatedOn = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const csv = buildCalculationCSV(model, { meta, rangeLabel, generatedOn, flags });
    const safeRange = rangeLabel.replace(/[^\w.-]+/g, "-");
    downloadText(`ma-points-calculation_${safeRange}_${generatedOn}.csv`, csv);
  }

  return (
    <div className="points-root">
        <main className="wrap dash">
          <header className="page-head">
            <h1>Points Dashboard</h1>
            <div className="page-head-actions">
              <span className="page-head-meta">{error || status}</span>
              <button
                type="button"
                onClick={exportCalculation}
                disabled={!rows}
                title="Download a spreadsheet of every task and how its points were calculated, with a link to each record in Virtuous"
                className="mini-btn solid"
              >
                Export calculation report
              </button>
            </div>
          </header>
          <div className="controls">
            <div className="seg" role="group" aria-label="Preset range">
              {RANGE_KEYS.map((key) => {
                const cfg = RANGES[key];
                const active = range === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={active ? "active" : undefined}
                    aria-pressed={active}
                    onClick={() => {
                      setRange(key);
                      setCustomStart("");
                      setCustomEnd("");
                    }}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            <div className={`daterange${range === "custom" ? " active" : ""}`}>
              <label>
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
              <span className="daterange-sep" aria-hidden="true">
                –
              </span>
              <label>
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
            </div>
          </div>

          <section className="kpis">
            {[
              ["Total Points", (model.totals?.points ?? 0).toLocaleString(), `${model.totals?.count ?? 0} scored activities`],
              [
                "Conversations",
                String(model.totals?.conversations ?? 0),
                `${pct(model.totals?.convRate)} of dials`,
              ],
              [
                "Gifts Raised",
                money(model.totals?.giftAmount),
                `${model.totals?.gifts ?? 0} posted gifts · ${model.totals?.weekdays ?? 0} weekdays`,
              ],
              [
                "Team Avg / Weekday",
                model.totals?.weekdays
                  ? Math.round((model.totals.points || 0) / model.totals.weekdays).toLocaleString()
                  : "—",
                "points per weekday",
              ],
            ].map(([l, v, sub]) => (
              <div key={String(l)} className="kpi">
                <div className="label">{l as string}</div>
                <div className="value tabular">{v}</div>
                <div className="foot">{sub as string}</div>
              </div>
            ))}
          </section>

          {flagList.length > 0 && (
            <section
              className="panel"
              style={{ marginBottom: 24, borderLeft: "3px solid var(--warn)" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>
                  Review queue{" "}
                  <span style={{ fontFamily: "var(--sans)", fontWeight: 400, fontSize: ".9rem", color: "var(--slate-400)" }}>
                    {openFlagCount} open · {flagList.length - openFlagCount} resolved
                  </span>
                </h2>
                <button type="button" className="mini-btn" onClick={() => setShowQueue((s) => !s)}>
                  {showQueue ? "Hide" : "Show"}
                </button>
              </div>
              {flagError && <p style={{ color: "var(--warn)", fontSize: ".85rem", margin: "8px 0 0" }}>{flagError}</p>}
              {showQueue && (
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table className="grid audit">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>MA</th>
                        <th>Date</th>
                        <th>Activity</th>
                        <th style={{ textAlign: "right" }}>Pts</th>
                        <th>Reason</th>
                        <th>Flagged by</th>
                        <th>Virtuous</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flagList.map((f) => (
                        <tr key={f.noteId}>
                          <td>
                            {f.status === "open" ? (
                              <span className="pill warn">Open</span>
                            ) : (
                              <span className="pill">Resolved</span>
                            )}
                          </td>
                          <td>{f.owner || "—"}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{f.day || "—"}</td>
                          <td>{f.label || f.type || "—"}</td>
                          <td className="pts">{f.points ?? "—"}</td>
                          <td style={{ maxWidth: 260, whiteSpace: "normal" }}>{f.reason || "—"}</td>
                          <td style={{ fontSize: ".78rem", color: "var(--slate-400)" }}>{f.flaggedBy}</td>
                          <td>
                            {f.contactId ? (
                              <a href={virtuousContactUrl(f.contactId)} target="_blank" rel="noopener noreferrer">
                                Open ↗
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {f.status === "open" ? (
                              <button
                                className="mini-btn"
                                disabled={flagBusy === f.noteId}
                                onClick={() => saveFlag({ noteId: f.noteId, status: "resolved" })}
                              >
                                Resolve
                              </button>
                            ) : (
                              <button
                                className="mini-btn"
                                disabled={flagBusy === f.noteId}
                                onClick={() => saveFlag({ noteId: f.noteId, status: "open" })}
                              >
                                Reopen
                              </button>
                            )}{" "}
                            <button
                              className="mini-btn danger"
                              disabled={flagBusy === f.noteId}
                              onClick={() => {
                                if (window.confirm("Remove this flag?")) deleteFlag(f.noteId);
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="section">
            <h2>
              Leaderboard <span className="section-hint">click an MA to see their weekly breakdown</span>
            </h2>
            <div className="cards">
              {model.owners.map((o, idx) => {
                const tier = o.tier || tierFor(o.avgPerWeekday || 0);
                return (
                  <button
                    key={o.name}
                    type="button"
                    className={`macard${selected === o.name ? " selected" : ""}`}
                    onClick={() => setSelected(o.name === selected ? null : o.name)}
                  >
                    <div className="rank">{idx + 1}</div>
                    <div className="name">{o.name}</div>
                    <div className="pts tabular">
                      {o.points.toLocaleString()} <small>pts</small>
                    </div>
                    <span className="tier" style={{ background: tier.color }}>
                      {tier.label}
                    </span>
                    <div className="statrow">
                      <div className="s">
                        Avg/weekday
                        <b className="tabular">{Math.round(o.avgPerWeekday || 0).toLocaleString()}</b>
                      </div>
                      <div className="s">
                        Conversations
                        <b className="tabular">{o.conversations ?? 0}</b>
                      </div>
                      <div className="s">
                        Raised
                        <b className="tabular">{money(o.giftAmount)}</b>
                      </div>
                    </div>
                    <MixBar buckets={o.bucketPoints || o.buckets} />
                  </button>
                );
              })}
            </div>
          </section>

          {selectedOwner && (
            <section className="section panel">
              <h2>
                {selectedOwner.name}{" "}
                <span className="section-hint">
                  {selectedOwner.tier?.label} · {Math.round(selectedOwner.avgPerWeekday || 0)} pts/weekday · {money(selectedOwner.giftAmount)} raised
                </span>
              </h2>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Points</th>
                    <th>Convos</th>
                    <th>Dials</th>
                    <th>Rate</th>
                    <th>Gifts</th>
                    <th>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedOwner.weekList || []).map((w) => (
                    <tr key={w.key}>
                      <td>Week of {w.key.slice(5)}</td>
                      <td className="pts tabular">{w.points.toLocaleString()}</td>
                      <td className="tabular">{w.conversations}</td>
                      <td className="tabular">{w.dials}</td>
                      <td className="tabular">{w.dials ? pct(w.conversations / w.dials) : "—"}</td>
                      <td className="tabular">{w.gifts ?? 0}</td>
                      <td className="pts tabular">{money(w.giftAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ marginTop: 22 }}>
                Tasks — {ownerRows.length} activities{" "}
                <span style={{ fontFamily: "var(--sans)", fontWeight: 400, fontSize: ".85rem", color: "var(--slate-400)" }}>
                  “Open ↗” verifies the record in Virtuous · ⚑ flags a task for review
                </span>
              </h3>
              <div style={{ overflow: "auto", maxHeight: 520, border: "1px solid var(--line)", borderRadius: 10 }}>
                <table className="grid audit">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Activity</th>
                      <th>Type</th>
                      <th style={{ textAlign: "right" }}>Pts</th>
                      <th>Status</th>
                      <th>Virtuous</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownerRows.map((r, i) => {
                      const noteKey = r.noteId != null ? String(r.noteId) : null;
                      const flag = noteKey ? flags[noteKey] : undefined;
                      const conflict = r.conflict
                        ? (CONFLICTS as Record<string, { title: string; resolved: string }>)[r.conflict]
                        : null;
                      return (
                        <tr key={noteKey || `row-${i}`} style={r.unmatched ? { background: "#fdf4ef" } : undefined}>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {r.day}
                            {!r.weekday && <span style={{ color: "var(--slate-400)" }}> (wknd)</span>}
                          </td>
                          <td>
                            {r.label}
                            {r.contactName ? <span style={{ color: "var(--slate-400)" }}> · {r.contactName}</span> : null}
                          </td>
                          <td style={{ fontSize: ".78rem", color: "var(--slate-400)" }}>{r.type}</td>
                          <td className="pts">{r.points}</td>
                          <td>
                            {r.unmatched ? (
                              <span className="pill warn">NOT COUNTED</span>
                            ) : conflict ? (
                              <span className="pill assumed" title={`${conflict.title} → scored as ${conflict.resolved}`}>
                                conflict
                              </span>
                            ) : (
                              <span className="pill">counted</span>
                            )}
                          </td>
                          <td>
                            {r.contactId ? (
                              <a href={virtuousContactUrl(r.contactId)} target="_blank" rel="noopener noreferrer">
                                Open ↗
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {!noteKey ? (
                              <span style={{ color: "var(--slate-400)" }}>—</span>
                            ) : !flag ? (
                              <button className="mini-btn" disabled={flagBusy === noteKey} onClick={() => onFlag(r)}>
                                ⚑ Flag
                              </button>
                            ) : flag.status === "open" ? (
                              <>
                                <span className="pill warn" title={flag.reason}>
                                  ⚑ Flagged
                                </span>{" "}
                                <button
                                  className="mini-btn"
                                  disabled={flagBusy === noteKey}
                                  onClick={() => saveFlag({ noteId: noteKey, status: "resolved" })}
                                >
                                  Resolve
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="pill" title={flag.reason}>
                                  ✓ Resolved
                                </span>{" "}
                                <button
                                  className="mini-btn danger"
                                  disabled={flagBusy === noteKey}
                                  onClick={() => deleteFlag(noteKey)}
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="section">
            <h2>
              Weekly Totals <span className="section-hint">same layout as the tracker — conversations, dials, rate, points, gifts, dollars</span>
            </h2>
            <div className="panel week-stack">
              {!(model.weekGrid || []).length && <p className="footnote">No weekly activity in range.</p>}
              {[...(model.weekGrid || [])].reverse().map((g) => {
                const mas = model.tableOwners || [];
                const cell = (w: WeekRec | undefined, id: string) => {
                  const rec = w || {};
                  if (id === "rate") return rec.dials ? pct((rec.conversations || 0) / rec.dials) : "—";
                  if (id === "giftAmount") return money(rec.giftAmount);
                  if (id === "points") return (rec.points || 0).toLocaleString();
                  return String((rec as Record<string, number>)[id] || 0);
                };
                const metrics: Array<[string, string]> = [
                  ["conversations", "Conversations"],
                  ["dials", "Dials"],
                  ["rate", "%"],
                  ["points", "Points"],
                  ["gifts", "Gifts"],
                  ["giftAmount", "Raised"],
                ];
                return (
                  <div key={g.key} className="week-block">
                    <h3>Week of {g.label}</h3>
                    <div className="week-scroll">
                      <table className="grid weekgrid">
                        <thead>
                          <tr>
                            <th className="metric" />
                            {mas.map((o) => (
                              <th key={o.name} className="ma">{o.short || o.name}</th>
                            ))}
                            <th className="ma">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.map(([id, label]) => (
                            <tr key={id}>
                              <th className="metric">{label}</th>
                              {mas.map((o) => (
                                <td key={o.name} className="tabular">{cell(g.byOwner[o.name], id)}</td>
                              ))}
                              <td className="tabular pts">
                                {id === "rate"
                                  ? pct(g.totals.convRate)
                                  : id === "giftAmount"
                                    ? money(g.totals.giftAmount)
                                    : id === "points"
                                      ? <>{(g.totals.points || 0).toLocaleString()} <span className="muted">avg {Math.round(g.totals.avgPoints || 0)}</span></>
                                      : String((g.totals as Record<string, number>)[id] || 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="section">
            <h2>
              Personal Bests <span className="section-hint">best week in each category — not necessarily the same week</span>
            </h2>
            <div className="bests">
              {(model.bests?.owners || []).map((o) => (
                <div key={String(o.name)} className="bestcard">
                  <div className="name">{String(o.short || o.name)}</div>
                  {(model.bests?.metrics || []).map((m) => {
                    const rec = o[m.id] as BestRec | undefined;
                    const val = m.id === "giftAmount" ? money(rec?.value) : (rec?.value ?? 0).toLocaleString();
                    return (
                      <div key={m.id} className="best-row">
                        <span>{m.label}</span>
                        <b className="tabular">{val}</b>
                        <em>wk {rec?.week ? rec.week.slice(5) : "—"}</em>
                      </div>
                    );
                  })}
                </div>
              ))}
              {model.bests?.team && (
                <div className="bestcard team">
                  <div className="name">Team best</div>
                  {(model.bests.metrics || []).map((m) => {
                    const rec = model.bests.team[m.id];
                    const val = m.id === "giftAmount" ? money(rec?.value) : Math.round(rec?.value || 0).toLocaleString();
                    return (
                      <div key={m.id} className="best-row">
                        <span>{m.label}</span>
                        <b className="tabular">{val}</b>
                        <em>wk {rec?.week ? rec.week.slice(5) : "—"}</em>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="section">
            <h2>
              Donations Received <span className="section-hint">Virtuous gifts attributed to each MA, plus grand total</span>
            </h2>
            <div className="panel">
              <table className="grid" style={{ marginBottom: 18 }}>
                <thead>
                  <tr>
                    <th>MA</th>
                    <th>Gifts</th>
                    <th>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {(model.tableOwners || []).map((o) => (
                    <tr key={o.name}>
                      <td>{o.name}</td>
                      <td className="tabular">{o.gifts ?? 0}</td>
                      <td className="pts tabular">{money(o.giftAmount)}</td>
                    </tr>
                  ))}
                  <tr className="grand">
                    <td>Grand total</td>
                    <td className="tabular">{model.totals?.gifts ?? 0}</td>
                    <td className="pts tabular">{money(model.totals?.giftAmount)}</td>
                  </tr>
                </tbody>
              </table>
              {(model.gifts || []).length > 0 ? (
                <table className="grid">
                  <thead>
                    <tr>
                      <th>MA</th>
                      <th>Donor</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Designation</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...model.gifts]
                      .sort((a, b) => (b.day || "").localeCompare(a.day || ""))
                      .map((g, i) => (
                        <tr key={i}>
                          <td>{g.owner}</td>
                          <td>{g.contactName || "—"}</td>
                          <td className="tabular">{g.day || "—"}</td>
                          <td>{g.giftType || "—"}</td>
                          <td>{g.project || "—"}</td>
                          <td className="pts tabular">{money(g.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="footnote">
                  No posted Virtuous gifts attributed to an MA in this range. Gifts and dollars come from
                  posted gifts with amount greater than 0, attributed by an MA donation note on the same
                  contact dated on or before the gift.
                </p>
              )}
            </div>
          </section>

          <section className="section two-col">
            <div>
              <h2>Daily Team Points</h2>
              <div className="panel">
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 3,
                    height: 160,
                  }}
                >
                  {daily.map((d) => {
                    const max = Math.max(1, ...daily.map((x) => x.points));
                    const h = (d.points / max) * 130;
                    const dt = d.date instanceof Date ? d.date : new Date(d.date);
                    const weekend = dt.getDay() === 0 || dt.getDay() === 6;
                    return (
                      <div
                        key={d.day || String(d.date)}
                        title={`${d.day || d.date}: ${d.points}`}
                        style={{
                          flex: 1,
                          height: Math.max(2, h),
                          background: weekend ? "#c5d0df" : "#0c233f",
                          borderRadius: 3,
                        }}
                      />
                    );
                  })}
                </div>
                <p className="footnote">Weekday bars are solid; weekend bars are muted. Tiers are evaluated on average points per weekday.</p>
              </div>
            </div>
            <div>
              <h2>Activity Mix</h2>
              <div className="panel">
                {BUCKETS.filter((b: { id: string }) => b.id !== "donation").map((b: { id: string; label: string; color: string }) => {
                  const v = teamMix[b.id] || 0;
                  if (!v) return null;
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
                <p className="footnote">Points contributed by each activity type across the team.</p>
              </div>
            </div>
          </section>

          <section className="section">
            <h2>All Mission Advancement — Detail</h2>
            <div className="panel">
              <table className="grid">
              <thead>
                <tr>
                  <th>Mission Advancement</th>
                  <th>Points</th>
                  <th>Avg/wkdy</th>
                  <th>Tier</th>
                  <th>Convos</th>
                  <th>Dials</th>
                  <th>Rate</th>
                  <th>Gifts</th>
                  <th>Raised</th>
                </tr>
              </thead>
              <tbody>
                {model.owners.map((o) => {
                  const tier = o.tier || tierFor(o.avgPerWeekday || 0);
                  return (
                    <tr key={o.name}>
                      <td>{o.name}</td>
                      <td className="pts tabular">{o.points.toLocaleString()}</td>
                      <td className="tabular">{Math.round(o.avgPerWeekday || 0)}</td>
                      <td><span className="tier" style={{ background: tier.color }}>{tier.label.split(" ")[0]}</span></td>
                      <td className="tabular">{o.conversations ?? 0}</td>
                      <td className="tabular">{o.dials ?? 0}</td>
                      <td className="tabular">{pct(o.convRate)}</td>
                      <td className="tabular">{o.gifts ?? 0}</td>
                      <td className="pts tabular">{money(o.giftAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </section>

          <section className="section">
            <h2>
              Events <span className="section-hint">reference only — not attributed to an MA</span>
            </h2>
            <div className="panel">
            <table className="grid">
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
            <p className="footnote">
              Virtuous events carry no MA owner, so “Ave Near You” (300) and Marketing (75) events are shown here for
              reference and are not included in any MA’s point total. An MA can take the credit by logging
              <code> Mission Advancement | Event</code> once that note type exists.
            </p>
            </div>
          </section>

          <section className="section">
            <h3>Tiers</h3>
            <div className="legend">
              {TIERS.map((t) => (
                <span key={t.id} className="k">
                  <span className="dot" style={{ background: t.color }} />
                  {t.label} — {t.min ? `≥${t.min}` : "<100"} pts/wkdy
                  {t.payout != null ? ` · $${t.payout.toLocaleString()}` : ""}
                </span>
              ))}
            </div>
          </section>
          {meta?.generated_at != null && (
            <p style={{ opacity: 0.6, marginTop: 16 }}>Refreshed {String(meta.generated_at)}</p>
          )}
        </main>
    </div>
  );
}
