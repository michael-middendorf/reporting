"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { PointsSubnav } from "@/components/PointsSubnav";
import {
  aggregate,
  BUCKETS,
  buildCalculationCSV,
  daysOfWeek,
  downloadText,
  rowId,
  isTaskListRow,
  scoreAll,
  assignedNotesFromFlags,
  scoreTrackedEvents,
  eventPointsForHours,
  tierFor,
  TIERS,
  trackerBreakdown,
  trackerSpec,
  rowMatchesTracker,
  evalStartDate,
  SETTINGS,
  virtuousContactUrl,
  virtuousGiftUrl,
  noteTypeForIncoming,
  weekKey,
  weekLabel,
  MA_ROSTER,
  TRACKED_EVENT_TYPES,
  RETIRED_TRACKED_EVENT_TYPES,
  EVENT_POINTS_PER_HOUR,
} from "@/lib/reports/points/scoring";
import type { FlagInput, ReviewFlag } from "@/lib/reports/points/flags";
import type { TrackedEvent } from "@/lib/reports/points/tracked-events";
import "@/styles/points.css";
import { InsightsPanel } from "./insights-panel";
import { buildInsights } from "@/lib/reports/points/insights.js";

type RangeKey = "week" | "all" | "custom" | "dates";

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

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function formatRangeDate(iso: string): string {
  return parseDay(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  tier?: { id: string; label: string; meaning?: string; color?: string; min: number };
};

type GiftRow = {
  owner: string;
  contactName?: string;
  contactId?: string | number | null;
  day?: string;
  giftType?: string;
  project?: string;
  amount?: number;
  postedAmount?: number;
  annualized?: boolean;
  acIncrease?: boolean;
  priorMonthly?: number | null;
  newMonthly?: number | null;
  label?: string;
  giftId?: string | number | null;
  touchCount?: number;
  touchLabel?: string;
  needsReview?: boolean;
  mgoAssigned?: boolean;
  removed?: boolean;
  bucket?: string;
  kind?: string;
  kindLabel?: string;
  schedule?: string | null;
  lastGiftDay?: string | null;
  lastGiftSchedule?: string | null;
  lastNoteDay?: string | null;
  lastNoteType?: string | null;
  galaSite?: boolean;
  inVirtuous?: boolean;
  emailMatch?: string | null;
  assist?: boolean;
  giftAmount?: number | null;
};

type IncomingOwner = {
  name: string;
  noteType?: string;
  noteLabel?: string;
  noteDay?: string;
  daysAfterNote?: number;
  noteId?: string | number | null;
};

type PossibleGiftRow = GiftRow & {
  noteType?: string;
  noteLabel?: string;
  noteDay?: string;
  daysAfterNote?: number;
  inRaised?: boolean;
  kind?: string;
  kindLabel?: string;
  owners?: IncomingOwner[];
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
  owners: Array<{ name: string; short?: string; bestWeek?: string | null; totalPoints?: number } & Record<string, BestRec | string | number | undefined>>;
  team: Record<string, BestRec>;
  teamWeek?: string | null;
  teamTotalPoints?: number;
  metrics: Array<{ id: string; label: string }>;
};

const money = (n: number | undefined) => `$${Math.round(n || 0).toLocaleString()}`;
const monthlyRate = (n: number | null | undefined) => {
  const v = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(v)) return "";
  return Number.isInteger(v) ? `$${v.toLocaleString()}` : `$${v.toFixed(2)}`;
};
const pct = (n: number | undefined) => `${((n || 0) * 100).toFixed(1)}%`;
function isoToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function eventTypeLabel(id: string) {
  const types = [...TRACKED_EVENT_TYPES, ...RETIRED_TRACKED_EVENT_TYPES];
  return types.find((t) => t.id === id || t.type === id)?.label || id;
}

