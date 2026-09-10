/**
 * points.js — the scoring engine. Pure functions, no DOM, no I/O.
 * Turns raw Virtuous records into scored activity rows entirely client-side.
 */
import { POINTS_MAP, EVENT_RULES, SETTINGS, MA_NAMES, MA_ROSTER } from "./config.js";

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
const startByOwner = new Map(MA_ROSTER.map((m) => [m.name, m.startDate || null]));

/** True when isoDay(date) is before the owner's optional roster startDate.
 * Compare YYYY-MM-DD strings, not Date objects: parseDate("2026-07-20") is
 * UTC midnight and can shift the local day. */
function beforeStart(date, owner) {
  const start = startByOwner.get(owner);
  if (!start) return false;
  const day = isoDay(date);
  if (!day) return false;
  return day < start;
}

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
  if (beforeStart(date, owner)) return null;

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
    assist: !!rule.assist,
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

const INSTALLMENT_TOLERANCE = 3;

/** Tracker credits monthly AC as 12 × the monthly amount. */
export function isMonthlyRecurring(record) {
  if (!record) return false;
  if (/^monthly$/i.test(String(record.frequency || "").trim())) return true;
  if (Array.isArray(record.recurringGiftPayments) && record.recurringGiftPayments.length > 0) return true;
  if (/instance of a recurring gift/i.test(String(record.notes || ""))) return true;
  return false;
}

function roundCents(n) {
  return Math.round(n * 100) / 100;
}

/** One-time gifts this large are not a monthly AC rate. */
const AC_MONTHLY_CAP = 250;

function isAcGift(record) {
  const blob = `${record.segment || ""} ${record.project || ""}`;
  return /annunciation/i.test(blob);
}

/**
 * Most recent Annunciation Circle monthly amount on this contact before `beforeDay`.
 * Tracker credits only the increase when an existing AC is raised.
 */
export function priorAcMonthly(posted, contactId, beforeDay) {
  const cid = Number(contactId);
  if (!Number.isFinite(cid) || !beforeDay) return 0;
  let bestDay = "";
  let bestAmt = 0;
  for (const g of posted || []) {
    if (Number(g.contactId) !== cid) continue;
    if (!isAcGift(g)) continue;
    const amt = parseAmount(g.amount);
    if (amt <= 0 || amt >= AC_MONTHLY_CAP) continue;
    const d = isoDay(parseDate(g.giftDate || g.giftDateFormatted));
    if (!d || d >= beforeDay) continue;
    if (d > bestDay) {
      bestDay = d;
      bestAmt = amt;
    }
  }
  return bestAmt;
}

/** Map a Virtuous RecurringGift onto the gift shape the scorer already uses. */
export function recurringToGift(record, posted = []) {
  const des = (record.designations && record.designations[0])
    || (record.giftDesignations && record.giftDesignations[0]);
  const start = record.startDate || record.recurringGiftDate || record.giftDate;
  const startDay = isoDay(parseDate(start));
  const newAmt = parseAmount(record.amount);
  const prior = priorAcMonthly(posted, record.contactId, startDay);
  const increase = prior > 0 && newAmt > prior;
  const continuation = prior > 0 && newAmt <= prior;
  const creditMonthly = increase ? roundCents(newAmt - prior) : continuation ? 0 : newAmt;
  return {
    id: record.id != null ? `rg-${record.id}` : record.id,
    contactId: record.contactId,
    contactName: record.contactName || "",
    giftDate: start,
    amount: creditMonthly,
    newMonthly: newAmt,
    priorMonthly: prior || null,
    acIncrease: increase,
    giftType: record.giftType || "Recurring",
    frequency: record.frequency || "Monthly",
    segment: record.segment,
    project: (des && (des.project || des.display)) || record.project || record.segment || "",
    recurringGiftId: record.id,
    solicitor: record.solicitor,
    customFields: record.customFields,
  };
}

