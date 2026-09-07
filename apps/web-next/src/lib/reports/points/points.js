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
    if (!/mission advancement/i.test(type) && !/^obituary$/i.test(type)) return null;
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

function parseAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Pull GFT_Solicitor off a FullGift customFields array. */
export function giftSolicitor(record) {
  const fields = record.customFields || record.custom_fields || [];
  for (const f of fields) {
    if ((f.name || f.displayName) === "GFT_Solicitor" && f.value) return String(f.value).trim();
  }
  return (record.solicitor || "").trim() || null;
}

/** Primary designation / project name for a gift, if present. */
export function giftProject(record) {
  if (record.project) return record.project;
  const des = record.giftDesignations || [];
  return (des[0] && (des[0].project || des[0].display)) || record.segment || "";
}

/** Calendar-day compare (YYYY-MM-DD). Null if either date is missing. */
function dayCmp(a, b) {
  const ka = isoDay(a);
  const kb = isoDay(b);
  if (!ka || !kb) return null;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function giftDateOf(record) {
  return parseDate(record.giftDate || record.giftDateFormatted || record.createDateTimeUtc);
}

/**
 * Score a Virtuous Gift as dollars received (0 points; the 100-pt credit
 * comes from the matching donation note so we don't double-count).
 * Owner is GFT_Solicitor when that person is on the MA roster, else the
 * MA who logged a donation note on the same contact with noteDate on or
 * before giftDate (`ownerHint`). Returns null when amount is 0 or less.
 */
export function scoreGift(record, ownerHint = null) {
  const amount = parseAmount(record.amount);
  if (amount <= 0) return null;
  const solicitor = giftSolicitor(record);
  const owner = (solicitor && rosterSet.has(solicitor) ? solicitor : null) || ownerHint;
  if (!owner) return null;
  const date = giftDateOf(record);
  if (!date) return null;
  return {
    owner, type: "Gift", points: 0, amount, bucket: "donation",
    label: "Donation received",
    day: isoDay(date), date, weekday: isWeekday(date),
    contactId: record.contactId, contactName: record.contactName || "",
    giftId: record.id, giftType: record.giftType || "",
    project: giftProject(record), solicitor: solicitor || "",
    source: "gift",
  };
}

function sortByDayThenId(aDate, aId, bDate, bId) {
  const cmp = dayCmp(aDate, bDate);
  if (cmp) return cmp;
  return String(aId ?? "").localeCompare(String(bId ?? ""));
}

/**
 * Score MA activity notes (and optional gifts) into a flat list of scored rows.
 *
 * Donation notes (bucket "gift") award 100 pts only after they pair with a
 * posted gift of amount > 0 on the same contact with giftDate on or after the
 * note date. Points are moved onto that gift's week. Unmatched donation notes
 * score 0 and leave the gift bucket. Later installments still count as gifts
 * and dollars but do not award another 100 pts.
 */
export function scoreAll({ notes = [], gifts = [] }) {
  const rows = [];
  const donationNotes = [];
  for (const n of notes) {
    const r = scoreNote(n);
    if (!r) continue;
    rows.push(r);
    if (r.bucket === "gift") donationNotes.push(r);
  }

  const notesByContact = new Map();
  for (const r of donationNotes) {
    if (r.contactId == null) continue;
    const list = notesByContact.get(r.contactId) || [];
    list.push(r);
    notesByContact.set(r.contactId, list);
  }
  for (const list of notesByContact.values()) {
    list.sort((a, b) => sortByDayThenId(a.date, a.noteId, b.date, b.noteId));
  }

  const scoredGifts = [];
  for (const g of gifts) {
    let hint = null;
    const gDate = giftDateOf(g);
    if (g.contactId != null && gDate) {
      const list = notesByContact.get(g.contactId) || [];
      for (const n of list) {
        const cmp = dayCmp(n.date, gDate);
        if (cmp != null && cmp <= 0) hint = n.owner;
      }
    }
    const r = scoreGift(g, hint);
    if (r) {
      rows.push(r);
      scoredGifts.push(r);
    }
  }

  const giftsByContact = new Map();
  for (const g of scoredGifts) {
    if (g.contactId == null) continue;
    const list = giftsByContact.get(g.contactId) || [];
    list.push(g);
    giftsByContact.set(g.contactId, list);
  }
  for (const list of giftsByContact.values()) {
    list.sort((a, b) => sortByDayThenId(a.date, a.giftId, b.date, b.giftId));
  }

  const used = new Set();
  const notesInOrder = [...donationNotes].sort(
    (a, b) => sortByDayThenId(a.date, a.noteId, b.date, b.noteId),
  );
  for (const note of notesInOrder) {
    const candidates = note.contactId != null ? (giftsByContact.get(note.contactId) || []) : [];
    const match = candidates.find((g) => {
      if (used.has(g)) return false;
      if ((g.amount || 0) <= 0) return false;
      const cmp = dayCmp(g.date, note.date);
      return cmp != null && cmp >= 0;
    });
    if (match) {
      used.add(match);
      note.date = match.date;
      note.day = match.day;
      note.weekday = match.weekday;
    } else {
      note.points = 0;
      note.bucket = "unmatched";
      note.unmatched = true;
    }
  }

  return rows;
}

/** Score matched events for the display-only reference table. */
export function scoreEventsForDisplay(events = []) {
  return events.map(scoreEvent).filter(Boolean);
}
