/**
 * points.js — the scoring engine. Pure functions, no DOM, no I/O.
 * Turns raw Virtuous records into scored activity rows entirely client-side.
 */
import { POINTS_MAP, EVENT_RULES, SETTINGS, MA_NAMES } from "./config.js";

/** Normalize a Virtuous date string ("8/4/2026" or ISO) to a Date (local). */
export function parseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
  const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

/** YYYY-MM-DD in local time. */
export function isoDay(d) {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isWeekday(d) {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

const rosterSet = new Set(MA_NAMES);

/** Is this note authored by a scoped MA? */
export function ownerOf(record) {
  const name = (record.createdByUser || "").replace(/\s+/g, " ").trim();
  return rosterSet.has(name) ? name : null;
}

/**
 * Score a single raw ContactNote. Returns a scored row or null if it is not a
 * scoped/known activity. Unknown MA note types are returned with points:0 and
 * `unmatched:true` so the UI can surface coverage gaps.
 */
export function scoreNote(record) {
  const owner = ownerOf(record);
  if (!owner) return null;

  const type = (record.type || "").trim();
  const key = type.toLowerCase();
  const rule = POINTS_MAP[key];
  const date = parseDate(record.noteDate) || parseDate(record.createDateTimeUtc);
  if (!date) return null;

  if (!rule) {
    // Authored by an MA but the note type isn't in our map. Only surface
    // Mission-Advancement-flavored notes as coverage gaps; ignore unrelated
    // system notes so they don't pollute the dashboard.
    if (!/mission advancement/i.test(type)) return null;
    return {
      owner, type, points: 0, bucket: "unmatched", label: type,
      day: isoDay(date), date, weekday: isWeekday(date),
      contactId: record.contactId, contactName: record.contactName || "",
      noteId: record.id, source: "unmatched", unmatched: true,
    };
  }

  let points = rule.points;
  if (rule.conflict === "invalid_number" && SETTINGS.invalidNumberScores) points = 1;

  return {
    owner, type, points, bucket: rule.bucket, label: rule.label,
    day: isoDay(date), date, weekday: isWeekday(date),
    contactId: record.contactId, contactName: record.contactName || "",
    noteId: record.id, source: rule.source, conflict: rule.conflict || null,
  };
}

/**
 * Score a raw Event record (300 / 75) by name keyword; else flagged untagged.
 * DISPLAY-ONLY: Virtuous events carry no MA owner, so these rows are never
 * aggregated into an MA's total — they feed the Events reference table only.
 */
export function scoreEvent(record) {
  const name = record.name || record.eventName || "";
  // Real Virtuous field is `startDateTime` ("7/16/2026 5:30:00 PM"); fall back
  // to the UTC create stamp.
  const date = parseDate(record.startDateTime || record.createDateTimeUtc);
  const rule = EVENT_RULES.find((r) => r.match.test(name));
  if (!date) return null;
  return {
    type: "Event", points: rule ? rule.points : 0, bucket: "event",
    label: rule ? rule.label : `Event (untagged): ${name}`,
    day: isoDay(date), date, weekday: isWeekday(date),
    eventId: record.id, eventName: name,
    source: "pdf", unmatched: !rule,
  };
}

/** Score MA activity notes into a flat list of scored rows (events excluded). */
export function scoreAll({ notes = [] }) {
  const rows = [];
  for (const n of notes) { const r = scoreNote(n); if (r) rows.push(r); }
  return rows;
}

/** Score matched events for the display-only reference table. */
export function scoreEventsForDisplay(events = []) {
  return events.map(scoreEvent).filter(Boolean);
}
