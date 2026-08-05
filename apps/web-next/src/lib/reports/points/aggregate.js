/**
 * aggregate.js — rollups over scored rows. Pure functions.
 * Produces the per-MA / per-day / per-week / per-bucket structures the UI needs,
 * plus tier assignment (average points per weekday).
 */
import { MA_ROSTER, BUCKETS, tierFor } from "./config.js";

const money = (n) => n || 0;

/** Monday-anchored week key for a Date. */
export function weekKey(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7; // Mon=0
  t.setDate(t.getDate() - day);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function weekLabel(key) {
  const d = new Date(key + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Build the full aggregate model from scored rows within [start, end].
 * `weekdaysElapsed` drives the tier average (points / weekdays worked).
 */
export function aggregate(rows, { start, end } = {}) {
  const inRange = rows.filter((r) => {
    if (!r.date) return false;
    if (start && r.date < start) return false;
    if (end && r.date > end) return false;
    return true;
  });

  const byOwner = new Map(MA_ROSTER.map((m) => [m.name, blankOwner(m)]));
  const days = new Set();
  const weekdays = new Set();

  for (const r of inRange) {
    const o = byOwner.get(r.owner);
    if (!o) continue;
    o.points += r.points;
    o.count += 1;
    o.buckets[r.bucket] = (o.buckets[r.bucket] || 0) + 1;
    o.bucketPoints[r.bucket] = (o.bucketPoints[r.bucket] || 0) + r.points;
    if (r.bucket === "conversation") o.conversations += 1;
    if (r.bucket === "dial" || r.bucket === "failed" || r.bucket === "conversation") o.dials += 1;
    if (r.unmatched) o.unmatched += 1;

    // per-day
    const dayRec = o.days.get(r.day) || { day: r.day, date: r.date, points: 0, count: 0, weekday: r.weekday };
    dayRec.points += r.points; dayRec.count += 1;
    o.days.set(r.day, dayRec);

    // per-week
    const wk = weekKey(r.date);
    const wkRec = o.weeks.get(wk) || { key: wk, points: 0, conversations: 0, dials: 0 };
    wkRec.points += r.points;
    if (r.bucket === "conversation") wkRec.conversations += 1;
    if (r.bucket === "dial" || r.bucket === "failed" || r.bucket === "conversation") wkRec.dials += 1;
    o.weeks.set(wk, wkRec);

    days.add(r.day);
    if (r.weekday) weekdays.add(r.day);
  }

  // finalize owners
  const owners = [];
  for (const o of byOwner.values()) {
    const weekdaysWorked = [...o.days.values()].filter((d) => d.weekday).length || 0;
    o.weekdaysWorked = weekdaysWorked;
    o.avgPerWeekday = weekdaysWorked ? o.points / weekdaysWorked : 0;
    o.tier = tierFor(o.avgPerWeekday);
    o.convRate = o.dials ? o.conversations / o.dials : 0;
    o.dayList = [...o.days.values()].sort((a, b) => a.day.localeCompare(b.day));
    o.weekList = [...o.weeks.values()].sort((a, b) => a.key.localeCompare(b.key));
    o.days = undefined; o.weeks = undefined;
    owners.push(o);
  }
  owners.sort((a, b) => b.points - a.points);

  const totals = {
    points: owners.reduce((s, o) => s + o.points, 0),
    count: owners.reduce((s, o) => s + o.count, 0),
    conversations: owners.reduce((s, o) => s + o.conversations, 0),
    dials: owners.reduce((s, o) => s + o.dials, 0),
    unmatched: owners.reduce((s, o) => s + o.unmatched, 0),
    days: days.size,
    weekdays: weekdays.size,
  };
  totals.convRate = totals.dials ? totals.conversations / totals.dials : 0;

  return { owners, totals, buckets: BUCKETS, rows: inRange };
}

function blankOwner(m) {
  return {
    name: m.name, short: m.short, email: m.email,
    points: 0, count: 0, conversations: 0, dials: 0, unmatched: 0,
    buckets: {}, bucketPoints: {},
    days: new Map(), weeks: new Map(),
  };
}

/** Combined daily timeseries across all MAs (for the trend chart). */
export function dailyTotals(rows) {
  const map = new Map();
  for (const r of rows) {
    const rec = map.get(r.day) || { day: r.day, date: r.date, points: 0 };
    rec.points += r.points;
    map.set(r.day, rec);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}
