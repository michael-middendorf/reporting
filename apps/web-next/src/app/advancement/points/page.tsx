"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  aggregate,
  BUCKETS,
  buildCalculationCSV,
  dailyTotals,
  daysOfWeek,
  downloadText,
  rowId,
  scoreAll,
  scoreEventsForDisplay,
  tierFor,
  TIERS,
  trackerBreakdown,
  trackerSpec,
  rowMatchesTracker,
  virtuousContactUrl,
  weekKey,
  weekLabel,
} from "@/lib/reports/points/scoring";
import type { FlagInput, ReviewFlag } from "@/lib/reports/points/flags";
import "@/styles/points.css";

type RangeKey = "week" | "all" | "custom";

const RANGES: Record<string, { label: string }> = {
  week: { label: "This week" },
  all: { label: "All" },
};

const RANGE_KEYS = ["week", "all"] as const;
/** Sentinel for the day picker: mix + tasks cover the whole selected week. */
const WEEK_TOTAL = "total";

function parseDay(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

function thisMonday(): Date {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (today.getDay() + 6) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - day);
}

function sundayOf(monday: Date): Date {
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
}

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
  postedAmount?: number;
  annualized?: boolean;
  label?: string;
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
  teamWeek?: string | null;
  metrics: Array<{ id: string; label: string }>;
};

