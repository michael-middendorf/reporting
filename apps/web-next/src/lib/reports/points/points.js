/**
 * points.js — the scoring engine. Pure functions, no DOM, no I/O.
 * Turns raw Virtuous records into scored activity rows entirely client-side.
 */
import { POINTS_MAP, EVENT_POINTS_PER_HOUR, TRACKED_EVENT_TYPES, SETTINGS, MA_NAMES, MA_ROSTER } from "./config.js";
import { COUNTED_SPREADSHEET_GIFTS, matchCountedSpreadsheetGift } from "./counted-gifts.js";

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
function contactKey(id) {
  if (id == null || id === "") return null;
  const s = String(id).trim();
  return s && s !== "undefined" && s !== "null" ? s : null;
}

const DONATION_TYPE_ALIASES = {
  "new donation or new ac": "mission advancement | new donation or new ac",
  "new donation": "mission advancement | new donation or new ac",
  "new ac": "mission advancement | new donation or new ac",
  "annunciation circle updated": "mission advancement | annunciation circle updated",
  "update recurring gift": "mission advancement | update recurring gift",
  "updated recurring gift": "mission advancement | update recurring gift",
  "gift assist": "mission advancement | gift assist",
};

function mapNoteType(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (!raw) return raw;
  if (POINTS_MAP[raw]) return raw;
  const stripped = raw.replace(/^mission advancement( call)?\s*\|\s*/, "").trim();
  return DONATION_TYPE_ALIASES[stripped] || DONATION_TYPE_ALIASES[raw] || raw;
}

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

/**
 * Incoming-gift assignments saved on the dashboard become synthetic donation
 * notes so the chosen MA scores immediately. We do not write a note to Virtuous.
 */