function formatDay(iso: string) {
  if (!iso) return "";
  const d = parseDay(iso);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function RaisedTrendChart({
  weeks,
  incomingAmount,
}: {
  weeks: Array<{ key: string; label: string; amount: number }>;
  incomingAmount: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!weeks.length) return null;
  const W = 720;
  const H = 92;
  const pad = { t: 8, r: 8, b: 22, l: 44 };
  const max = Math.max(0, ...weeks.map((w) => w.amount));
  const yMax = max > 0 ? max : 1;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (weeks.length === 1 ? innerW / 2 : (i / (weeks.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / yMax) * innerH;
  const d = weeks
    .map((w, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(w.amount).toFixed(1)}`)
    .join(" ");
  const raised = weeks.reduce((s, w) => s + w.amount, 0);
  const labelEvery = weeks.length > 8 ? Math.ceil(weeks.length / 6) : 1;
  const active = hover != null ? weeks[hover] : null;
  return (
    <div className="raised-trend-compact">
      <div className="raised-trend-meta">
        <span className="raised-trend-label">Raised</span>
        <strong className="tabular">{money(raised)}</strong>
        {incomingAmount > 0 ? (
          <span className="section-hint">
            · {money(incomingAmount)} waiting in Incoming
          </span>
        ) : null}
        {active ? (
          <span className="section-hint">
            · {active.label} {money(active.amount)}
          </span>
        ) : null}
      </div>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Raised amount each week. Only assigned gifts."
        onMouseLeave={() => setHover(null)}
      >
        <path d={d} fill="none" className="trend-line" />
        {weeks.map((w, i) => {
          const slot = weeks.length === 1 ? innerW : innerW / Math.max(1, weeks.length - 1);
          return (
            <g key={w.key}>
              <rect
                x={x(i) - slot / 2}
                y={pad.t}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              <circle cx={x(i)} cy={y(w.amount)} r={hover === i ? 4 : 2.5} className="trend-dot" />
              {i % labelEvery === 0 || i === weeks.length - 1 ? (
                <text x={x(i)} y={H - 4} textAnchor="middle" className="trend-tick">
                  {w.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Eastern clock as "Last refresh: 12:18 PM, 09/09/2026". */
function formatLastRefresh(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  const et = { timeZone: "America/New_York" as const };
  const time = d.toLocaleTimeString("en-US", { ...et, hour: "numeric", minute: "2-digit", hour12: true });
  const date = d.toLocaleDateString("en-US", { ...et, month: "2-digit", day: "2-digit", year: "numeric" });
  return `${time}, ${date}`;
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
  text?: string | null;
  giftId?: string | number | null;
  giftAmount?: number | null;
  amount?: number | null;
  source?: string | null;
  conflict?: string | null;
  unmatched?: boolean;
  removed?: boolean;
  needsReview?: boolean;
  mgoAssigned?: boolean;
  hours?: number;
  tracked?: boolean;
};

/** Inclusive Monday–Sunday bounds for one week, All from the eval start, or a chosen calendar range. */
function bounds(key: RangeKey, selectedWeek: string | null, dateFrom = "", dateTo = "") {
  if (key === "dates") {
    let from = dateFrom ? parseDay(dateFrom) : evalStartDate();
    let to = dateTo ? parseDay(dateTo) : null;
    if (to && from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    return { start: from, end: to ? endOfDay(to) : null };
  }
  if (key === "all") return { start: evalStartDate(), end: null as Date | null };
  const monday = key === "custom" && selectedWeek ? parseDay(selectedWeek) : thisMonday();
  return { start: monday, end: sundayOf(monday) };
}

async function loadRaw() {
  const get = async (name: string) => {
    const res = await apiFetch(`/api/reports/points/${name}`);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.json();
  };
  const [notes, gifts, meta, profiles, portfolios] = await Promise.all([
    get("notes.json"),
    get("gifts.json").catch(() => []),
    get("meta.json"),
    get("profiles.json").catch(() => []),
    get("portfolios.json").catch(() => ({})),
  ]);
  const arr = (x: unknown) =>
    Array.isArray(x) ? x : ((x as { records?: unknown[] })?.records || []);
  const portfolioOwners = portfolios && typeof portfolios === "object" && !Array.isArray(portfolios)
    ? portfolios as Record<string, string>
    : {};
  return { notes: arr(notes), gifts: arr(gifts), profiles: arr(profiles), portfolios: portfolioOwners, meta: meta || {} };
}

export default function PointsPage() {
  return (
    <Suspense fallback={<div className="points-root"><main className="wrap dash" /></div>}>
      <PointsPageInner />
    </Suspense>
  );
}

function PointsPageInner() {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab = rawTab === "incoming" ? "incoming" : rawTab === "events" ? "events" : rawTab === "insights" ? "insights" : "points";
  const [raw, setRaw] = useState<{ notes: unknown[]; gifts: unknown[]; profiles: unknown[]; portfolios: Record<string, string>; meta: Record<string, unknown> } | null>(null);
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [range, setRange] = useState<RangeKey>("all");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [pickedWeek, setPickedWeek] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [giftOwner, setGiftOwner] = useState<string | null>(null);
  const [possibleOwner, setPossibleOwner] = useState<string>("all");
  const [meName, setMeName] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ flagId: string; message: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, ReviewFlag>>({});
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);
  const [trackedEvents, setTrackedEvents] = useState<TrackedEvent[]>([]);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventForm, setEventForm] = useState({
    owner: "",
    day: isoToday(),
    eventType: TRACKED_EVENT_TYPES[0]?.id || "event",
    name: "",
    projectType: "",
    hours: "1",
  });

  useEffect(() => {
    loadRaw()
      .then((loaded) => {
        setRaw({
          notes: loaded.notes,
          gifts: loaded.gifts,
          profiles: loaded.profiles,
          portfolios: loaded.portfolios,
          meta: loaded.meta as Record<string, unknown>,
        });
        setMeta(loaded.meta as Record<string, unknown>);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!raw) return;
    const extra = assignedNotesFromFlags(flags) as unknown[];
    const scored = scoreAll({ notes: [...raw.notes, ...extra], gifts: raw.gifts, flags, portfolios: raw.portfolios }) as unknown as Array<Record<string, unknown>>;
    const eventRows = scoreTrackedEvents(trackedEvents) as unknown as Array<Record<string, unknown>>;
    setRows([...scored, ...eventRows]);
  }, [raw, flags, trackedEvents]);

  // Shared count/remove overrides (persisted in S3; see /api/reports/points/flags).
  useEffect(() => {
    apiFetch("/api/reports/points/flags")
      .then((r) => (r.ok ? r.json() : { flags: {} }))
      .then((d) => setFlags((d?.flags as Record<string, ReviewFlag>) || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch("/api/reports/points/tracked-events")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setTrackedEvents(Array.isArray(d?.events) ? (d.events as TrackedEvent[]) : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch("/api/reports/points/me")
      .then((r) => (r.ok ? r.json() : { maName: null }))
      .then((d: { maName?: string | null }) => {
        const name = typeof d?.maName === "string" ? d.maName : "";
        if (!name) return;
        setMeName(name);
        setPossibleOwner((cur) => (cur === "all" ? name : cur));
        setEventForm((f) => (f.owner ? f : { ...f, owner: name }));
      })
      .catch(() => {});
  }, []);

  const weekOptions = useMemo(() => {
    const floorKey = SETTINGS.evalStart;
    const keys = new Set<string>([weekKey(thisMonday()), floorKey]);
    for (const r of rows || []) {
      const raw = r.date;
      const d =
        raw instanceof Date
          ? raw
          : typeof r.day === "string"
            ? parseDay(r.day)
            : null;
      if (d && !Number.isNaN(+d)) {
        const k = weekKey(d);
        if (k >= floorKey) keys.add(k);
      }
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
    const { start, end } = bounds(range, selectedWeek || null, dateFrom, dateTo);
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
      possibleGifts: PossibleGiftRow[];
      reviewGifts: GiftRow[];
      weekGrid: WeekGridRow[];
      bests: Bests;
    };
  }, [rows, range, selectedWeek, dateFrom, dateTo, flags]);

  const insights = useMemo(() => {
    return buildInsights({
      gifts: model.gifts || [],
      notes: model.rows || [],
      profiles: raw?.profiles || [],
    });
  }, [model.gifts, model.rows, raw]);

  const selectedOwner = model.owners.find((o) => o.name === selected);

  const boundWindow = bounds(range, selectedWeek || null, dateFrom, dateTo);
  const selectWeek = range === "custom" || range === "week"
    ? (boundWindow.start ? weekKey(boundWindow.start) : "")
    : "";
  const orderedFrom = dateFrom && dateTo && dateFrom > dateTo ? dateTo : dateFrom;
  const orderedTo = dateFrom && dateTo && dateFrom > dateTo ? dateFrom : dateTo;
  const rangeLabel =
    range === "dates"
      ? orderedFrom && orderedTo
        ? `${formatRangeDate(orderedFrom)} to ${formatRangeDate(orderedTo)}`
        : orderedFrom
          ? `from ${formatRangeDate(orderedFrom)}`
          : `through ${formatRangeDate(orderedTo)}`
      : range === "all"
        ? `All (from week of ${weekLabel(SETTINGS.evalStart)})`
        : `Week of ${weekLabel(selectWeek || weekKey(thisMonday()))}`;

  const ownerRows = useMemo(() => {
    if (!selectedOwner) return [] as Row[];
    return (model.rows as Row[])
      .filter((r) => r.owner === selectedOwner.name && isTaskListRow(r))
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
        ? formatDay(activeDay)
        : "Categories";
  const listedGifts = useMemo(() => {
    if (!giftOwner) return [] as GiftRow[];
    return (model.rows as GiftRow[])
      .filter((r) => !r.needsReview && !r.removed)
      .filter((r) => (r.bucket === "donation" && (r.amount || 0) > 0) || (r.assist && r.giftId != null))
      .filter((g) => giftOwner === "all" || g.owner === giftOwner)
      .sort((a, b) => (b.day || "").localeCompare(a.day || ""));
  }, [model.rows, giftOwner]);
  const giftTouches = useMemo(() => {
    const map = new Map<string, { count: number; amount: number; touches: number }>();
    for (const g of model.gifts || []) {
      const key = g.touchLabel || "No contact logged";
      const rec = map.get(key) || { count: 0, amount: 0, touches: 0 };
      rec.count += 1;
      rec.amount += g.amount || 0;
      rec.touches += g.touchCount || 0;
      map.set(key, rec);
    }
    return [...map.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [model.gifts]);
  const followUps = useMemo(() => {
    const nameByContact = new Map<string, string>();
    for (const r of rows || []) {
      if (r.contactId != null && r.contactName) nameByContact.set(String(r.contactId), String(r.contactName));
    }
    return (rows || [])
      .filter((r) => String(r.type || "").trim().toLowerCase() === "mission advancement | verbal gift commitment")
      .map((r) => {
        const day = String(r.day || "");
        const due = day ? (() => {
          const d = parseDay(day);
          d.setDate(d.getDate() + 2);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })() : "";
        const text = String(r.text || "").replace(/\s+/g, " ").trim();
        return {
          id: String(r.noteId || r.day),
          owner: String(r.owner || ""),
          contact: String(r.contactName || (r.contactId != null ? nameByContact.get(String(r.contactId)) : "") || ""),
          contactId: r.contactId,
          day,
          due,
          label: "Verbal commitment",
          text: text.length > 90 ? `${text.slice(0, 87)}…` : text,
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [rows]);
  function incomingOwners(g: GiftRow & Partial<PossibleGiftRow>): IncomingOwner[] {
    if (g.owners?.length) return g.owners;
    return g.owner ? [{ name: g.owner, noteType: g.noteType, noteLabel: g.noteLabel, noteDay: g.noteDay, daysAfterNote: g.daysAfterNote }] : [];
  }
  const todoQueue = useMemo(() => {
    return (
      range === "all"
        ? model
        : (aggregate(rows || [], { start: evalStartDate(), end: null, flags }) as typeof model)
    );
  }, [range, model, rows, flags]);
  const listedPossible = useMemo(() => {
    return [...(todoQueue.possibleGifts || [])]
      .filter((g) => possibleOwner === "all" || incomingOwners(g).some((o) => o.name === possibleOwner))
      .sort((a, b) => (a.day || "").localeCompare(b.day || "") || (b.amount || 0) - (a.amount || 0));
  }, [todoQueue.possibleGifts, possibleOwner]);
  const todoReviewGifts = useMemo(() => {
    return [...(todoQueue.reviewGifts || [])]
      .filter((g) => possibleOwner === "all" || g.owner === possibleOwner)
      .sort((a, b) => (a.day || "").localeCompare(b.day || "") || (b.amount || 0) - (a.amount || 0));
  }, [todoQueue.reviewGifts, possibleOwner]);
  const listedIncoming = useMemo(() => {
    return [...listedPossible, ...todoReviewGifts]
      .sort((a, b) => (a.day || "").localeCompare(b.day || "") || (b.amount || 0) - (a.amount || 0));
  }, [listedPossible, todoReviewGifts]);
  const todoAllCount = (todoQueue.possibleGifts || []).length + (todoQueue.reviewGifts || []).length;
  const todoAllAmount =
    (todoQueue.possibleGifts || []).reduce((s, g) => s + (g.amount || 0), 0) +
    (todoQueue.reviewGifts || []).reduce((s, g) => s + (g.amount || 0), 0);
  const todoCount = listedPossible.length + todoReviewGifts.length;
  const todoAmount =
    listedPossible.reduce((s, g) => s + (g.amount || 0), 0) +
    todoReviewGifts.reduce((s, g) => s + (g.amount || 0), 0);
  const possibleCounts = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const g of todoQueue.possibleGifts || []) {
      const names = new Set(incomingOwners(g).map((o) => o.name).filter(Boolean));
      for (const name of names) {
        const rec = map.get(name) || { count: 0, amount: 0 };
        rec.count += 1;
        rec.amount += g.amount || 0;
        map.set(name, rec);
      }
    }
    return map;
  }, [todoQueue.possibleGifts]);

  const weeklyRaised = useMemo(() => {
    const full = (
      range === "all"
        ? model
        : aggregate(rows || [], { start: evalStartDate(), end: null, flags })
    ) as { weekGrid?: WeekGridRow[] };
    const byKey = new Map<string, number>();
    for (const g of full.weekGrid || []) {
      byKey.set(g.key, g.totals.giftAmount || 0);
    }
    return [...weekOptions].sort().map((key) => ({
      key,
      label: weekLabel(key),
      amount: byKey.get(key) || 0,
    }));
  }, [range, model, rows, flags, weekOptions]);

  const listedTracked = useMemo(() => {
    const { start, end } = bounds(range, selectedWeek || null, dateFrom, dateTo);
    const includePast = tab === "events" && range === "all";
    return trackedEvents
      .filter((e) => {
        if (!e.day) return false;
        const d = parseDay(e.day);
        if (Number.isNaN(+d)) return false;
        if (!includePast && start && d < start) return false;
        if (end && d > end) return false;
        return true;
      })
      .sort((a, b) => (b.day || "").localeCompare(a.day || ""));
  }, [trackedEvents, range, selectedWeek, dateFrom, dateTo, tab]);

  function clearUndoTimer() {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  }

  function showUndo(flagId: string, message: string) {
    clearUndoTimer();
    setUndo({ flagId, message });
    undoTimer.current = setTimeout(() => setUndo(null), 5 * 60 * 1000);
  }

  useEffect(() => () => clearUndoTimer(), []);

  function giftFlagId(g: GiftRow) {
    return g.giftId != null && g.giftId !== "" ? `gift:${g.giftId}` : null;
  }

  function giftRemoveId(g: GiftRow) {
    return g.giftId != null && g.giftId !== "" ? `gift-remove:${g.giftId}` : null;
  }

  async function removeCountedGift(g: GiftRow) {
    const id = giftRemoveId(g);
    if (!id) return;
    const ok = await saveFlag({
      noteId: id,
      contactId: g.contactId != null ? String(g.contactId) : null,
      contactName: g.contactName || null,
      owner: g.owner,
      day: g.day || null,
      type: "Gift",
      label: g.label || "Gift",
      points: 100,
      status: "removed",
      reason: "Removed from gifts",
    });
    if (ok) showUndo(id, `Removed ${g.contactName || "this gift"} from Raised.`);
  }

  async function saveFlag(input: FlagInput): Promise<boolean> {
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
      return true;
    } catch (e) {
      setFlagError(`Could not save: ${String(e)}`);
      return false;
    } finally {
      setFlagBusy(null);
    }
  }

  async function deleteFlag(noteId: string): Promise<boolean> {
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
      return true;
    } catch (e) {
      setFlagError(`Could not save: ${String(e)}`);
      return false;
    } finally {
      setFlagBusy(null);
    }
  }

  async function undoLast() {
    if (!undo) return;
    const id = undo.flagId;
    clearUndoTimer();
    setUndo(null);
    const ok = await deleteFlag(id);
    if (!ok) setUndo({ flagId: id, message: undo.message });
  }

  function onRemove(r: Row) {
    if (r.mgoAssigned || r.needsReview) return;
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
    if (r.mgoAssigned || r.needsReview) return;
    const id = rowId(r);
    if (!id) return;
    deleteFlag(id);
  }

  async function assignIncoming(g: GiftRow & { kind?: string }, owner: string, assist: boolean, opts?: { skipConfirm?: boolean }) {
    if (g.giftId == null || g.giftId === "" || g.contactId == null || !g.day) return;
    const kindLabel = assist ? "Gift Assist" : (noteTypeForIncoming(g.kind) || "gift note");
    const effect = assist
      ? "It scores 100 Assist points and $0 Raised. It does not add a note in Virtuous."
      : "It scores 100 points and counts in Raised. It does not add a note in Virtuous.";
    if (!opts?.skipConfirm && !window.confirm(`Assign this ${kindLabel} to ${owner}? ${effect}`)) return;
    setAssignBusy(`${g.giftId}:${owner}`);
    setFlagError(null);
    try {
      const res = await apiFetch("/api/reports/points/assign-gift", {
        method: "POST",
        body: JSON.stringify({
          giftId: g.giftId,
          contactId: g.contactId,
          contactName: g.contactName,
          owner,
          day: g.day,
          amount: g.amount,
          kind: g.kind,
          assist,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      if (data.flag?.noteId) {
        setFlags((f) => ({ ...f, [data.flag.noteId]: data.flag as ReviewFlag }));
        const who = g.contactName || "this donor";
        showUndo(
          String(data.flag.noteId),
          assist
            ? `Assist for ${who} assigned to ${owner}. 100 pts, $0 Raised.`
            : `Assigned ${money(g.amount)} from ${who} to ${owner}. 100 pts + Raised.`,
        );
      }
    } catch (e) {
      setFlagError(`Could not assign gift: ${String(e)}`);
    } finally {
      setAssignBusy(null);
    }
  }

  async function dismissIncoming(g: GiftRow) {
    if (g.giftId == null || g.giftId === "") return;
    const id = `gift:${g.giftId}`;
    const ok = await saveFlag({
      noteId: id,
      contactId: g.contactId != null ? String(g.contactId) : null,
      contactName: g.contactName || null,
      owner: g.owner,
      day: g.day,
      type: g.kindLabel || g.giftType || null,
      label: "Incoming gift dismissed",
      points: 0,
      status: "removed",
      reason: "Does not qualify",
    });
    if (ok) showUndo(id, `Removed ${g.contactName || "this gift"}.`);
  }

  async function assignMgoGift(g: GiftRow) {
    const id = giftFlagId(g);
    if (!id || !g.owner) return;
    const previous = flags[id];
    const input: FlagInput = {
      noteId: id,
      contactId: g.contactId != null ? String(g.contactId) : null,
      contactName: g.contactName || null,
      owner: g.owner,
      day: g.day || null,
      type: g.giftType || "Gift",
      label: g.label || "Donation received",
      points: 0,
      reason: "mgo-review",
      status: "assigned",
    };
    const optimistic: ReviewFlag = {
      ...input,
      reason: "mgo-review",
      status: "assigned",
      flaggedBy: "",
      flaggedAt: new Date().toISOString(),
    };
    setFlagBusy(id);
    setFlagError(null);
    setFlags((f) => ({ ...f, [id]: optimistic }));
    try {
      const res = await apiFetch("/api/reports/points/flags", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      const flag = data.flag as ReviewFlag;
      setFlags((f) => ({ ...f, [String(flag.noteId)]: flag }));
      showUndo(id, `Assigned ${money(g.amount)} from ${g.contactName || "this donor"} to ${g.owner}.`);
    } catch (e) {
      setFlags((f) => {
        const next = { ...f };
        if (previous) next[id] = previous;
        else delete next[id];
        return next;
      });
      setFlagError(`Could not save: ${String(e)}`);
    } finally {
      setFlagBusy(null);
    }
  }

  const formHours = Number(eventForm.hours);
  const formPoints = eventPointsForHours(formHours);

  async function addTrackedEvent() {
    const hours = Number(eventForm.hours);
    if (!eventForm.owner) {
      setFlagError("Choose an MA for the event.");
      return;
    }
    if (!eventForm.day) {
      setFlagError("Choose the event date.");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setFlagError("Hours must be greater than 0.");
      return;
    }
    setEventBusy(true);
    setFlagError(null);
    try {
      const res = await apiFetch("/api/reports/points/tracked-events", {
        method: "POST",
        body: JSON.stringify({
          owner: eventForm.owner,
          day: eventForm.day,
          eventType: eventForm.eventType,
          name: eventForm.name.trim(),
          projectType: eventForm.eventType === "projects" ? eventForm.projectType.trim() : "",
          hours,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      const saved = data.event as TrackedEvent;
      setTrackedEvents((cur) => {
        const next = cur.filter((e) => e.id !== saved.id);
        next.push(saved);
        next.sort((a, b) => String(b.day).localeCompare(String(a.day)) || String(b.createdAt).localeCompare(String(a.createdAt)));
        return next;
      });
      setEventForm((f) => ({ ...f, name: "", projectType: "", hours: "1" }));
    } catch (e) {
      setFlagError(`Could not add event: ${String(e)}`);
    } finally {
      setEventBusy(false);
    }
  }

  async function deleteTrackedEvent(id: string) {
    if (!window.confirm("Remove this event from the dashboard? It will no longer count toward points.")) return;
    setEventBusy(true);
    setFlagError(null);
    const previous = trackedEvents;
    setTrackedEvents((cur) => cur.filter((e) => e.id !== id));
    try {
      const res = await apiFetch(
        `/api/reports/points/tracked-events?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || res.statusText);
      }
    } catch (e) {
      setTrackedEvents(previous);
      setFlagError(`Could not remove event: ${String(e)}`);
    } finally {
      setEventBusy(false);
    }
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
          <div className="points-toolbar">
            <PointsSubnav count={todoAllCount} />
            {tab === "points" || tab === "events" || tab === "insights" ? (
              <>
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
                      setDateFrom("");
                      setDateTo("");
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
            <div className={`daterange${range === "custom" || range === "dates" ? " active" : ""}`}>
              <label>
                Week
                <select
                  aria-label="Week"
                  value={selectWeek}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedWeek(v);
                    setDateFrom("");
                    setDateTo("");
                    setRange(v ? "custom" : "all");
                    setPickedWeek(v || null);
                    setPickedDay(null);
                    setCategoryFilter(null);
                  }}
                >
                  <option value="">{range === "dates" ? "Custom dates" : `All weeks (from ${weekLabel(SETTINGS.evalStart)})`}</option>
                  {weekOptions.map((k) => (
                    <option key={k} value={k}>
                      Week of {weekLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="daterange-sep" aria-hidden="true">|</span>
              <label>
                From
                <input
                  type="date"
                  aria-label="From date"
                  value={dateFrom}
                  min={SETTINGS.evalStart}
                  max={dateTo || undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDateFrom(v);
                    setSelectedWeek("");
                    setPickedWeek(null);
                    setPickedDay(null);
                    setCategoryFilter(null);
                    setRange(v || dateTo ? "dates" : "all");
                  }}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  aria-label="To date"
                  value={dateTo}
                  min={dateFrom || SETTINGS.evalStart}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDateTo(v);
                    setSelectedWeek("");
                    setPickedWeek(null);
                    setPickedDay(null);
                    setCategoryFilter(null);
                    setRange(dateFrom || v ? "dates" : "all");
                  }}
                />
              </label>
            </div>
              </>
            ) : null}
            <span className="points-refresh">
              {error ? error : meta?.generated_at != null
                ? formatLastRefresh(String(meta.generated_at))
                : "pending"}
            </span>
            {tab === "points" ? (
              <button
                type="button"
                onClick={exportCalculation}
                disabled={!rows}
                title="Download a spreadsheet of every task and gift, with links to the contact and posted gift in Virtuous"
                className="mini-btn solid"
              >
                Export
              </button>
            ) : null}
          </div>

          {tab === "incoming" ? (
          <section className={`todo${todoAllCount === 0 ? " is-clear" : ""}`} id="todo" aria-labelledby="todo-heading">
            <div className="todo-head">
              <div>
                <h2 id="todo-heading">Possible gifts</h2>
              </div>
              <div className="todo-stat" aria-label={`${todoAllCount} gifts waiting`}>
                <strong className="tabular">{todoAllCount}</strong>
                <span>{todoAllCount === 1 ? "gift waiting" : "gifts waiting"}</span>
                {todoCount > 0 ? <span className="todo-stat-amt tabular">{money(todoAmount)}</span> : null}
              </div>
            </div>
            <div className="todo-body">
              {flagError ? <p className="todo-error">{flagError}</p> : null}
              {todoAllCount > 0 ? (
                <div className="seg todo-filter" role="group" aria-label="Filter to-do by MA">
                  <button
                    type="button"
                    className={possibleOwner === "all" ? "active" : undefined}
                    onClick={() => setPossibleOwner("all")}
                  >
                    All · {todoAllCount}
                  </button>
                  {(model.tableOwners || []).map((o) => {
                    const n = (possibleCounts.get(o.name)?.count ?? 0) + (todoQueue.reviewGifts || []).filter((g) => g.owner === o.name).length;
                    return (
                      <button
                        key={o.name}
                        type="button"
                        className={possibleOwner === o.name ? "active" : undefined}
                        onClick={() => setPossibleOwner(o.name)}
                      >
                        {o.short || o.name} · {n}
                        {meName === o.name ? " · you" : ""}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {todoAllCount === 0 ? (
                <p className="todo-empty">None waiting.</p>
              ) : todoCount === 0 ? (
                <p className="todo-empty">None for this MA.</p>
              ) : (
                <>
                  <div className="todo-table-wrap">
                    <table className="grid todo-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Donor</th>
                          <th>Gift</th>
                          <th>Last gift</th>
                          <th>Last note</th>
                          <th>Spoke with</th>
                          <th>Amount</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                  {listedIncoming.map((g, i) => {
                    const owners = incomingOwners(g);
                    const review = !!g.needsReview;
                    const flagId = giftFlagId(g);
                    const busy = review
                      ? flagBusy === flagId
                      : (assignBusy != null || flagBusy === (g.giftId != null ? `gift:${g.giftId}` : null));
                    return (
                      <tr key={g.giftId != null && g.giftId !== "" ? String(g.giftId) : `todo-${i}`}>
                        <td className="nowrap">{g.day ? formatDay(g.day) : "—"}</td>
                        <td>
                          {g.contactName || "Unknown donor"}
                          {virtuousGiftUrl(g.contactId) ? (
                            <>
                              {" "}
                              <a className="todo-link" href={virtuousGiftUrl(g.contactId)} target="_blank" rel="noopener noreferrer">
                                ↗
                              </a>
                            </>
                          ) : null}
                        </td>
                        <td>
                          {g.schedule || (g.annualized ? "Recurring" : "One-time")}
                          {g.kind === "gala" || g.galaSite ? (
                            <span className="todo-muted">
                              {" "}
                              · {g.galaSite && !g.inVirtuous ? "Gala site" : "Gala"}
                            </span>
                          ) : null}
                          {g.galaSite && g.emailMatch && g.emailMatch !== "unique" ? (
                            <span className="todo-muted"> · no unique email match</span>
                          ) : null}
                        </td>
                        <td className="nowrap">
                          {g.lastGiftDay ? (
                            <>
                              {formatDay(g.lastGiftDay)}
                              {g.lastGiftSchedule ? <span className="todo-muted"> · {g.lastGiftSchedule}</span> : null}
                            </>
                          ) : "—"}
                        </td>
                        <td>
                          {g.lastNoteType || g.lastNoteDay ? (
                            <>
                              {g.lastNoteType || "Note"}
                              {g.lastNoteDay ? <span className="todo-muted"> · {formatDay(g.lastNoteDay)}</span> : null}
                            </>
                          ) : "—"}
                        </td>
                        <td>
                          {owners.map((o, idx) => (
                            <div key={`${o.name}-${idx}`}>
                              {o.name.split(" ")[0]}
                              {o.daysAfterNote != null ? (
                                <span className="todo-muted">
                                  {" "}· {o.daysAfterNote}d
                                  {o.daysAfterNote > (SETTINGS.giftNoteDaysBefore ?? 90) ? " · review" : ""}
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </td>
                        <td className="pts tabular nowrap">{money(g.amount)}</td>
                        <td>
                          <div className="todo-actions">
                            {review ? (
                              flagId && g.owner ? (
                                <button
                                  type="button"
                                  className="mini-btn solid"
                                  disabled={busy}
                                  onClick={() => assignMgoGift(g)}
                                >
                                  {busy ? "…" : g.owner.split(" ")[0]}
                                </button>
                              ) : null
                            ) : (
                              <>
                                {owners.map((o) => (
                                  <button
                                    key={`a-${o.name}`}
                                    type="button"
                                    className="mini-btn solid"
                                    disabled={busy}
                                    onClick={() => assignIncoming(g, o.name, false, { skipConfirm: true })}
                                  >
                                    {assignBusy === `${g.giftId}:${o.name}` ? "…" : o.name.split(" ")[0]}
                                  </button>
                                ))}
                                {owners.map((o) => (
                                  <button
                                    key={`s-${o.name}`}
                                    type="button"
                                    className="mini-btn"
                                    disabled={busy}
                                    title={`Assist ${o.name.split(" ")[0]} · 100 pts, $0`}
                                    onClick={() => assignIncoming(g, o.name, true, { skipConfirm: true })}
                                  >
                                    Assist
                                  </button>
                                ))}
                              </>
                            )}
                            {review ? (
                              flagId ? (
                                <button
                                  type="button"
                                  className="mini-btn danger"
                                  disabled={busy}
                                  onClick={async () => {
                                    const ok = await saveFlag({
                                      noteId: flagId,
                                      contactId: g.contactId != null ? String(g.contactId) : null,
                                      contactName: g.contactName || null,
                                      owner: g.owner,
                                      day: g.day,
                                      type: g.giftType || null,
                                      label: "Gift dismissed",
                                      points: 0,
                                      status: "removed",
                                      reason: "Does not qualify",
                                    });
                                    if (ok) showUndo(flagId, `Removed ${g.contactName || "this gift"}.`);
                                  }}
                                >
                                  {busy ? "…" : "Remove"}
                                </button>
                              ) : null
                            ) : (
                              <button
                                type="button"
                                className="mini-btn danger"
                                disabled={busy}
                                onClick={() => dismissIncoming(g)}
                              >
                                {flagBusy === `gift:${g.giftId}` ? "…" : "Remove"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </section>
          ) : (
          <>
          {tab === "points" ? (
          <>
          <RaisedTrendChart weeks={weeklyRaised} incomingAmount={todoAllAmount} />

          <section className="section">
            <h2>
              All Mission Advancement{" "}
              <span className="section-hint">
                {range === "all"
                  ? `from ${weekLabel(SETTINGS.evalStart)}`
                  : range === "dates"
                    ? rangeLabel
                    : null}
              </span>
            </h2>
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
                      <tr
                        key={o.name}
                        className={`clickable${selected === o.name ? " selected" : ""}`}
                        onClick={() => {
                          setSelected(o.name === selected ? null : o.name);
                          setPickedWeek(null);
                          setPickedDay(null);
                          setCategoryFilter(null);
                        }}
                      >
                        <td>{o.name}</td>
                        <td className="pts tabular">{o.points.toLocaleString()}</td>
                        <td className="tabular">{Math.round(o.avgPerWeekday || 0)}</td>
                        <td>
                          <span className="tier" style={{ background: tier.color }}>
                            {tier.label}
                          </span>
                        </td>
                        <td className="tabular">{o.conversations ?? 0}</td>
                        <td className="tabular">{o.dials ?? 0}</td>
                        <td className="tabular">{pct(o.convRate)}</td>
                        <td className="tabular">{o.gifts ?? 0}</td>
                        <td className="pts tabular">{money(o.giftAmount)}</td>
                      </tr>
                    );
                  })}
                  {(() => {
                    const t = model.totals || {};
                    const teamAvg = t.weekdays ? (t.points || 0) / t.weekdays : 0;
                    const teamTier = tierFor(teamAvg);
                    return (
                      <tr className="grand">
                        <td>Total</td>
                        <td className="pts tabular">{(t.points ?? 0).toLocaleString()}</td>
                        <td className="tabular">{t.weekdays ? Math.round(teamAvg) : "—"}</td>
                        <td>
                          <span className="tier" style={{ background: teamTier.color }}>
                            {teamTier.label}
                          </span>
                        </td>
                        <td className="tabular">{t.conversations ?? 0}</td>
                        <td className="tabular">{t.dials ?? 0}</td>
                        <td className="tabular">{pct(t.convRate)}</td>
                        <td className="tabular">{t.gifts ?? 0}</td>
                        <td className="pts tabular">{money(t.giftAmount)}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </section>

          {selectedOwner && (
            <section className="section panel">
              <h2>
                {selectedOwner.name}{" "}
                <span className="section-hint">
                  {selectedOwner.tier?.label}{selectedOwner.tier?.meaning ? ` · ${selectedOwner.tier.meaning}` : ""} · {Math.round(selectedOwner.avgPerWeekday || 0)} pts/weekday · {money(selectedOwner.giftAmount)} raised
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
              <h3 style={{ marginTop: 0 }}>Day</h3>
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
                  const label = formatDay(d);
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
                {activeCategoryLabel ? ` · ${activeCategoryLabel}` : ""}
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
                            {r.tracked ? (
                              <span style={{ color: "var(--slate-400)" }}> · dashboard</span>
                            ) : null}
                            {r.contactName ? <span style={{ color: "var(--slate-400)" }}> · {r.contactName}</span> : null}
                            {r.bucket === "donation" && r.amount != null && r.amount > 0 ? (
                              <span style={{ color: "var(--slate-400)" }}> · {money(r.amount)}</span>
                            ) : r.giftId && r.giftAmount != null ? (
                              <span style={{ color: "var(--slate-400)" }}>
                                {" "}
                                · linked gift {money(r.giftAmount)}
                              </span>
                            ) : null}
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
                                Contact ↗
                              </a>
                            ) : (
                              "—"
                            )}
                            {r.giftId && virtuousGiftUrl(r.contactId) ? (
                              <>
                                {" "}
                                <a href={virtuousGiftUrl(r.contactId)} target="_blank" rel="noopener noreferrer">
                                  Gift ↗
                                </a>
                              </>
                            ) : null}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {!key || (r.unmatched && !removed) || r.mgoAssigned || r.needsReview ? (
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

          <details className="track-chart">
            <summary>
              Personal Bests{" "}
              <span className="section-hint">best week</span>
            </summary>
            <div className="track-chart-body wide">
              <table className="grid spread">
                <thead>
                  <tr>
                    <th>MA</th>
                    <th>Best week</th>
                    <th>Pts</th>
                    <th>Convos</th>
                    <th>Dials</th>
                    <th>Gifts</th>
                    <th>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {(model.bests?.owners || []).map((o) => {
                    const weekPts = (o.points as BestRec | undefined)?.value ?? 0;
                    const conv = o.conversations as BestRec | undefined;
                    const dials = o.dials as BestRec | undefined;
                    const gifts = o.gifts as BestRec | undefined;
                    const raised = o.giftAmount as BestRec | undefined;
                    return (
                      <tr key={String(o.name)}>
                        <td>{String(o.short || o.name)}</td>
                        <td>{o.bestWeek ? weekLabel(String(o.bestWeek)) : "—"}</td>
                        <td className="pts tabular">{weekPts.toLocaleString()}</td>
                        <td className="tabular">{(conv?.value ?? 0).toLocaleString()}</td>
                        <td className="tabular">{(dials?.value ?? 0).toLocaleString()}</td>
                        <td className="tabular">{(gifts?.value ?? 0).toLocaleString()}</td>
                        <td className="pts tabular">{money(raised?.value)}</td>
                      </tr>
                    );
                  })}
                  {model.bests?.team && (
                    <tr className="grand">
                      <td>Team</td>
                      <td>{model.bests.teamWeek ? weekLabel(model.bests.teamWeek) : "—"}</td>
                      <td className="pts tabular">{(model.bests.team.points?.value ?? 0).toLocaleString()}</td>
                      <td className="tabular">{(model.bests.team.conversations?.value ?? 0).toLocaleString()}</td>
                      <td className="tabular">{(model.bests.team.dials?.value ?? 0).toLocaleString()}</td>
                      <td className="tabular">{(model.bests.team.gifts?.value ?? 0).toLocaleString()}</td>
                      <td className="pts tabular">{money(model.bests.team.giftAmount?.value)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </details>
          </>
          ) : null}

          {tab === "events" ? (
          <section className="section">
            <h2>
              Events{" "}
              <span className="section-hint">
                {EVENT_POINTS_PER_HOUR} pts/hour
                {range === "dates" ? ` · ${rangeLabel}` : " · includes past events"}
              </span>
            </h2>
            <div className="panel">
              <form
                className="event-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  addTrackedEvent();
                }}
              >
                <label>
                  MA
                  <select
                    aria-label="Event MA"
                    value={eventForm.owner}
                    onChange={(e) => setEventForm((f) => ({ ...f, owner: e.target.value }))}
                    required
                  >
                    <option value="">Select MA</option>
                    {MA_ROSTER.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.short || m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    aria-label="Event date"
                    value={eventForm.day}
                    onChange={(e) => setEventForm((f) => ({ ...f, day: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Event type
                  <select
                    aria-label="Event type"
                    value={eventForm.eventType}
                    onChange={(e) => setEventForm((f) => ({ ...f, eventType: e.target.value }))}
                    required
                  >
                    {TRACKED_EVENT_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                {eventForm.eventType === "projects" ? (
                  <label>
                    Project type
                    <input
                      type="text"
                      aria-label="Project type"
                      placeholder="Type of project"
                      maxLength={200}
                      value={eventForm.projectType}
                      onChange={(e) => setEventForm((f) => ({ ...f, projectType: e.target.value }))}
                    />
                  </label>
                ) : null}
                <label>
                  Hours
                  <input
                    type="number"
                    aria-label="Event hours"
                    min={0.25}
                    max={24}
                    step={0.25}
                    value={eventForm.hours}
                    onChange={(e) => setEventForm((f) => ({ ...f, hours: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Event name
                  <input
                    type="text"
                    aria-label="Event name"
                    placeholder="optional"
                    maxLength={200}
                    value={eventForm.name}
                    onChange={(e) => setEventForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>
                <div className="event-form-submit">
                  <div className="pts-preview tabular">
                    {Number.isFinite(formHours) && formHours > 0
                      ? `${formPoints.toLocaleString()} pts`
                      : "— pts"}
                  </div>
                  <button type="submit" className="mini-btn solid" disabled={eventBusy}>
                    {eventBusy ? "Saving…" : "Add event"}
                  </button>
                </div>
              </form>
              {listedTracked.length === 0 ? (
                <p className="footnote">No events yet. Add one above. All is every event logged on this dashboard, including past dates.</p>
              ) : (
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>MA</th>
                      <th>Type</th>
                      <th>Event</th>
                      <th>Hours</th>
                      <th>Pts</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {listedTracked.map((e) => (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{formatDay(e.day)}</td>
                        <td>{e.owner}</td>
                        <td>
                          {eventTypeLabel(e.eventType)}
                          {(e.eventType === "projects" || e.eventType === "Projects") && e.projectType ? (
                            <div className="section-hint">{e.projectType}</div>
                          ) : null}
                        </td>
                        <td>{e.name || "—"}</td>
                        <td className="tabular">{e.hours}</td>
                        <td className="pts tabular">{eventPointsForHours(e.hours).toLocaleString()}</td>
                        <td>
                          <button
                            type="button"
                            className="mini-btn danger"
                            disabled={eventBusy}
                            onClick={() => deleteTrackedEvent(e.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
          ) : null}

          {tab === "points" ? (
          <>
          <section className="section">
            <h2>
              Gifts{" "}
              <span className="section-hint">contacts before they gave · Remove drops a gift from Raised and this list</span>
            </h2>
            <div className="panel">
                  <table className="grid" style={{ marginBottom: 18 }}>
                    <thead>
                      <tr>
                        <th>Reached by</th>
                        <th>Gifts</th>
                        <th>Raised</th>
                        <th>Avg contacts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {giftTouches.length === 0 ? (
                        <tr>
                          <td colSpan={4}>No counted gifts in this range.</td>
                        </tr>
                      ) : giftTouches.map(([source, rec]) => (
                        <tr key={source}>
                          <td>{source}</td>
                          <td className="tabular">{rec.count}</td>
                          <td className="pts tabular">{money(rec.amount)}</td>
                          <td className="tabular">
                            {rec.count ? (Number.isInteger(rec.touches / rec.count) ? String(rec.touches / rec.count) : (rec.touches / rec.count).toFixed(1)) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                        <tr
                          key={o.name}
                          className={`clickable${giftOwner === o.name ? " selected" : ""}`}
                          onClick={() => setGiftOwner((cur) => (cur === o.name ? "all" : o.name))}
                        >
                          <td>{o.name}</td>
                          <td className="tabular">{o.gifts ?? 0}</td>
                          <td className="pts tabular">{money(o.giftAmount)}</td>
                        </tr>
                      ))}
                      <tr
                        className={`grand clickable${giftOwner === "all" ? " selected" : ""}`}
                        onClick={() => setGiftOwner("all")}
                      >
                        <td>All</td>
                        <td className="tabular">{model.totals?.gifts ?? 0}</td>
                        <td className="pts tabular">{money(model.totals?.giftAmount)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {!giftOwner ? (
                    <p className="footnote">Click a name or All to see the gifts.</p>
                  ) : listedGifts.length === 0 ? (
                    <p className="footnote">No counted gifts in this range.</p>
                  ) : (
                    <table className="grid">
                      <thead>
                        <tr>
                          <th>Gift date</th>
                          <th>Kind</th>
                          <th>Amount</th>
                          <th>MA</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {listedGifts.map((g, i) => {
                          const removeId = giftRemoveId(g);
                          return (
                          <tr
                            key={g.giftId != null && g.giftId !== "" ? String(g.giftId) : i}
                          >
                            <td style={{ whiteSpace: "nowrap" }}>
                              {g.day ? formatDay(g.day) : "—"}
                              {g.contactName ? (
                                <div style={{ color: "var(--slate-400)", fontWeight: 400 }}>{g.contactName}</div>
                              ) : null}
                            </td>
                            <td>
                              {g.assist
                                ? "Assist"
                                : g.acIncrease
                                  ? "AC increase"
                                  : g.annualized
                                    ? "Monthly ×12"
                                    : (g.giftType || "—")}
                              {g.project ? (
                                <span style={{ color: "var(--slate-400)" }}> · {g.project}</span>
                              ) : null}
                            </td>
                            <td className="pts tabular">
                              {g.assist ? money(0) : money(g.amount)}
                              {g.assist && Number(g.postedAmount ?? g.giftAmount ?? 0) > 0 ? (
                                <span className="section-hint"> ({money(Number(g.postedAmount ?? g.giftAmount))} gift)</span>
                              ) : g.acIncrease && g.priorMonthly != null && g.newMonthly != null ? (
                                <span className="section-hint"> ({monthlyRate(g.priorMonthly)} → {monthlyRate(g.newMonthly)}/mo)</span>
                              ) : g.annualized && g.postedAmount != null ? (
                                <span className="section-hint"> ({money(g.postedAmount)}/mo)</span>
                              ) : null}
                            </td>
                            <td>{g.owner}</td>
                            <td>
                              {virtuousGiftUrl(g.contactId) ? (
                                <a href={virtuousGiftUrl(g.contactId)} target="_blank" rel="noopener noreferrer">
                                  Gift ↗
                                </a>
                              ) : null}
                              <div style={{ marginTop: virtuousGiftUrl(g.contactId) ? 6 : 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {!g.assist && g.giftId != null && g.giftId !== "" && g.contactId != null && g.day ? (
                                  <button
                                    type="button"
                                    className="mini-btn"
                                    disabled={assignBusy === `${g.giftId}:${g.owner}` || flagBusy === giftFlagId(g)}
                                    onClick={() => assignIncoming(g, g.owner, true)}
                                  >
                                    {assignBusy === `${g.giftId}:${g.owner}` ? "…" : "Gift assist"}
                                  </button>
                                ) : null}
                                {removeId ? (
                                  <button
                                    type="button"
                                    className="mini-btn danger"
                                    disabled={flagBusy === removeId}
                                    onClick={() => removeCountedGift(g)}
                                  >
                                    {flagBusy === removeId ? "…" : "Remove"}
                                  </button>
                                ) : !g.assist ? (
                                  "—"
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
            </div>
          </section>


          <section className="section">
            <h3>Tiers</h3>
            <div className="legend">
              {TIERS.map((t) => (
                <span key={t.id} className="k">
                  <span className="dot" style={{ background: t.color }} />
                  {t.label} — {t.meaning} — {t.min ? `≥${t.min}` : "<100"} pts/wkdy
                  {t.payout != null ? ` · $${t.payout.toLocaleString()}` : ""}
                </span>
              ))}
            </div>
          </section>
          {followUps.length > 0 ? (
            <section className="section">
              <h2>Verbal commitments <span className="section-hint">Mission Advancement | Verbal Gift Commitment · follow up two days later</span></h2>
              <div className="panel">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Note</th>
                      <th>MA</th>
                      <th>Donor</th>
                      <th>Follow up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {followUps.map((f) => (
                      <tr key={f.id}>
                        <td>
                          {formatDay(f.day)} · {f.label}
                          {f.text ? <div style={{ color: "var(--slate-400)" }}>{f.text}</div> : null}
                        </td>
                        <td>{f.owner}</td>
                        <td>
                          {f.contactId ? (
                            <a href={virtuousContactUrl(f.contactId)} target="_blank" rel="noopener noreferrer">
                              {f.contact || "Contact"} ↗
                            </a>
                          ) : (
                            f.contact || "—"
                          )}
                        </td>
                        <td>{f.due ? formatDay(f.due) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          </>
          ) : null}
          </>
          )}

          {tab === "insights" ? (
            error ? null : raw ? <InsightsPanel insights={insights} /> : <p className="footnote">Loading donor records…</p>
          ) : null}

          {undo ? (
            <div className="undo-bar" role="status">
              <p>{undo.message}</p>
              <button
                type="button"
                className="mini-btn solid"
                disabled={flagBusy === undo.flagId}
                onClick={() => undoLast()}
              >
                {flagBusy === undo.flagId ? "Undoing…" : "Undo"}
              </button>
              <button
                type="button"
                className="undo-dismiss"
                aria-label="Dismiss"
                onClick={() => {
                  clearUndoTimer();
                  setUndo(null);
                }}
              >
                ×
              </button>
            </div>
          ) : null}
        </main>
    </div>
  );
}