const money = (n: number | undefined) => `$${Math.round(n || 0).toLocaleString()}`;
const pct = (n: number | undefined) => `${((n || 0) * 100).toFixed(1)}%`;
function formatDay(iso: string) {
  if (!iso) return "";
  return parseDay(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

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
  giftId?: string | number | null;
  source?: string | null;
  conflict?: string | null;
  unmatched?: boolean;
  removed?: boolean;
};

/** Inclusive Monday–Sunday bounds for one week, or the full range. */
function bounds(key: RangeKey, selectedWeek: string | null) {
  if (key === "all") return { start: null, end: null };
  const monday = key === "custom" && selectedWeek ? parseDay(selectedWeek) : thisMonday();
  return { start: monday, end: sundayOf(monday) };
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
  const [selectedWeek, setSelectedWeek] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [pickedWeek, setPickedWeek] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [flags, setFlags] = useState<Record<string, ReviewFlag>>({});
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);

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

  // Shared count/remove overrides (persisted in S3; see /api/reports/points/flags).
  useEffect(() => {
    apiFetch("/api/reports/points/flags")
      .then((r) => (r.ok ? r.json() : { flags: {} }))
      .then((d) => setFlags((d?.flags as Record<string, ReviewFlag>) || {}))
      .catch(() => {});
  }, []);

  const weekOptions = useMemo(() => {
    const keys = new Set<string>([weekKey(thisMonday())]);
    for (const r of rows || []) {
      const raw = r.date;
      const d =
        raw instanceof Date
          ? raw
          : typeof r.day === "string"
            ? parseDay(r.day)
            : null;
      if (d && !Number.isNaN(+d)) keys.add(weekKey(d));
    }
    const sorted = [...keys].sort();
    if (!sorted.length) return [weekKey(thisMonday())];
    const filled: string[] = [];
    const cursor = parseDay(sorted[0]);
    const last = parseDay(sorted[sorted.length - 1]);
    while (cursor <= last) {
      filled.push(weekKey(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return filled.reverse();
  }, [rows]);

  const model = useMemo(() => {
    const { start, end } = bounds(range, selectedWeek || null);
    return aggregate(rows || [], { start, end, flags }) as {
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
  }, [rows, range, selectedWeek, flags]);

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

  const boundWindow = bounds(range, selectedWeek || null);
  const selectWeek = boundWindow.start ? weekKey(boundWindow.start) : "";
  const rangeLabel =
    range === "all"
      ? "All"
      : `Week of ${weekLabel(selectWeek || weekKey(thisMonday()))}`;

  const ownerRows = useMemo(() => {
    if (!selectedOwner) return [] as Row[];
    return (model.rows as Row[])
      .filter((r) => r.owner === selectedOwner.name)
      .sort((a, b) => b.day.localeCompare(a.day) || b.points - a.points);
  }, [model.rows, selectedOwner]);

  const ownerWeeks = selectedOwner?.weekList || [];
  const activeWeek =
    pickedWeek && ownerWeeks.some((w) => w.key === pickedWeek)
      ? pickedWeek
      : ownerWeeks.length
        ? ownerWeeks[ownerWeeks.length - 1].key
        : null;
  const weekDayList = activeWeek ? daysOfWeek(activeWeek) : [];
  const weekRows = useMemo(
    () =>
      ownerRows.filter((r) => {
        if (!activeWeek || !r.day) return false;
        return weekKey(parseDay(r.day)) === activeWeek;
      }),
    [ownerRows, activeWeek],
  );
  const daysWithActivity = useMemo(() => new Set(weekRows.map((r) => r.day)), [weekRows]);
  const showWeekTotal = pickedDay === WEEK_TOTAL;
  const activeDay = showWeekTotal
    ? null
    : pickedDay && weekDayList.includes(pickedDay)
      ? pickedDay
      : [...weekDayList].reverse().find((d) => daysWithActivity.has(d)) || weekDayList[0] || null;
  const scopeRows = useMemo(() => {
    const src = showWeekTotal ? weekRows : ownerRows.filter((r) => r.day === activeDay);
    return [...src].sort((a, b) => b.day.localeCompare(a.day) || b.points - a.points);
  }, [showWeekTotal, weekRows, ownerRows, activeDay]);
  const dayMix = useMemo(() => trackerBreakdown(scopeRows), [scopeRows]);
  const filteredDayRows = useMemo(() => {
    const spec = categoryFilter ? trackerSpec(categoryFilter) : null;
    return spec ? scopeRows.filter((r) => rowMatchesTracker(r, spec)) : scopeRows;
  }, [scopeRows, categoryFilter]);
  const activeCategoryLabel = categoryFilter
    ? dayMix.lines.find((l) => l.id === categoryFilter)?.label
    : null;
  const mixHeading =
    showWeekTotal && activeWeek
      ? `Week of ${weekLabel(activeWeek)}`
      : activeDay
        ? parseDay(activeDay).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
        : "Categories";

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
      setFlagError(`Could not save: ${String(e)}`);
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
      setFlagError(`Could not count: ${String(e)}`);
    } finally {
      setFlagBusy(null);
    }
  }

  function onRemove(r: Row) {
    const id = rowId(r);
    if (!id) return;
    saveFlag({
      noteId: id,
      contactId: r.contactId != null ? String(r.contactId) : null,
      contactName: r.contactName || null,
      owner: r.owner,
      day: r.day,
      type: r.type,
      label: r.label,
      points: r.points,
      status: "removed",
    });
  }

  function onCount(r: Row) {
    const id = rowId(r);
    if (!id) return;
    deleteFlag(id);
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
                      setSelectedWeek(key === "week" ? weekKey(thisMonday()) : "");
                      setPickedWeek(key === "week" ? weekKey(thisMonday()) : null);
                      setPickedDay(null);
                      setCategoryFilter(null);
                    }}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            <div className={`daterange${range === "custom" ? " active" : ""}`}>
              <label>
                Week
                <select
                  aria-label="Week"
                  value={selectWeek}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedWeek(v);
                    setRange(v ? "custom" : "all");
                    setPickedWeek(v || null);
                    setPickedDay(null);
                    setCategoryFilter(null);
                  }}
                >
                  <option value="">All weeks</option>
                  {weekOptions.map((k) => (
                    <option key={k} value={k}>
                      Week of {weekLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <section className="panel callout" style={{ marginBottom: 22 }}>
            <strong>How this is tracked.</strong> Virtuous is the source. Log the activity on the donor’s
            contact, with the right note type, as yourself. Wrong person, wrong type, or no note = not counted.{" "}
            <strong>Gifts:</strong> there must be an MA note on that contact on or before the gift date
            (within 45 days). A thank-you after the gift does not pull it. 100 points also need a donation
            note type plus a posted gift.{" "}
            <a href="/advancement/points/methodology">Full rules</a>
          </section>

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

          {flagError && (
            <p style={{ color: "var(--warn)", fontSize: ".85rem", margin: "0 0 16px" }}>{flagError}</p>
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
                    onClick={() => {
                      setSelected(o.name === selected ? null : o.name);
                      setPickedWeek(null);
                      setPickedDay(null);
                      setCategoryFilter(null);
                    }}
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
                    <tr
                      key={w.key}
                      className={`clickable${w.key === activeWeek ? " selected" : ""}`}
                      onClick={() => {
                        setPickedWeek(w.key);
                        setPickedDay(null);
                        setCategoryFilter(null);
                      }}
                    >
                      <td>Week of {weekLabel(w.key)}</td>
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

              <div className="ma-drill">
                <div>
                  <h3 style={{ marginTop: 0 }}>
                    {mixHeading}
                    <span className="section-hint"> click a category to filter tasks</span>
                  </h3>
                  <div className="tracker">
                    <div className="tracker-head">
                      <span>Category</span>
                      <span>Count</span>
                      <span>Pts</span>
                    </div>
                    {dayMix.lines.map((line) => (
                      <button
                        key={line.id}
                        type="button"
                        className={`tracker-row${line.section ? " section" : ""}${line.indent ? " indent" : ""}${categoryFilter === line.id ? " active" : ""}`}
                        onClick={() => setCategoryFilter((cur) => (cur === line.id ? null : line.id))}
                      >
                        <span>{line.label}</span>
                        <span className="tabular">
                          {line.section ? "" : line.count.toLocaleString()}
                        </span>
                        <span className="tabular">
                          {line.section ? "" : line.points.toLocaleString()}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`tracker-row total${!categoryFilter ? " active" : ""}`}
                      onClick={() => setCategoryFilter(null)}
                    >
                      <span>TOTAL</span>
                      <span className="tabular">{dayMix.totalCount.toLocaleString()}</span>
                      <span className="tabular">{dayMix.totalPoints.toLocaleString()}</span>
                    </button>
                  </div>
                </div>
                <div>
              <h3 style={{ marginTop: 0 }}>
                Day{" "}
                <span className="section-hint">Total for the week, or a date for that day</span>
              </h3>
              <div className="seg day-seg" role="group" aria-label="Day in week">
                <button
                  type="button"
                  className={showWeekTotal ? "active" : ""}
                  aria-pressed={showWeekTotal}
                  onClick={() => setPickedDay(WEEK_TOTAL)}
                >
                  Total
                </button>
                {weekDayList.map((d) => {
                  const dt = parseDay(d);
                  const label = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                  const has = daysWithActivity.has(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`${d === activeDay ? "active" : ""}${has ? "" : " empty"}`}
                      aria-pressed={d === activeDay}
                      onClick={() => setPickedDay(d)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <h3 style={{ marginTop: 18 }}>
                Tasks — {filteredDayRows.length} {filteredDayRows.length === 1 ? "activity" : "activities"}
                {activeCategoryLabel ? ` · ${activeCategoryLabel}` : ""}{" "}
                <span className="section-hint">
                  Wrong note type or note on the wrong contact will not count · Count/Remove changes totals · Open ↗ verifies in Virtuous
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
                      <th>Count / Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDayRows.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ color: "var(--slate-400)" }}>
                          {categoryFilter
                            ? "No activities in this category."
                            : showWeekTotal
                              ? "No activities this week."
                              : "No activities on this day."}
                        </td>
                      </tr>
                    )}
                    {filteredDayRows.map((r, i) => {
                      const key = rowId(r);
                      const removed = !!r.removed;
                      return (
                        <tr
                          key={key || `row-${i}`}
                          style={
                            removed
                              ? { opacity: 0.55 }
                              : r.unmatched
                                ? { background: "#fdf4ef" }
                                : undefined
                          }
                        >
                          <td style={{ whiteSpace: "nowrap" }}>
                            {formatDay(r.day)}
                            {!r.weekday && <span style={{ color: "var(--slate-400)" }}> (wknd)</span>}
                          </td>
                          <td>
                            {r.label}
                            {r.contactName ? <span style={{ color: "var(--slate-400)" }}> · {r.contactName}</span> : null}
                          </td>
                          <td style={{ fontSize: ".78rem", color: "var(--slate-400)" }}>{r.type}</td>
                          <td className="pts">{r.points}</td>
                          <td>
                            {removed ? (
                              <span className="pill warn">removed</span>
                            ) : r.unmatched ? (
                              <span className="pill warn">not counted</span>
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
                            {!key || (r.unmatched && !removed) ? (
                              <span style={{ color: "var(--slate-400)" }}>—</span>
                            ) : removed ? (
                              <button className="mini-btn solid" disabled={flagBusy === key} onClick={() => onCount(r)}>
                                Count
                              </button>
                            ) : (
                              <button className="mini-btn danger" disabled={flagBusy === key} onClick={() => onRemove(r)}>
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
                </div>
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
              Personal Bests{" "}
              <span className="section-hint">each MA’s best week per category · team is the all-time best week</span>
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
                        <em>wk {rec?.week ? weekLabel(rec.week) : "—"}</em>
                      </div>
                    );
                  })}
                </div>
              ))}
              {model.bests?.team && (
                <div className="bestcard team">
                  <div className="name">Team best</div>
                  <div className="best-week">
                    {model.bests.teamWeek ? `Week of ${weekLabel(model.bests.teamWeek)}` : "—"}
                  </div>
                  {(model.bests.metrics || []).map((m) => {
                    const rec = model.bests.team[m.id];
                    const val = m.id === "giftAmount" ? money(rec?.value) : (rec?.value ?? 0).toLocaleString();
                    return (
                      <div key={m.id} className="best-row">
                        <span>{m.label}</span>
                        <b className="tabular">{val}</b>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="section">
            <h2>
              Donations Received <span className="section-hint">new monthly AC is ×12 · an increase counts only the difference ×12</span>
            </h2>
            <div className="panel">
              <p className="footnote" style={{ marginTop: 0, marginBottom: 14 }}>
                A gift is counted only when the MA logged a note on that donor in Virtuous on or before the
                gift date. No note on the contact = the gift is not on this list. 100 points require a
                donation note (‘New Donation or New AC’, ‘Annunciation Circle updated’, or ‘Update recurring
                gift’) and a posted gift. Incorrect logging will not be tracked.
              </p>
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
                          <td>{g.annualized ? "Monthly ×12" : (g.giftType || "—")}</td>
                          <td>{g.project || "—"}</td>
                          <td className="pts tabular">
                            {money(g.amount)}
                            {g.annualized && g.postedAmount != null ? (
                              <span className="section-hint"> ({money(g.postedAmount)}/mo)</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="footnote">
                  No posted Virtuous gifts with an MA note on that donor in this range. Log the note on the
                  contact on or before the gift date or it will not count. One-time gifts use the posted amount.
                  New monthly commitments are counted once as monthly amount × 12.
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
              reference and are not included in any MA’s point total. An MA takes the credit by logging
              <code> Mission Advancement | Event</code> or <code> Mission Advancement | Marketing Event</code>.
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