export function assignedNotesFromFlags(flags = {}) {
  const out = [];
  for (const f of Object.values(flags || {})) {
    if (!f || f.status !== "assigned") continue;
    // MGO review assignments credit dollars in scoreAll; they are not gift notes.
    if (String(f.reason || "") === "mgo-review") continue;
    if (!f.owner || !f.contactId || !f.day) continue;
    const giftId = String(f.noteId || "").replace(/^gift:/, "");
    out.push({
      createdByUser: f.owner,
      type: f.type || "Mission Advancement | New Donation or New AC",
      noteDate: f.day,
      contactId: /^\d+$/.test(String(f.contactId)) ? Number(f.contactId) : f.contactId,
      contactName: f.contactName || "",
      id: giftId ? `assign-${giftId}` : f.noteId,
    });
  }
  return out;
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
  const key = mapNoteType(type);
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
 * Virtuous Event records do not score. Kept so callers can still list them
 * as reference-only rows with 0 points.
 */
export function scoreEvent(record) {
  const name = record.name || record.eventName || "";
  // Real Virtuous field is `startDateTime` ("7/16/2026 5:30:00 PM"); fall back
  // to the UTC create stamp.
  const date = parseDate(record.startDateTime || record.createDateTimeUtc);
  if (!date) return null;
  return {
    type: "Event", points: 0, bucket: "event",
    label: `Event (not scored): ${name}`,
    day: isoDay(date), date, weekday: isWeekday(date),
    eventId: record.id, eventName: name,
    source: "reporting", unmatched: true,
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

function daysBetweenIso(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

/**
 * Most recent Annunciation Circle monthly amount on this contact before `beforeDay`.
 * Tracker credits only the increase when an existing AC is raised. A gap longer
 * than acLapseDays means they canceled — the new signup is a full restart.
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
  if (!bestDay) return 0;
  const gap = daysBetweenIso(bestDay, beforeDay);
  const lapse = SETTINGS.acLapseDays ?? 45;
  if (gap != null && gap > lapse) return 0;
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

function matchesMonthlyInstallment(rg, gift) {
  const cid = Number(rg.contactId);
  if (!Number.isFinite(cid)) return false;
  return Number(gift.contactId) === cid
    && Math.abs(parseAmount(gift.amount) - parseAmount(rg.amount)) <= INSTALLMENT_TOLERANCE;
}

/**
 * RecurringGift rows copy RecurringGift.segment/project. If a matching posted
 * installment is MGO-coded and the RecurringGift is not (e.g. AC), keep MGO
 * so the merge does not auto-credit as Annunciation Circle.
 */
function withPostedMgoCoding(mapped, rg, posted) {
  if (isMgoAttributedGift(mapped)) return mapped;
  const mgoPosted = (posted || []).find((p) => matchesMonthlyInstallment(rg, p) && isMgoAttributedGift(p));
  if (!mgoPosted) return mapped;
  return {
    ...mapped,
    segment: mgoPosted.segment || mapped.segment,
    project: giftProject(mgoPosted) || mapped.project,
    solicitor: giftSolicitor(mgoPosted) || mapped.solicitor,
    customFields: mgoPosted.customFields || mapped.customFields,
  };
}

/**
 * Merge posted gifts with RecurringGift rows. Monthly commitments replace the
 * matching posted installment so dollars are not counted twice. An AC raise
 * credits only (new monthly − prior monthly); a same-rate continuation is $0.
 * MGO coding on a matched posted gift is kept on the replacement row.
 */
export function prepareGifts(posted = [], recurring = []) {
  const monthly = recurring.filter((r) => /^monthly$/i.test(String(r.frequency || "").trim()));
  const asGifts = monthly
    .map((r) => withPostedMgoCoding(recurringToGift(r, posted), r, posted))
    .filter((g) => parseAmount(g.amount) > 0 || parseAmount(g.newMonthly) > 0);
  const filtered = posted.filter((g) => !monthly.some((rg) => matchesMonthlyInstallment(rg, g)));
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

/** Virtuous segments that already mark the gift as MGO work. Exact match after trim. */
const MGO_ATTRIBUTED_SEGMENTS = new Set([
  "Direct Solicitation (MGO)",
  "Direct Solicitation (MGO)-HIST_DS",
]);

/**
 * True when Virtuous already coded the gift as MGO (or other non-MA officer) work.
 * Segment/project match is exact (not a fuzzy /MGO/ regex) so appeal mail stays in.
 * A nonempty GFT_Solicitor who is not on the MA roster is also MGO-attributed.
 */
export function isMgoAttributedGift(record) {
  if (!record) return false;
  const project = String(giftProject(record) || "").trim();
  const segment = String(record.segment || "").trim();
  if (MGO_ATTRIBUTED_SEGMENTS.has(project) || MGO_ATTRIBUTED_SEGMENTS.has(segment)) {
    return true;
  }
  const solicitor = giftSolicitor(record);
  return Boolean(solicitor && !rosterSet.has(solicitor));
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

/** Raised dollars require a donation note (or an Incoming / MGO assignment). */
const RAISED_HINT_BUCKETS = new Set(["gift"]);

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

/**
 * Every MA who spoke with the donor on or before the gift, within 45 days.
 * One closest note per MA. Sorted nearest-first so the first entry is the
 * primary association.
 */
export function possibleNotesForGift(giftDate, notesOnContact) {
  const before = SETTINGS.giftNoteDaysBefore ?? 45;
  const bestByOwner = new Map();
  for (const n of notesOnContact || []) {
    const key = (n.type || "").trim().toLowerCase();
    if (!POSSIBLE_GIFT_TYPES.has(key)) continue;
    if (n.assist) continue;
    const delta = daysFromNoteToGift(n.date, giftDate);
    if (delta == null || delta < 0 || delta > before) continue;
    if (beforeStart(giftDate, n.owner)) continue;
    const cur = bestByOwner.get(n.owner);
    if (!cur || delta < cur.days) bestByOwner.set(n.owner, { note: n, days: delta });
  }
  return [...bestByOwner.values()].sort(
    (a, b) => a.days - b.days || String(a.note.owner).localeCompare(String(b.note.owner)),
  );
}

/** Closest conversation/meeting on or before the gift, within the 45-day window. */
export function nearestPossibleNote(giftDate, notesOnContact) {
  return possibleNotesForGift(giftDate, notesOnContact)[0] || null;
}

/** AC, Mission Fund, or other — used by Incoming Gifts. */
export function giftKindOf(record) {
  const blob = `${record.segment || ""} ${record.project || ""} ${giftProject(record)}`;
  if (record.acIncrease) return "ac-increase";
  if (/annunciation/i.test(blob) || isMonthlyRecurring(record)) return "ac";
  if (/mission fund/i.test(blob)) return "mission-fund";
  return "one-time";
}

export function giftKindLabel(kind, annualized) {
  if (kind === "ac-increase") return "AC increase";
  if (kind === "ac") return annualized ? "AC (monthly ×12)" : "Annunciation Circle";
  if (kind === "mission-fund") return "Mission Fund";
  return annualized ? "Monthly ×12" : "One-time";
}

function ownerHintFromBuckets(giftDate, notesOnContact, buckets) {
  const before = SETTINGS.giftNoteDaysBefore ?? 45;
  let best = null;
  let bestScore = Infinity;
  for (const n of notesOnContact || []) {
    if (n.assist) continue;
    if (!buckets.has(n.bucket)) continue;
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

/** Raised dollars follow a donation note — not a conversation, letter, or thank-you. */
export function ownerHintForGift(giftDate, notesOnContact) {
  return ownerHintFromBuckets(giftDate, notesOnContact, RAISED_HINT_BUCKETS);
}

/** Closest conversation, meeting, or donation note — used for MGO review listing. */
export function ownerHintForReview(giftDate, notesOnContact) {
  return ownerHintFromBuckets(giftDate, notesOnContact, GIFT_ATTRIBUTION_BUCKETS);
}

/**
 * Build a donation row for a roster MA. Does not apply the MGO auto-exclude
 * (callers decide). Returns null when amount is 0, date is missing, or the
 * gift is before the owner's roster start.
 */
function donationRow(record, owner) {
  const postedAmount = parseAmount(record.amount);
  if (postedAmount <= 0) return null;
  if (!owner || !rosterSet.has(owner)) return null;
  const monthly = isMonthlyRecurring(record);
  const factor = SETTINGS.monthlyAnnualizeFactor || 12;
  const amount = monthly ? roundCents(postedAmount * factor) : postedAmount;
  const solicitor = giftSolicitor(record);
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

/**
 * Roster MA credited by an "assigned" flag on `gift:{id}`, else null.
 * Only status "assigned" counts. Do not POST "removed" on this key (Tasks
 * must not offer Count/Remove for MGO assign rows).
 */
function assignedOwnerForGift(gift, hint, flags) {
  const id = gift?.id != null && gift.id !== "" ? `gift:${gift.id}` : null;
  if (!id || !flags) return null;
  const flag = flags[id];
  if (!flag || flag.status !== "assigned") return null;
  if (flag.owner && rosterSet.has(flag.owner)) return flag.owner;
  if (!flag.owner && hint && rosterSet.has(hint)) return hint;
  return null;
}

/**
 * Score a Virtuous Gift as dollars received (0 points on this row; the 100-pt
 * credit comes from the matching donation note, or a backfill so Raised never
 * exists without 100 pts). Owner is the MA who logged a donation note on the
 * contact in the gift window (`ownerHint`), or `assignedOwner`. A conversation
 * or meeting alone does not put the gift in Raised — that is Incoming.
 * GFT_Solicitor is never used for owner. Gifts Virtuous coded as MGO work
 * return null unless `assignedOwner` is a roster MA. Returns null when amount
 * is 0 or less.
 */
export function scoreGift(record, ownerHint = null, assignedOwner = null) {
  const postedAmount = parseAmount(record.amount);
  if (postedAmount <= 0) return null;
  const credited = assignedOwner && rosterSet.has(assignedOwner) ? assignedOwner : null;
  if (isMgoAttributedGift(record) && !credited) return null;
  const owner = credited || ownerHint;
  if (!owner) return null;
  return donationRow(record, owner);
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

/**
 * Pair a donation note with a posted gift on the same contact.
 * MAs often log New Donation after the gift posts, so gifts up to 45 days
 * before the note count as well as gifts up to 45 days after. Prefer the
 * closest date; a gift on or after the note wins ties.
 */
function pickDonationMatch(note, candidates, used, window) {
  let best = null;
  let bestScore = Infinity;
  for (const g of candidates) {
    if (used.has(g)) continue;
    const dollars = g.postedAmount || g.amount || 0;
    if (dollars <= 0) continue;
    const delta = daysFromNoteToGift(note.date, g.date);
    if (delta == null || Math.abs(delta) > window) continue;
    const score = Math.abs(delta) * 2 + (delta < 0 ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return best;
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
 * posted gift of amount > 0 on the same contact within 45 days of the note
 * (before or after — MAs often log the note after the gift posts). Points
 * are moved onto that gift's week. Unmatched donation notes
 * score 0 and leave the gift bucket. Gift Assist is the same 100 pts but does
 * not count dollars. A new monthly Recurring Gift is one gift (annualized
 * dollars) and one 100-pt credit; later installments of that commitment are
 * dropped in prepareGifts. An AC raise credits only (new − prior monthly) × 12.
 *
 * Posted gifts on a contact with a conversation/meeting in the 45-day window
 * and no matching donation or Gift Assist note become bucket "possible"
 * (Incoming: 0 pts, not Raised). Raised dollars always pair with 100 pts.
 *
 * `flags` is the shared review-flags map (same object aggregate uses). An
 * MGO-coded gift with status "assigned" and a roster `flag.owner` scores as
 * a normal donation. An unassigned MGO gift with an MA note in the window
 * is emitted with `needsReview: true` (listed, not added to Raised).
 */
export function scoreAll({ notes = [], gifts = [], flags = {}, countedGifts }) {
  const rows = [];
  const donationNotes = [];
  const activityByContact = new Map();
  const countedUsed = new Set();
  for (const n of notes) {
    const r = scoreNote(n);
    if (!r) continue;
    rows.push(r);
    if (r.bucket === "gift") donationNotes.push(r);
    const ck = contactKey(r.contactId);
    if (!ck) continue;
    const list = activityByContact.get(ck) || [];
    list.push(r);
    activityByContact.set(ck, list);
  }

  const scoredGifts = [];
  const matchGifts = [];
  for (const g of gifts) {
    const gDate = giftDateOf(g);
    const ck = contactKey(g.contactId);
    const notesOnContact = ck ? (activityByContact.get(ck) || []) : [];
    const reviewHint = gDate ? ownerHintForReview(gDate, notesOnContact) : null;
    const giftHint = gDate ? ownerHintForGift(gDate, notesOnContact) : null;
    const sheetHit = matchCountedSpreadsheetGift(
      {
        ...g,
        day: gDate ? isoDay(gDate) : null,
        postedAmount: parseAmount(g.amount) || parseAmount(g.newMonthly),
        amount: parseAmount(g.amount) || parseAmount(g.newMonthly),
        newMonthly: parseAmount(g.newMonthly),
      },
      countedGifts === undefined ? COUNTED_SPREADSHEET_GIFTS : countedGifts,
      countedUsed,
    );
    if (sheetHit) {
      countedUsed.add(sheetHit.index);
      const r = scoreGift(
        {
          ...g,
          amount: sheetHit.row.amount,
          frequency: "",
          acIncrease: false,
          priorMonthly: null,
        },
        sheetHit.owner,
        sheetHit.owner,
      );
      if (r) {
        const credited = {
          ...r,
          amount: sheetHit.row.amount,
          postedAmount: sheetHit.row.amount,
          annualized: !!sheetHit.row.monthly,
          acIncrease: false,
          source: "spreadsheet",
          label: "Counted on MA tracker",
        };
        rows.push(credited);
        scoredGifts.push(credited);
        matchGifts.push(credited);
        continue;
      }
    }
    if (isMgoAttributedGift(g)) {
      const assigned = assignedOwnerForGift(g, reviewHint, flags);
      if (assigned) {
        const r = scoreGift(g, giftHint, assigned);
        if (r) {
          const credited = { ...r, mgoAssigned: true };
          if (!credited.assist) rows.push(credited);
          scoredGifts.push(credited);
          matchGifts.push(credited);
        }
      } else if (reviewHint && rosterSet.has(reviewHint)) {
        const r = donationRow(g, reviewHint);
        if (r) rows.push({ ...r, needsReview: true });
      }
      continue;
    }
    if (isAssistGiftId(g.id) && reviewHint) {
      const r = scoreGift(g, reviewHint);
      if (r) {
        scoredGifts.push(r);
        matchGifts.push(r);
      }
      continue;
    }
    const skeleton = matchableGift(g);
    if (skeleton) matchGifts.push(skeleton);
  }

  const giftsByContact = new Map();
  for (const g of matchGifts) {
    const ck = contactKey(g.contactId);
    if (!ck) continue;
    const list = giftsByContact.get(ck) || [];
    list.push(g);
    giftsByContact.set(ck, list);
  }
  for (const list of giftsByContact.values()) {
    list.sort((a, b) => sortByDayThenId(a.date, a.giftId, b.date, b.giftId));
  }

  const used = new Set();
  const notesInOrder = [...donationNotes].sort(
    (a, b) => sortByDayThenId(a.date, a.noteId, b.date, b.noteId),
  );
  for (const note of notesInOrder) {
    const candidates = (() => {
      const ck = contactKey(note.contactId);
      return ck ? (giftsByContact.get(ck) || []) : [];
    })();
    const window = SETTINGS.giftNoteDaysBefore ?? 45;
    const match = pickDonationMatch(note, candidates, used, window);
    if (match) {
      used.add(match);
      if (match.matchOnly && note.owner) {
        const raw = gifts.find((g) => String(g.id) === String(match.giftId));
        const full = raw ? scoreGift(raw, note.owner) : null;
        if (full) {
          Object.assign(match, full);
          if (!match.assist) rows.push(match);
        }
      }
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
  for (const g of scoredGifts) {
    if (g.assist) continue;
    if ((g.amount || 0) <= 0) continue;
    if (securedIds.has(String(g.giftId))) continue;
    rows.push({
      owner: g.owner,
      type: "Mission Advancement | New Donation or New AC",
      points: 100,
      bucket: "gift",
      label: "Secured gift",
      day: g.day, date: g.date, weekday: g.weekday,
      contactId: g.contactId, contactName: g.contactName || "",
      giftId: g.giftId, giftAmount: g.postedAmount || g.amount || 0,
      source: "raised-backfill",
    });
    securedIds.add(String(g.giftId));
  }

  const raisedById = new Map(scoredGifts.map((g) => [String(g.giftId), g]));
  for (const g of gifts) {
    if (isMgoAttributedGift(g)) continue;
    const gDate = giftDateOf(g);
    if (!gDate || g.contactId == null) continue;
    const postedAmount = parseAmount(g.amount);
    if (postedAmount <= 0) continue;
    const gid = g.id == null ? "" : String(g.id);
    if (gid && (securedIds.has(gid) || isAssistGiftId(g.id))) continue;
    const raised = gid ? raisedById.get(gid) : null;
    if (raised?.assist) continue;
    const notesOnContact = (() => {
      const ck = contactKey(g.contactId);
      return ck ? (activityByContact.get(ck) || []) : [];
    })();
    const donationOnContact = notesOnContact.some((n) => {
      if (n.assist) return false;
      const mapped = mapNoteType(n.type);
      if (!POINTS_MAP[mapped] || POINTS_MAP[mapped].bucket !== "gift") return false;
      const delta = daysFromNoteToGift(n.date, gDate);
      const window = SETTINGS.giftNoteDaysBefore ?? 45;
      return delta != null && Math.abs(delta) <= window;
    });
    if (donationOnContact) continue;
    const hits = possibleNotesForGift(gDate, notesOnContact);
    if (!hits.length) continue;
    const hit = hits[0];
    const monthly = isMonthlyRecurring(g);
    const factor = SETTINGS.monthlyAnnualizeFactor || 12;
    const amount = raised
      ? raised.amount
      : (monthly ? roundCents(postedAmount * factor) : postedAmount);
    const annualized = raised ? !!raised.annualized : monthly;
    const kind = giftKindOf({ ...g, acIncrease: raised?.acIncrease || g.acIncrease });
    rows.push({
      owner: hit.note.owner,
      owners: hits.map((h) => ({
        name: h.note.owner,
        noteId: h.note.noteId,
        noteType: h.note.type,
        noteLabel: h.note.label,
        noteDay: h.note.day,
        daysAfterNote: h.days,
      })),
      type: "Incoming gift",
      points: 0,
      amount,
      postedAmount: raised?.postedAmount ?? postedAmount,
      annualized,
      kind,
      kindLabel: giftKindLabel(kind, annualized),
      bucket: "possible",
      label: "Incoming gift",
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

const trackedTypeById = new Map(TRACKED_EVENT_TYPES.map((t) => [t.id, t]));

/** YYYY-MM-DD as a local calendar date (not UTC midnight). */
function parseLocalDay(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return parseDate(value);
}

/** Hours × 25. Reporting-only dashboard events, not Virtuous records. */
export function eventPointsForHours(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n * EVENT_POINTS_PER_HOUR;
}

/**
 * Score events added on the Points dashboard. Points = hours × 25.
 * These rows are attributed to the chosen MA and counted in dashboard totals.
 */
export function scoreTrackedEvents(events = []) {
  const rows = [];
  for (const event of events || []) {
    const row = scoreTrackedEvent(event);
    if (row) rows.push(row);
  }
  return rows;
}

export function scoreTrackedEvent(event) {
  if (!event) return null;
  const owner = String(event.owner || "").replace(/\s+/g, " ").trim();
  if (!rosterSet.has(owner)) return null;
  const date = parseLocalDay(event.day);
  if (!date) return null;
  if (beforeStart(date, owner)) return null;
  const hours = Number(event.hours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const points = eventPointsForHours(hours);
  if (points <= 0) return null;
  const preset = trackedTypeById.get(event.eventType) || TRACKED_EVENT_TYPES.find((t) => t.type === event.eventType);
  const type = preset?.type || String(event.eventType || "Mission Advancement | Event").trim();
  const typeLabel = preset?.label || type;
  const name = String(event.name || "").trim();
  const hrsLabel = `${hours} ${hours === 1 ? "hr" : "hrs"}`;
  const label = name ? `${typeLabel} · ${hrsLabel} · ${name}` : `${typeLabel} · ${hrsLabel}`;
  const id = event.id != null && event.id !== "" ? String(event.id) : null;
  return {
    owner,
    type,
    points,
    bucket: "event",
    label,
    day: isoDay(date),
    date,
    weekday: isWeekday(date),
    hours,
    eventName: name,
    eventId: id,
    noteId: id ? `event:${id}` : null,
    source: "reporting",
    tracked: true,
  };
}
