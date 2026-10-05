/**
 * aggregate.js — rollups over scored rows. Pure functions.
 * Produces the per-MA / per-day / per-week / per-bucket structures the UI needs,
 * plus tier assignment (average points per weekday), a spreadsheet-style weekly
 * grid, gift-dollar totals, and personal-best / best-week records.
 */
import { MA_ROSTER, BUCKETS, TRACKER_LAYOUT, tierFor } from "./config.js";

/** Stable id for a scored row (note or gift) used by count/remove overrides. */
export function rowId(r) {
  if (r == null) return null;
  if (r.noteId != null && r.noteId !== "") return String(r.noteId);
  if (r.giftId != null && r.giftId !== "") return `gift:${r.giftId}`;
  return null;
}

/**
 * Tasks Count/Remove list. Assigned or unassigned MGO gift dollar rows use
 * the Assign checkbox on Donations Received, not this list (same `gift:{id}`
 * key as Assign; Remove would overwrite status and un-credit the gift).
 * Auto-credited (non-MGO) gift dollar rows stay on Tasks.
 */
export function isTaskListRow(r) {
  if (r == null) return false;
  if (r.mgoAssigned || r.needsReview) return false;
  if (r.bucket === "possible" || r.bucket === "commitment" || r.bucket === "general") return false;
  return true;
}

/**
 * Counted gift rows for the Gifts table (`removed: false`) or the trash
 * Restore list (`removed: true`). Assist rows stay on the list at $0.
 */
export function listedGiftRows(rows, { owner = "all", removed = false } = {}) {
  const wantRemoved = !!removed;
  return (rows || [])
    .filter((r) => !r.needsReview && !!r.removed === wantRemoved)
    .filter((r) => (r.bucket === "donation" && (r.amount || 0) > 0) || (r.assist && r.giftId != null))
    .filter((g) => !owner || owner === "all" || g.owner === owner)
    .sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")));
}

function rowRemoved(r, flags) {
  if (!flags) return false;
  // Gifts-table Remove uses its own key so it does not overwrite an assign flag.
  if (r.giftId != null && r.giftId !== "" && (r.bucket === "donation" || r.assist)) {
    if (flags[`gift-remove:${r.giftId}`]?.status === "removed") return true;
  }
  if (r.bucket === "possible" && r.giftId != null && r.giftId !== "") {
    if (flags[`gift:${r.giftId}`]?.status === "removed") return true;
  }
  const id = rowId(r);
  if (!id) return false;
  return flags[id]?.status === "removed";
}