/**
 * Merge posted gifts with RecurringGift rows. Monthly commitments replace the
 * matching posted installment so dollars are not counted twice. An AC raise
 * credits only (new monthly − prior monthly); a same-rate continuation is $0.
 */
export function prepareGifts(posted = [], recurring = []) {
  const monthly = recurring.filter((r) => /^monthly$/i.test(String(r.frequency || "").trim()));
  const asGifts = monthly
    .map((r) => recurringToGift(r, posted))
    .filter((g) => parseAmount(g.amount) > 0);
  const filtered = posted.filter((g) => {
    const cid = Number(g.contactId);
    if (!Number.isFinite(cid)) return true;
    return !monthly.some((rg) => (
      Number(rg.contactId) === cid
      && Math.abs(parseAmount(g.amount) - parseAmount(rg.amount)) <= INSTALLMENT_TOLERANCE
    ));
  });
  return [...filtered, ...asGifts];
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

/** Letters, emails, voicemails, and thank-yous do not pull gift dollars. */
const GIFT_ATTRIBUTION_BUCKETS = new Set([
  "conversation", "facetoface", "gift",
]);

/**
 * A "contact" that can surface a possible gift: they spoke with the donor
 * (phone, two-way email, or a meeting). Voicemail, letter, and email-sent
 * do not count — those are not a conversation.
 */
export const POSSIBLE_GIFT_TYPES = new Set([
  "mission advancement call | conversation",
  "mission advancement call | email conversation",
  "in person",
  "mission advancement | meeting",
]);

function daysFromNoteToGift(noteDate, giftDate) {
  const a = isoDay(noteDate);
  const b = isoDay(giftDate);
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

/** Closest conversation/meeting on or before the gift, within the 45-day window. */
export function nearestPossibleNote(giftDate, notesOnContact) {
  const before = SETTINGS.giftNoteDaysBefore ?? 45;
  let best = null;
  let bestScore = Infinity;
  for (const n of notesOnContact || []) {
    const key = (n.type || "").trim().toLowerCase();
    if (!POSSIBLE_GIFT_TYPES.has(key)) continue;
    const delta = daysFromNoteToGift(n.date, giftDate);
    if (delta == null) continue;
    if (delta < 0 || delta > before) continue;
    if (delta < bestScore) {
      bestScore = delta;
      best = n;
    }
  }
  return best ? { note: best, days: bestScore } : null;
}

/** Dollars follow a conversation, meeting, or donation note — not a letter or thank-you. */
export function ownerHintForGift(giftDate, notesOnContact) {
  const before = SETTINGS.giftNoteDaysBefore ?? 45;
  let best = null;
  let bestScore = Infinity;
  for (const n of notesOnContact || []) {
    if (n.assist) continue;
    if (!GIFT_ATTRIBUTION_BUCKETS.has(n.bucket)) continue;
    const delta = daysFromNoteToGift(n.date, giftDate);
    if (delta == null) continue;
    if (delta < 0 || delta > before) continue;
    if (delta < bestScore) {
      bestScore = delta;
      best = n.owner;
    }
  }
  return best;
}

/**
 * Score a Virtuous Gift as dollars received (0 points; the 100-pt credit
 * comes from the matching donation note so we don't double-count).
 * Owner is the MA who logged an activity note on the contact in the gift
 * window (`ownerHint`). GFT_Solicitor is never used — that is the MA or MGO
 * on the account, not who did the work. Returns null when amount is 0 or less.
 */
export function scoreGift(record, ownerHint = null) {
  const postedAmount = parseAmount(record.amount);
  if (postedAmount <= 0) return null;
  const monthly = isMonthlyRecurring(record);
  const factor = SETTINGS.monthlyAnnualizeFactor || 12;
  const amount = monthly ? roundCents(postedAmount * factor) : postedAmount;
  const solicitor = giftSolicitor(record);
  const owner = ownerHint;
  if (!owner) return null;
  const date = giftDateOf(record);
  if (!date) return null;
  if (beforeStart(date, owner)) return null;
  const increase = !!record.acIncrease;
  const priorMonthly = parseAmount(record.priorMonthly);
  const newMonthly = parseAmount(record.newMonthly) || postedAmount;
  const assist = isAssistGiftId(record.id);
  const label = assist
    ? "Assist (dollars not counted)"
    : increase
      ? `AC increase ($${priorMonthly} → $${newMonthly}/mo, annualized ×12)`
      : monthly
        ? "Monthly gift (annualized ×12)"
        : "Donation received";
  return {
    owner, type: "Gift", points: 0, amount: assist ? 0 : amount, postedAmount, annualized: monthly,
    acIncrease: increase, priorMonthly: priorMonthly || null, newMonthly: increase ? newMonthly : null,
    bucket: "donation",
    label,
    day: isoDay(date), date, weekday: isWeekday(date),
    contactId: record.contactId, contactName: record.contactName || "",
    giftId: record.id, giftType: record.giftType || "",
    frequency: record.frequency || (monthly ? "Monthly" : ""),
    project: giftProject(record), solicitor: solicitor || "",
    source: "gift", assist,
  };
}

function isAssistGiftId(giftId) {
  if (giftId == null || giftId === "") return false;
  const ids = SETTINGS.assistGiftIds || [];
  return ids.map(String).includes(String(giftId));
}

function sortByDayThenId(aDate, aId, bDate, bId) {
  const cmp = dayCmp(aDate, bDate);
  if (cmp) return cmp;
  return String(aId ?? "").localeCompare(String(bId ?? ""));
}

function matchableGift(record) {
  const postedAmount = parseAmount(record.amount);
  const date = giftDateOf(record);
  if (postedAmount <= 0 || !date) return null;
  return {
    contactId: record.contactId,
    contactName: record.contactName || "",
    date, day: isoDay(date), weekday: isWeekday(date),
    amount: postedAmount, postedAmount, giftId: record.id,
    matchOnly: true,
  };
}

function markAssist(gift) {
  gift.assist = true;
  gift.amount = 0;
  if (!gift.matchOnly) gift.label = "Assist (dollars not counted)";
}

/**
 * Score MA activity notes (and optional gifts) into a flat list of scored rows.
 *
 * Donation notes (bucket "gift") award 100 pts only after they pair with a
 * posted gift of amount > 0 on the same contact with giftDate on or after the
 * note date. Points are moved onto that gift's week. Unmatched donation notes
 * score 0 and leave the gift bucket. Gift Assist is the same 100 pts but does
 * not count dollars. A new monthly Recurring Gift is one gift (annualized
 * dollars) and one 100-pt credit; later installments of that commitment are
 * dropped in prepareGifts. An AC raise credits only (new − prior monthly) × 12.
 *
 * Posted gifts on a contact with a conversation/meeting in the 45-day window
 * and no matching donation or Gift Assist note become bucket "possible"
 * (0 pts, not Raised).
 */
export function scoreAll({ notes = [], gifts = [] }) {
  const rows = [];
  const donationNotes = [];
  const activityByContact = new Map();
  for (const n of notes) {
    const r = scoreNote(n);
    if (!r) continue;
    rows.push(r);
    if (r.bucket === "gift") donationNotes.push(r);
    if (r.contactId == null) continue;
    const list = activityByContact.get(r.contactId) || [];
    list.push(r);
    activityByContact.set(r.contactId, list);
  }

  const scoredGifts = [];
  const matchGifts = [];
  for (const g of gifts) {
    const gDate = giftDateOf(g);
    const hint = (g.contactId != null && gDate)
      ? ownerHintForGift(gDate, activityByContact.get(g.contactId) || [])
      : null;
    const r = scoreGift(g, hint);
    if (r) {
      if (!r.assist) rows.push(r);
      scoredGifts.push(r);
      matchGifts.push(r);
    } else {
      const skeleton = matchableGift(g);
      if (skeleton) matchGifts.push(skeleton);
    }
  }

  const giftsByContact = new Map();
  for (const g of matchGifts) {
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
    const window = SETTINGS.giftNoteDaysBefore ?? 45;
    const match = candidates.find((g) => {
      if (used.has(g)) return false;
      const dollars = g.postedAmount || g.amount || 0;
      if (dollars <= 0) return false;
      const cmp = dayCmp(g.date, note.date);
      if (cmp == null || cmp < 0) return false;
      const delta = daysFromNoteToGift(note.date, g.date);
      if (delta == null || delta > window) return false;
      return true;
    });
    if (match) {
      used.add(match);
      const dollars = match.postedAmount || match.amount || 0;
      note.date = match.date;
      note.day = match.day;
      note.weekday = match.weekday;
      note.giftId = match.giftId;
      note.giftAmount = dollars;
      match.securedNoteId = note.noteId;
      if (note.assist || match.assist) markAssist(match);
    } else {
      note.points = 0;
      note.bucket = "unmatched";
      note.unmatched = true;
    }
  }

  const securedIds = new Set(
    donationNotes.filter((n) => !n.unmatched && n.giftId != null).map((n) => String(n.giftId)),
  );
  for (const g of scoredGifts) {
    if (!g.assist) continue;
    if (securedIds.has(String(g.giftId))) continue;
    rows.push({
      owner: g.owner,
      type: "Mission Advancement | Gift Assist",
      points: 100,
      bucket: "gift",
      label: "Gift assist",
      day: g.day, date: g.date, weekday: g.weekday,
      contactId: g.contactId, contactName: g.contactName || "",
      giftId: g.giftId, giftAmount: g.postedAmount || 0,
      source: "assist-backfill",
      assist: true,
    });
    securedIds.add(String(g.giftId));
  }

  const raisedById = new Map(scoredGifts.map((g) => [String(g.giftId), g]));
  for (const g of gifts) {
    const gDate = giftDateOf(g);
    if (!gDate || g.contactId == null) continue;
    const postedAmount = parseAmount(g.amount);
    if (postedAmount <= 0) continue;
    const gid = g.id == null ? "" : String(g.id);
    if (gid && (securedIds.has(gid) || isAssistGiftId(g.id))) continue;
    const raised = gid ? raisedById.get(gid) : null;
    if (raised?.assist) continue;
    const hit = nearestPossibleNote(gDate, activityByContact.get(g.contactId) || []);
    if (!hit) continue;
    if (beforeStart(gDate, hit.note.owner)) continue;
    const monthly = isMonthlyRecurring(g);
    const factor = SETTINGS.monthlyAnnualizeFactor || 12;
    const amount = raised
      ? raised.amount
      : (monthly ? roundCents(postedAmount * factor) : postedAmount);
    rows.push({
      owner: hit.note.owner,
      type: "Possible gift",
      points: 0,
      amount,
      postedAmount: raised?.postedAmount ?? postedAmount,
      annualized: raised ? !!raised.annualized : monthly,
      bucket: "possible",
      label: "Possible gift",
      day: isoDay(gDate),
      date: gDate,
      weekday: isWeekday(gDate),
      contactId: g.contactId,
      contactName: g.contactName || hit.note.contactName || "",
      giftId: g.id,
      giftType: g.giftType || "",
      project: giftProject(g),
      noteId: hit.note.noteId,
      noteType: hit.note.type,
      noteLabel: hit.note.label,
      noteDay: hit.note.day,
      daysAfterNote: hit.days,
      inRaised: !!raised && (raised.amount || 0) > 0,
      source: "possible",
      possible: true,
    });
  }

  return rows.filter((r) => !(r.bucket === "donation" && (r.amount || 0) <= 0));
}

/** Score matched events for the display-only reference table. */
export function scoreEventsForDisplay(events = []) {
  return events.map(scoreEvent).filter(Boolean);
}