/** Monday-anchored week key for a Date. */
export function weekKey(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7; // Mon=0
  t.setDate(t.getDate() - day);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function weekLabel(key) {
  const d = new Date(key + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Seven YYYY-MM-DD days, Monday through Sunday, for a Monday week key. */
export function daysOfWeek(mondayKey) {
  if (!mondayKey) return [];
  const mon = new Date(mondayKey + "T00:00:00");
  if (Number.isNaN(+mon)) return [];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function matchTrackerLeaf(leaf, rows) {
  const types = new Set((leaf.types || []).map((t) => String(t).toLowerCase()));
  const buckets = new Set(leaf.buckets || []);
  let count = 0;
  let points = 0;
  for (const r of rows) {
    const type = (r.type || "").trim().toLowerCase();
    if ((types.size && types.has(type)) || (buckets.size && buckets.has(r.bucket))) {
      count += 1;
      points += r.points || 0;
    }
  }
  return { id: leaf.id, label: leaf.label, section: false, indent: false, count, points };
}

/**
 * Gift is one row per posted gift. Count and points both come from that row
 * (100 pts on the gift, not a second note row). Gift Assist is separate.
 */
function matchDonationLeaf(leaf, all) {
  const gifts = all.filter((r) => r.bucket === "donation" && (r.amount || 0) > 0 && !r.assist && !r.needsReview);
  return {
    id: leaf.id,
    label: leaf.label,
    section: false,
    indent: false,
    count: gifts.length,
    points: gifts.reduce((s, r) => s + (r.points || 0), 0),
  };
}

/**
 * Spreadsheet-style category mix for a set of scored rows (one MA, one week
 * or day). Skips removed rows, unmatched notes, and Incoming (possible) gifts.
 * Posted gifts are counted on the Donation line so that category matches Raised.
 */
export function trackerBreakdown(rows, layout = TRACKER_LAYOUT) {
  const all = (rows || []).filter(
    (r) => !r.removed && !r.unmatched && r.bucket !== "possible",
  );
  const scored = all.filter((r) => r.bucket !== "donation");
  const lines = [];
  let totalPoints = 0;
  let totalCount = 0;
  for (const group of layout) {
    if (group.section) {
      const children = (group.children || []).map((leaf) => {
        const rec = matchTrackerLeaf(leaf, scored);
        rec.indent = true;
        return rec;
      });
      const points = children.reduce((s, c) => s + c.points, 0);
      const count = children.reduce((s, c) => s + c.count, 0);
      lines.push({ id: group.id, label: group.label, section: true, indent: false, count, points });
      for (const child of children) lines.push(child);
      totalPoints += points;
      totalCount += count;
    } else {
      const rec = group.id === "donation"
        ? matchDonationLeaf(group, all)
        : matchTrackerLeaf(group, scored);
      lines.push(rec);
      totalPoints += rec.points;
      totalCount += rec.count;
    }
  }
  return { lines, totalPoints, totalCount };
}

/** Types/buckets for one tracker category (or all children of a section). */
export function trackerSpec(id, layout = TRACKER_LAYOUT) {
  if (!id) return null;
  const collect = (leaf) => ({
    types: (leaf.types || []).map((t) => String(t).toLowerCase()),
    buckets: leaf.buckets || [],
  });
  for (const group of layout) {
    if (group.id === id) {
      if (group.section) {
        const types = [];
        const buckets = [];
        for (const child of group.children || []) {
          const spec = collect(child);
          types.push(...spec.types);
          buckets.push(...spec.buckets);
        }
        return { types, buckets };
      }
      return collect(group);
    }
    for (const child of group.children || []) {
      if (child.id === id) return collect(child);
    }
  }
  return null;
}

export function rowMatchesTracker(r, spec) {
  if (!spec) return true;
  const type = (r.type || "").trim().toLowerCase();
  if (spec.types && spec.types.includes(type)) return true;
  if (spec.buckets && spec.buckets.includes(r.bucket)) return true;
  return false;
}

function blankWeek(key) {
  return {
    key,
    points: 0,
    conversations: 0,
    dials: 0,
    gifts: 0,
    giftAmount: 0,
    obituaries: 0,
    addresses: 0,
    letters: 0,
    meetings: 0,
    events: 0,
    emails: 0,
  };
}

function isDial(r) {
  return r.bucket === "dial" || r.bucket === "failed" || r.bucket === "conversation";
}

function tallyRow(target, r) {
  target.points += r.points || 0;
  if (r.bucket === "conversation") target.conversations += 1;
  if (isDial(r)) target.dials += 1;
  if (r.bucket === "donation" && (r.amount || 0) > 0) target.gifts += 1;
  if (r.bucket === "donation") target.giftAmount += r.amount || 0;
  if (r.bucket === "obituary") target.obituaries += 1;
  if (r.bucket === "address") target.addresses += 1;
  if (r.bucket === "note") target.letters += 1;
  if (r.bucket === "facetoface") target.meetings += 1;
  if (r.bucket === "event") target.events += 1;
  if (r.bucket === "email") target.emails += 1;
}

/**
 * Build the full aggregate model from scored rows within [start, end].
 * Gift count and dollars both come from bucket "donation" rows with amount > 0.
 * `flags` is the shared count/remove map (row id -> { status }). A status of
 * "removed" keeps the row in `model.rows` for the activity table but drops it
 * from points, activity counts, and gift totals.
 * Rows with `needsReview` (unassigned MGO-coded gifts) are listed on
 * `model.reviewGifts` and are not added to Raised or `model.gifts`.
 */
export function aggregate(rows, { start, end, flags } = {}) {
  const inRange = rows.filter((r) => {
    if (!r.date) return false;
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    return true;
  }).map((r) => ({ ...r, removed: rowRemoved(r, flags) }));

  const reviewGifts = inRange.filter((r) => r.needsReview && !r.removed);
  const scored = inRange.filter((r) => !r.needsReview && r.bucket !== "commitment" && r.bucket !== "general");

  const byOwner = new Map(MA_ROSTER.map((m) => [m.name, blankOwner(m)]));
  const days = new Set();
  const weekdays = new Set();
  const gifts = [];
  const possibleGifts = [];

  for (const r of scored) {
    if (r.bucket === "possible") {
      if (!r.removed) possibleGifts.push(r);
      continue;
    }
    const o = byOwner.get(r.owner);
    if (!o) continue;
    if (r.removed) continue;
    o.count += 1;
    o.buckets[r.bucket] = (o.buckets[r.bucket] || 0) + 1;
    o.bucketPoints[r.bucket] = (o.bucketPoints[r.bucket] || 0) + (r.points || 0);
    if (r.unmatched) o.unmatched += 1;
    tallyRow(o, r);

    const dayRec = o.days.get(r.day) || { day: r.day, date: r.date, points: 0, count: 0, weekday: r.weekday };
    dayRec.points += r.points || 0;
    dayRec.count += 1;
    o.days.set(r.day, dayRec);

    const wk = weekKey(r.date);
    const wkRec = o.weeks.get(wk) || blankWeek(wk);
    tallyRow(wkRec, r);
    o.weeks.set(wk, wkRec);

    if (r.bucket === "donation" && (r.amount || 0) > 0) gifts.push(r);

    days.add(r.day);
    if (r.weekday) weekdays.add(r.day);
  }

  const owners = [];
  for (const o of byOwner.values()) {
    const weekdaysWorked = [...o.days.values()].filter((d) => d.weekday).length || 0;
    o.weekdaysWorked = weekdaysWorked;
    o.avgPerWeekday = weekdaysWorked ? o.points / weekdaysWorked : 0;
    o.tier = tierFor(o.avgPerWeekday);
    o.convRate = o.dials ? o.conversations / o.dials : 0;
    o.dayList = [...o.days.values()].sort((a, b) => a.day.localeCompare(b.day));
    o.weekList = [...o.weeks.values()].sort((a, b) => a.key.localeCompare(b.key));
    o.days = undefined;
    o.weeks = undefined;
    owners.push(o);
  }

  const ranked = [...owners].sort((a, b) => b.points - a.points);
  const tableOwners = [...owners].sort((a, b) => (a.tableOrder ?? 99) - (b.tableOrder ?? 99));

  const totals = {
    points: owners.reduce((s, o) => s + o.points, 0),
    count: owners.reduce((s, o) => s + o.count, 0),
    conversations: owners.reduce((s, o) => s + o.conversations, 0),
    dials: owners.reduce((s, o) => s + o.dials, 0),
    unmatched: owners.reduce((s, o) => s + o.unmatched, 0),
    gifts: owners.reduce((s, o) => s + o.gifts, 0),
    giftAmount: owners.reduce((s, o) => s + o.giftAmount, 0),
    obituaries: owners.reduce((s, o) => s + o.obituaries, 0),
    addresses: owners.reduce((s, o) => s + o.addresses, 0),
    letters: owners.reduce((s, o) => s + o.letters, 0),
    meetings: owners.reduce((s, o) => s + o.meetings, 0),
    events: owners.reduce((s, o) => s + o.events, 0),
    days: days.size,
    weekdays: weekdays.size,
  };
  totals.convRate = totals.dials ? totals.conversations / totals.dials : 0;

  const weekGrid = buildWeekGrid(tableOwners);
  const bests = personalBests(tableOwners, weekGrid);

  return {
    owners: ranked,
    tableOwners,
    totals,
    buckets: BUCKETS,
    rows: scored,
    gifts,
    possibleGifts,
    reviewGifts,
    weekGrid,
    bests,
  };
}

function blankOwner(m) {
  return {
    name: m.name, short: m.short, email: m.email, tableOrder: m.tableOrder,
    points: 0, count: 0, conversations: 0, dials: 0, unmatched: 0,
    gifts: 0, giftAmount: 0, obituaries: 0, addresses: 0,
    letters: 0, meetings: 0, events: 0, emails: 0,
    buckets: {}, bucketPoints: {},
    days: new Map(), weeks: new Map(),
  };
}

function buildWeekGrid(tableOwners) {
  const keys = new Set();
  tableOwners.forEach((o) => o.weekList.forEach((w) => keys.add(w.key)));
  return [...keys].sort().map((key) => {
    const byOwner = {};
    const totals = blankWeek(key);
    for (const o of tableOwners) {
      const w = o.weekList.find((x) => x.key === key) || blankWeek(key);
      byOwner[o.name] = w;
      totals.points += w.points;
      totals.conversations += w.conversations;
      totals.dials += w.dials;
      totals.gifts += w.gifts;
      totals.giftAmount += w.giftAmount;
      totals.obituaries += w.obituaries;
      totals.addresses += w.addresses;
      totals.letters += w.letters;
      totals.meetings += w.meetings;
      totals.events += w.events;
      totals.emails += w.emails;
    }
    totals.convRate = totals.dials ? totals.conversations / totals.dials : 0;
    const working = tableOwners.filter((o) => (byOwner[o.name].points || 0) > 0 || (byOwner[o.name].dials || 0) > 0);
    totals.avgPoints = working.length ? totals.points / working.length : 0;
    return { key, label: weekLabel(key), byOwner, totals };
  });
}

const BEST_METRICS = [
  { id: "conversations", label: "Conversations" },
  { id: "dials", label: "Dials" },
  { id: "points", label: "Points" },
  { id: "gifts", label: "Gifts logged" },
  { id: "giftAmount", label: "Dollars received" },
];

function weekHasWork(t) {
  return (t?.points || 0) > 0 || (t?.dials || 0) > 0 || (t?.gifts || 0) > 0;
}

/**
 * Each MA’s best is one week (highest points); every metric is that week’s
 * count. Team best is the all-time best team week the same way.
 */
export function personalBests(tableOwners, weekGrid) {
  const owners = tableOwners.map((o) => {
    let bestWeek = null;
    let bestPoints = -1;
    for (const w of o.weekList) {
      if (!weekHasWork(w)) continue;
      const pts = w.points || 0;
      if (pts > bestPoints || (pts === bestPoints && w.key > (bestWeek || ""))) {
        bestPoints = pts;
        bestWeek = w.key;
      }
    }
    const week = o.weekList.find((w) => w.key === bestWeek) || {};
    const rec = { name: o.name, short: o.short, bestWeek, totalPoints: o.points || 0 };
    for (const m of BEST_METRICS) {
      rec[m.id] = { value: week[m.id] || 0, week: bestWeek };
    }
    return rec;
  });

  let bestWeek = null;
  let bestPoints = -1;
  for (const g of weekGrid) {
    if (!weekHasWork(g.totals)) continue;
    const pts = g.totals.points || 0;
    if (pts > bestPoints || (pts === bestPoints && g.key > (bestWeek || ""))) {
      bestPoints = pts;
      bestWeek = g.key;
    }
  }
  const totals = (weekGrid.find((g) => g.key === bestWeek) || {}).totals || {};
  const team = {};
  for (const m of BEST_METRICS) {
    team[m.id] = { value: totals[m.id] || 0, week: bestWeek };
  }
  const teamTotalPoints = tableOwners.reduce((s, o) => s + (o.points || 0), 0);
  return { owners, team, teamWeek: bestWeek, teamTotalPoints, metrics: BEST_METRICS };
}

/** Combined daily timeseries across all MAs (for the trend chart). */
export function dailyTotals(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.removed || r.folded) continue;
    if (r.bucket === "possible") continue;
    const rec = map.get(r.day) || { day: r.day, date: r.date, points: 0 };
    rec.points += r.points || 0;
    map.set(r.day, rec);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}
