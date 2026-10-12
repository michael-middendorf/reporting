/**
 * points.js — the scoring engine. Pure functions, no DOM, no I/O.
 * Turns raw Virtuous records into scored activity rows entirely client-side.
 */
import { POINTS_MAP, EVENT_POINTS_PER_HOUR, TRACKED_EVENT_TYPES, RETIRED_TRACKED_EVENT_TYPES, SETTINGS, MA_NAMES, MA_ROSTER } from "./config.js";

/** Normalize a Virtuous date string ("8/4/2026" or ISO) to a Date (local). */
export function parseDate(value) {
  if (!value) return null;
  const isoDayOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDayOnly) return new Date(+isoDayOnly[1], +isoDayOnly[2] - 1, +isoDayOnly[3]);
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
const rosterByEmail = new Map(
  MA_ROSTER.map((m) => [String(m.email || "").trim().toLowerCase(), m.name]),
);
const rosterByName = new Map(
  MA_ROSTER.map((m) => [normalizePersonName(m.name), m.name]),
);

function normalizePersonName(value) {
  return String(value || "").toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
}

function addRosterEmail(hits, value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email.includes("@")) return;
  const owner = rosterByEmail.get(email);
  if (owner) hits.add(owner);
}

/**
 * The roster officer who is this donor, or null.
 * A household named exactly like the officer counts. So does a roster email
 * on the contact, and a nickname that is not the legal first name
 * ("Betsy Scaletty" on Grant and Elizabeth Scaletty). Another household that
 * only shares a first and last name does not.
 */
export function rosterDonorOwner(record) {
  if (!record || typeof record !== "object") return null;
  const stamped = String(record.selfOwner || "").replace(/\s+/g, " ").trim();
  if (stamped && rosterSet.has(stamped)) return stamped;
  const hits = new Set();
  addRosterEmail(hits, record.email);
  const people = record.contactIndividuals || record.individuals || [];
  for (const person of Array.isArray(people) ? people : []) {
    if (!person || typeof person !== "object") continue;
    addRosterEmail(hits, person.email);
    for (const method of person.contactMethods || []) addRosterEmail(hits, method?.value);
    const first = normalizePersonName(person.firstName);
    const last = normalizePersonName(person.lastName);
    const nick = normalizePersonName(person.nickname);
    if (nick && last && nick !== first) {
      const owner = rosterByName.get(`${nick} ${last}`);
      if (owner) hits.add(owner);
    }
  }
  for (const candidate of [contactDisplayName(record), record.contactName, record.name]) {
    const owner = rosterByName.get(normalizePersonName(candidate));
    if (owner) hits.add(owner);
  }
  if (hits.size !== 1) return null;
  return [...hits][0];
}

/**
 * An officer's own monthly commitment counts with the other gifts.
 * One that started before that officer's roster start stays out, so later
 * installments are not folded into a date the scorer drops.
 */
export function selfRecurringCounts(record, owner) {
  if (!owner || !rosterSet.has(owner)) return false;
  if (record?.priorOnly) return false;
  const start = startByOwner.get(owner);
  if (!start) return true;
  const day = isoDay(parseDate(record.startDate || record.recurringGiftDate || record.giftDate));
  if (!day) return true;
  return day >= start;
}
function contactKey(id) {
  if (id == null || id === "") return null;
  const s = String(id).trim();
  return s && s !== "undefined" && s !== "null" ? s : null;
}

/**
 * contactId → roster MA name from the portfolios snapshot.
 * Only team "ma" solicitors on the roster count. A donor on two MA
 * portfolios is left unset so the gift is not guessed.
 */
export function portfolioOwnersFromSnapshot(snapshot) {
  const owners = {};
  const blocked = new Set();
  for (const person of snapshot?.solicitors || []) {
    if (String(person?.team || "") !== "ma") continue;
    const name = String(person?.name || "").replace(/\s+/g, " ").trim();
    if (!rosterSet.has(name)) continue;
    for (const stage of person.stages || []) {
      for (const donor of stage?.donors || []) {
        const key = contactKey(donor?.contactId);
        if (!key || blocked.has(key)) continue;
        if (owners[key] && owners[key] !== name) {
          delete owners[key];
          blocked.add(key);
          continue;
        }
        owners[key] = name;
      }
    }
  }
  return owners;
}

function portfolioOwnerFor(contactId, portfolios) {
  const key = contactKey(contactId);
  if (!key || !portfolios) return null;
  const name = String(portfolios[key] || "").replace(/\s+/g, " ").trim();
  return rosterSet.has(name) ? name : null;
}

function groupByContact(items, idOf) {
  const map = new Map();
  for (const item of items || []) {
    const key = contactKey(idOf(item));
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function noteDayOf(note) {
  const date = note?.date instanceof Date
    ? note.date
    : (parseDate(note?.noteDate) || parseDate(note?.createDateTimeUtc));
  return isoDay(date);
}

/** One-time or Recurring, plus the donor's previous gift and latest note. */
function incomingFacts(record, notesByContact, giftsByContact) {
  const key = contactKey(record?.contactId);
  const giftDay = isoDay(giftDateOf(record));
  const schedule = isMonthlyRecurring(record) ? "Recurring" : "One-time";
  let lastGiftDay = null;
  let lastGiftSchedule = null;
  if (key && giftDay) {
    for (const other of giftsByContact.get(key) || []) {
      if (other === record) continue;
      if (record?.id != null && other?.id != null && String(other.id) === String(record.id)) continue;
      const day = isoDay(giftDateOf(other));
      if (!day || day >= giftDay) continue;
      if (!lastGiftDay || day > lastGiftDay) {
        lastGiftDay = day;
        lastGiftSchedule = isMonthlyRecurring(other) ? "Recurring" : "One-time";
      }
    }
  }
  let lastNoteDay = null;
  let lastNoteType = null;
  if (key) {
    for (const note of notesByContact.get(key) || []) {
      const day = noteDayOf(note);
      if (!day) continue;
      if (lastNoteDay && day <= lastNoteDay) continue;
      lastNoteDay = day;
      const mapped = mapNoteType(note.type || note.label || "");
      lastNoteType = (POINTS_MAP[mapped] && POINTS_MAP[mapped].label) || note.label || note.type || "";
    }
  }
  return { schedule, lastGiftDay, lastGiftSchedule, lastNoteDay, lastNoteType: lastNoteType || null };
}

/** Household ids Virtuous soft-credits on a DAF / foundation gift. */
export function passthroughContactIds(record) {
  if (!record || typeof record !== "object") return [];
  const ids = [];
  const seen = new Set();
  const add = (value) => {
    const cid = Number(value);
    if (!Number.isFinite(cid) || seen.has(cid)) return;
    seen.add(cid);
    ids.push(cid);
  };
  add(record.contactPassthroughId);
  const people = record.giftPassthroughs;
  if (Array.isArray(people)) {
    for (const person of people) {
      if (person && typeof person === "object") add(person.contactId);
    }
  }
  return ids;
}

/** First passthrough household on a gift, if Virtuous attached one. */
export function passthroughHousehold(record) {
  const ids = passthroughContactIds(record);
  if (!ids.length) return null;
  const people = Array.isArray(record?.giftPassthroughs) ? record.giftPassthroughs : [];
  const named = people.find((p) => Number(p?.contactId) === ids[0]);
  const contactName = String(named?.contactName || "").trim();
  return { contactId: ids[0], contactName };
}

/**
 * Score a pass-through gift on the household the MA spoke with, not the DAF.
 * Idempotent when `legalContactId` is already set.
 */
export function applyPassthroughCredit(record, names = null) {
  if (!record || typeof record !== "object") return record;
  if (record.legalContactId != null) return record;
  const household = passthroughHousehold(record);
  if (!household) return record;
  const fromMap = names && typeof names.get === "function" ? names.get(household.contactId) : "";
  const contactName = household.contactName || fromMap || "";
  return {
    ...record,
    legalContactId: record.contactId,
    legalContactName: record.contactName || "",
    contactId: household.contactId,
    contactName: contactName || record.contactName || "",
  };
}

/** Virtuous Gift Query, FullContact, and notes use different name fields. */
export function contactDisplayName(record) {
  if (!record || typeof record !== "object") return "";
  const nested = record.contact && typeof record.contact === "object" ? record.contact : {};
  const people = record.contactIndividuals
    || record.individuals
    || nested.contactIndividuals
    || nested.individuals
    || record.giftPassthroughs
    || [];
  const fromPeople = (Array.isArray(people) ? people : [])
    .map((p) => {
      if (!p || typeof p !== "object") return "";
      return String(p.contactName || [p.firstName, p.lastName].filter(Boolean).join(" ") || "").trim();
    })
    .filter(Boolean)
    .join(" and ");
  const parts = [
    record.contactName,
    record.name,
    record.formalName,
    record.formalContactName,
    record.informalName,
    nested.contactName,
    nested.name,
    nested.formalName,
    nested.informalName,
    [record.firstName, record.lastName].filter(Boolean).join(" "),
    [nested.firstName, nested.lastName].filter(Boolean).join(" "),
    fromPeople,
  ];
  for (const p of parts) {
    const s = String(p || "").trim();
    if (s) return s;
  }
  return "";
}

const DONATION_TYPE_ALIASES = {
  "new donation or new ac": "mission advancement | new donation or new ac",
  "new donation": "mission advancement | new donation or new ac",
  "new ac": "mission advancement | new donation or new ac",
  "annunciation circle updated": "mission advancement | annunciation circle updated",
  "update recurring gift": "mission advancement | update recurring gift",
  "updated recurring gift": "mission advancement | update recurring gift",
  "gift assist": "mission advancement | gift assist",
  "verbal gift commitment": "mission advancement | verbal gift commitment",
  "verbal commitment": "mission advancement | verbal gift commitment",
};

function mapNoteType(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (!raw) return raw;
  if (POINTS_MAP[raw]) return raw;
  const stripped = raw.replace(/^mission advancement( call)?\s*\|\s*/, "").trim();
  return DONATION_TYPE_ALIASES[stripped] || DONATION_TYPE_ALIASES[raw] || raw;
}

/** True when isoDay(date) is before the owner's optional roster startDate. */
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
      assignsGiftId: giftId || null,
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
      contactId: record.contactId, contactName: contactDisplayName(record),
      noteId: record.id, source: "unmatched", unmatched: true,
    };
  }

  let points = rule.points;
  if (rule.conflict === "invalid_number" && SETTINGS.invalidNumberScores) points = 1;

  return {
    owner, type, points, bucket: rule.bucket, label: rule.label,
    day: isoDay(date), date, weekday: isWeekday(date),
    contactId: record.contactId, contactName: contactDisplayName(record),
    noteId: record.id, source: rule.source, conflict: rule.conflict || null,
    assist: !!rule.assist,
    text: plainNote(record.note),
    assignsGiftId: record.assignsGiftId || null,
  };
}

function plainNote(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** A thank-you logged just after a gift does not claim that gift. */
export function isThankYouNote(note) {
  const blob = plainNote(`${note?.text || ""} ${note?.label || ""}`);
  return /\bty\s*cc\b|\btycc\b|\bthank(?:s| you)\b|(?:^|[\s-])ty(?:[\s-]|$)/i.test(blob);
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

function recurringIsActive(record) {
  const status = recurringStatusKey(record);
  return status === "uptodate" || status === "active";
}

/** Another Annunciation Circle monthly on this contact is still charging. */
function activeCircleStillRunning(recurring, record) {
  const cid = Number(record?.contactId);
  if (!Number.isFinite(cid)) return false;
  return (recurring || []).some((r) => {
    if (String(r.id) === String(record.id)) return false;
    if (Number(r.contactId) !== cid) return false;
    if (!recurringIsActive(r)) return false;
    if (!/^monthly$/i.test(String(r.frequency || "").trim())) return false;
    if (isAcGift(r)) return true;
    const des = r.designations || r.giftDesignations || [];
    return Array.isArray(des) && des.some((d) => /annunciation/i.test(String(d?.project || d?.display || "")));
  });
}

/** Dollars designated to the Mission Fund, excluding donor-paid fees. */
function missionFundDesignated(record) {
  const rows = record?.designations || record?.giftDesignations || [];
  if (!Array.isArray(rows)) return 0;
  let sum = 0;
  for (const d of rows) {
    const project = String(d?.project || d?.display || "");
    if (!/mission fund/i.test(project)) continue;
    sum = roundCents(sum + parseAmount(d?.amountDesignated));
  }
  return sum;
}

function daysBetweenIso(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

/** Calendar day from a Virtuous date or datetime, without a timezone shift. */
function calendarDay(value) {
  if (value == null || value === "") return null;
  const iso = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return isoDay(parseDate(value));
}

function recurringStatusKey(record) {
  return String(record?.status || record?.recurringStatus || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Rows the publisher loaded only so a later gift can see the old monthly amount. */
function isPriorOnlyRecurring(record) {
  return record?.priorOnly === true || record?.priorOnly === "true";
}

function isCancelledRecurring(record) {
  if (isPriorOnlyRecurring(record)) return true;
  const status = recurringStatusKey(record);
  return status === "cancelled" || status === "canceled";
}

function cancelDayOf(record) {
  return calendarDay(
    record?.cancelDateTimeUtc
    || record?.cancelDate
    || record?.canceledDate
    || record?.cancelDateUtc,
  );
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

/**
 * Monthly amount cancelled within acLapseDays before the new gift starts.
 * The cancelled gift can be Mission Fund or any other project. The latest
 * cancellation wins. Two on the same day use the larger amount.
 */
function priorCancelledMonthly(recurring, contactId, startRaw, excludeId) {
  const cid = Number(contactId);
  const beforeDay = calendarDay(startRaw);
  if (!Number.isFinite(cid) || !beforeDay) return 0;
  const lapse = SETTINGS.acLapseDays ?? 45;
  let bestDay = "";
  let bestAmt = 0;
  for (const r of recurring || []) {
    if (excludeId != null && String(r.id) === String(excludeId)) continue;
    if (Number(r.contactId) !== cid) continue;
    if (!isCancelledRecurring(r)) continue;
    if (!/^monthly$/i.test(String(r.frequency || "").trim())) continue;
    const amt = parseAmount(r.amount);
    if (amt <= 0) continue;
    const day = cancelDayOf(r);
    if (!day || day > beforeDay) continue;
    const gap = daysBetweenIso(day, beforeDay);
    if (gap == null || gap > lapse) continue;
    if (day > bestDay || (day === bestDay && amt > bestAmt)) {
      bestDay = day;
      bestAmt = amt;
    }
  }
  return bestAmt;
}

/**
 * Earliest posted installment at this RecurringGift's current monthly amount.
 * When Virtuous edits the amount on an existing RG, startDate stays the old
 * start and this installment is the first charge at the new rate.
 */
function firstInstallmentAtAmount(posted, record) {
  const cid = Number(record.contactId);
  const amt = parseAmount(record.amount);
  if (!Number.isFinite(cid) || amt <= 0) return null;
  const acOnly = isAcGift(record);
  let best = null;
  let bestDay = "";
  for (const g of posted || []) {
    if (Number(g.contactId) !== cid) continue;
    if (acOnly && !isAcGift(g)) continue;
    if (Math.abs(parseAmount(g.amount) - amt) > INSTALLMENT_TOLERANCE) continue;
    const d = isoDay(parseDate(g.giftDate || g.giftDateFormatted));
    if (!d) continue;
    if (!bestDay || d < bestDay) {
      bestDay = d;
      best = g;
    }
  }
  return best;
}

/** Map a Virtuous RecurringGift onto the gift shape the scorer already uses. */
export function recurringToGift(record, posted = [], recurring = []) {
  const des = (record.designations && record.designations[0])
    || (record.giftDesignations && record.giftDesignations[0]);
  const start = record.startDate || record.recurringGiftDate || record.giftDate;
  const startDay = calendarDay(start);
  const newAmt = parseAmount(record.amount);
  const firstNew = firstInstallmentAtAmount(posted, record);
  const firstNewDay = firstNew
    ? isoDay(parseDate(firstNew.giftDate || firstNew.giftDateFormatted))
    : null;
  const raiseDay = firstNewDay && startDay && firstNewDay > startDay ? firstNewDay : startDay;
  const inPlaceAmountChange = !!(firstNewDay && startDay && firstNewDay > startDay);
  const circlePrior = priorAcMonthly(posted, record.contactId, raiseDay);
  const cancelledPrior = priorCancelledMonthly(recurring, record.contactId, raiseDay || start, record.id);
  // Wagner's August Mission Fund is $25 a month beside a Circle that is
  // still charging. Count that $25 for the full year. The $1.06 donor-paid
  // fee stays off the credit. The September $20.91 gift stays an increase
  // of the $11.10 Circle. No other donor uses this exception.
  const missionDesignated = missionFundDesignated(record);
  const separateActiveGift = Number(record.contactId) === 106479
    && missionDesignated === 25
    && !isAcGift(record)
    && recurringIsActive(record)
    && !inPlaceAmountChange
    && activeCircleStillRunning(recurring, record)
    && circlePrior > 0
    && cancelledPrior <= 0;
  const prior = Math.max(separateActiveGift ? 0 : circlePrior, cancelledPrior);
  const increase = prior > 0 && newAmt > prior;
  const continuation = prior > 0 && newAmt <= prior;
  const creditMonthly = separateActiveGift
    ? missionDesignated
    : increase ? roundCents(newAmt - prior) : continuation ? 0 : newAmt;
  const inPlaceRaise = !!(inPlaceAmountChange && increase);
  const fullMonthly = separateActiveGift && !increase;
  return {
    id: inPlaceRaise && firstNew.id != null
      ? firstNew.id
      : (record.id != null ? `rg-${record.id}` : record.id),
    contactId: record.contactId,
    contactName: contactDisplayName(record),
    giftDate: inPlaceRaise ? (firstNew.giftDate || raiseDay) : start,
    amount: creditMonthly,
    newMonthly: separateActiveGift ? creditMonthly : newAmt,
    priorMonthly: prior || null,
    acIncrease: increase,
    fullMonthly,
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
 * matching posted installment so dollars are not counted twice. An increase
 * credits only (new monthly − prior monthly). The prior is the recent
 * Annunciation Circle payment or a monthly gift cancelled within 45 days,
 * whichever is higher. A same-rate or lower continuation is $0.
 * Wagner's $25 Mission Fund, still charging beside the Circle, counts as
 * $25 a month for the year. Other gifts beside a Circle credit only the increase.
 * `priorOnly` rows are evidence for that prior amount. They are not gifts.
 * MGO coding on a matched posted gift is kept on the replacement row.
 */
export function prepareGifts(posted = [], recurring = []) {
  const monthly = (recurring || []).filter((r) => /^monthly$/i.test(String(r.frequency || "").trim()));
  const scoreable = monthly.filter((r) => !isPriorOnlyRecurring(r));
  const asGifts = scoreable
    .map((r) => {
      const mapped = withPostedMgoCoding(recurringToGift(r, posted, monthly), r, posted);
      if (contactDisplayName(mapped)) return mapped;
      const named = (posted || []).find((p) => Number(p.contactId) === Number(r.contactId) && contactDisplayName(p));
      return named ? { ...mapped, contactName: contactDisplayName(named) } : mapped;
    })
    .filter((g) => parseAmount(g.amount) > 0 || parseAmount(g.newMonthly) > 0);
  const filtered = (posted || []).filter((g) => !scoreable.some((rg) => matchesMonthlyInstallment(rg, g)));
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
 * (phone, two-way email, a text reply, or a meeting). Voicemail, letter,
 * email-sent, and an outbound text do not count — those are not a conversation.
 */
export const POSSIBLE_GIFT_TYPES = new Set([
  "mission advancement call | conversation",
  "mission advancement call | email conversation",
  "ma text returned",
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
 * Every MA who spoke with the donor on or before the gift, within 90 days.
 * One closest note per MA. Sorted nearest-first so the first entry is the
 * primary association.
 */
export function possibleNotesForGift(giftDate, notesOnContact) {
  const before = SETTINGS.giftNoteDaysBefore ?? 90;
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

/**
 * Outreach by this MA on or before the gift.
 * The closest qualifying note within 90 days sets `touchLabel`, and
 * `touchCount` is how many qualifying notes fell in that window.
 * The donation note that logs the gift is not a contact. Obituaries,
 * address updates, events, and bad numbers are not contacts either.
 * A note after the gift does not count.
 *
 * When `counted` is set and the 90-day window is empty, the same type
 * check runs with no day cap. That lookback names the reached-by row.
 * It does not assign the gift.
 */
export function outreachBeforeGift(giftDate, notesOnContact, owner, options = {}) {
  const before = SETTINGS.giftNoteDaysBefore ?? 90;
  const collect = (maxDays) => {
    const hits = [];
    for (const n of notesOnContact || []) {
      if (owner && n.owner !== owner) continue;
      if (n.assist || n.unmatched) continue;
      if (n.bucket === "gift" || n.bucket === "obituary" || n.bucket === "address" || n.bucket === "event" || n.bucket === "failed") continue;
      const key = (n.type || "").trim().toLowerCase();
      if (NOT_A_CONTACT.has(key)) continue;
      if (!CONTACT_BUCKETS.has(n.bucket) && n.bucket !== "commitment") continue;
      const delta = daysFromNoteToGift(n.date, giftDate);
      if (delta == null || delta < 0) continue;
      if (maxDays != null && delta > maxDays) continue;
      hits.push({ note: n, days: delta });
    }
    hits.sort((a, b) => a.days - b.days || String(a.note.noteId ?? "").localeCompare(String(b.note.noteId ?? "")));
    return hits;
  };
  const recent = collect(before);
  const hits = recent.length ? recent : (options.counted ? collect(null) : recent);
  return {
    touchCount: hits.length,
    touchLabel: hits[0]?.note.label || "No contact logged",
  };
}

/** Closest conversation/meeting on or before the gift, within the assignment window. */
export function nearestPossibleNote(giftDate, notesOnContact) {
  return possibleNotesForGift(giftDate, notesOnContact)[0] || null;
}

const CONTACT_BUCKETS = new Set(["conversation", "dial", "email", "note", "facetoface", "general"]);
const NOT_A_CONTACT = new Set([
  "mission advancement call | email inactive",
  "mission advancement call | invalid number",
]);

/**
 * Qualifying contacts on or before the gift, one closest note per MA.
 * `minDays` and `maxDays` are inclusive. A note after the gift does not count.
 */
function contactsOnOrBefore(giftDate, notesOnContact, minDays, maxDays) {
  const bestByOwner = new Map();
  for (const n of notesOnContact || []) {
    if (n.assist || n.unmatched) continue;
    const key = (n.type || "").trim().toLowerCase();
    if (NOT_A_CONTACT.has(key) || !CONTACT_BUCKETS.has(n.bucket)) continue;
    const delta = daysFromNoteToGift(n.date, giftDate);
    if (delta == null || delta < minDays || delta > maxDays) continue;
    if (beforeStart(giftDate, n.owner) || beforeStart(n.date, n.owner)) continue;
    const cur = bestByOwner.get(n.owner);
    if (!cur || delta < cur.days) bestByOwner.set(n.owner, { note: n, days: delta });
  }
  return [...bestByOwner.values()].sort(
    (a, b) => a.days - b.days || String(a.note.owner).localeCompare(String(b.note.owner)),
  );
}

/**
 * Every qualifying contact on the gift, not only the latest note.
 * Any voicemail, email, letter, conversation, meeting, or general note
 * on or before the gift, within 90 days, assigns it. A note after the gift
 * date does not. One closest note per MA, nearest first.
 */
export function attributingContacts(giftDate, notesOnContact) {
  const before = SETTINGS.giftNoteDaysBefore ?? 90;
  return contactsOnOrBefore(giftDate, notesOnContact, 0, before);
}

/**
 * Same contacts as attributingContacts, from the day after the auto window
 * through giftReviewDaysBefore. While that ceiling is not past the auto
 * window, this list is empty and those contacts assign instead.
 */
export function reviewContacts(giftDate, notesOnContact) {
  const auto = SETTINGS.giftNoteDaysBefore ?? 90;
  const review = SETTINGS.giftReviewDaysBefore ?? 90;
  if (review <= auto) return [];
  return contactsOnOrBefore(giftDate, notesOnContact, auto + 1, review);
}

/** Ticket purchase for a gala. Segment or project must name the gala. */
export function isGalaGift(record) {
  const blob = `${record?.segment || ""} ${record?.project || ""} ${giftProject(record)}`;
  return /gala/i.test(blob) || !!record?.galaSite;
}

/** Paid on the gala site and not yet a posted Virtuous gift. */
export function isPendingGalaSiteTicket(record) {
  return !!(record?.galaSite && record?.inVirtuous === false);
}

/**
 * Conversation, two-way email, text reply, or meeting within 90 days of a gala gift.
 * The gift is the ticket purchase, so that conversation secures it.
 * A voicemail, letter, email-sent, or outbound text does not. One closest note per MA.
 */
export function galaSecuringNotes(giftDate, notesOnContact) {
  const window = SETTINGS.giftNoteDaysBefore ?? 90;
  const bestByOwner = new Map();
  for (const n of notesOnContact || []) {
    const key = (n.type || "").trim().toLowerCase();
    if (!POSSIBLE_GIFT_TYPES.has(key)) continue;
    if (n.assist) continue;
    const delta = daysFromNoteToGift(n.date, giftDate);
    if (delta == null || delta < 0 || delta > window) continue;
    if (beforeStart(giftDate, n.owner) || beforeStart(n.date, n.owner)) continue;
    const cur = bestByOwner.get(n.owner);
    const nearer = !cur || Math.abs(delta) < Math.abs(cur.days) || (Math.abs(delta) === Math.abs(cur.days) && delta >= 0 && cur.days < 0);
    if (nearer) bestByOwner.set(n.owner, { note: n, days: delta });
  }
  return [...bestByOwner.values()].sort(
    (a, b) => Math.abs(a.days) - Math.abs(b.days) || (a.days >= 0 ? -1 : 1) - (b.days >= 0 ? -1 : 1) || String(a.note.owner).localeCompare(String(b.note.owner)),
  );
}

/** AC, Mission Fund, gala, or other — used by Incoming Gifts. */
export function giftKindOf(record) {
  const blob = `${record.segment || ""} ${record.project || ""} ${giftProject(record)}`;
  if (isGalaGift(record)) return "gala";
  if (record.acIncrease) return "ac-increase";
  if (/annunciation/i.test(blob) || isMonthlyRecurring(record)) return "ac";
  if (/mission fund/i.test(blob)) return "mission-fund";
  return "one-time";
}

export function giftKindLabel(kind, annualized) {
  if (kind === "gala") return "Gala";
  if (kind === "ac-increase") return "AC increase";
  if (kind === "ac") return annualized ? "AC (monthly ×12)" : "Annunciation Circle";
  if (kind === "mission-fund") return "Mission Fund";
  return annualized ? "Monthly ×12" : "One-time";
}

function ownerHintFromBuckets(giftDate, notesOnContact, buckets) {
  const before = SETTINGS.giftNoteDaysBefore ?? 90;
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
      ? `Gift · AC increase ($${priorMonthly} → $${newMonthly}/mo, ×12)`
      : monthly
        ? "Gift (monthly ×12)"
        : "Gift";
  return {
    owner, type: "Gift", points: 0, amount: assist ? 0 : amount, postedAmount, annualized: monthly,
    acIncrease: increase, priorMonthly: priorMonthly || null, newMonthly: increase ? newMonthly : null,
    bucket: "donation",
    label,
    day: isoDay(date), date, weekday: isWeekday(date),
    contactId: record.contactId, contactName: contactDisplayName(record),
    giftId: record.id, giftType: record.giftType || "",
    frequency: record.frequency || (monthly ? "Monthly" : ""),
    project: giftProject(record),
    segment: record.segment || "",
    solicitor: solicitor || "",
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
 * contact in the gift window (`ownerHint`), or `assignedOwner`. The caller
 * passes the note owner as `assignedOwner` when a qualifying contact assigns
 * the gift. A monthly gift that is not an increase stays on review instead.
 * GFT_Solicitor is never used for owner. Direct Solicitation (MGO) uses the
 * same owner as any other gift. Returns null when amount is 0 or less.
 */
export function scoreGift(record, ownerHint = null, assignedOwner = null) {
  const postedAmount = parseAmount(record.amount);
  if (postedAmount <= 0) return null;
  const credited = assignedOwner && rosterSet.has(assignedOwner) ? assignedOwner : null;
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
    contactName: contactDisplayName(record),
    date, day: isoDay(date), weekday: isWeekday(date),
    amount: postedAmount, postedAmount, giftId: record.id,
    matchOnly: true,
  };
}

/**
 * Pair a donation note with a posted gift on the same contact.
 * MAs often log New Donation after the gift posts, so gifts up to 90 days
 * before the note count as well as gifts up to 90 days after. Prefer the
 * closest date; a gift on or after the note wins ties.
 */
function pickDonationMatch(note, candidates, used, window) {
  if (note?.assignsGiftId) {
    const pinned = candidates.find(
      (g) => String(g.giftId) === String(note.assignsGiftId) && !used.has(g),
    );
    if (!pinned) return null;
    const delta = daysFromNoteToGift(note.date, pinned.date);
    if (delta == null || Math.abs(delta) > window) return null;
    return pinned;
  }
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
 * A received gift is one row: label Gift, the dollars, and 100 points.
 * A donation note awards those points only after it pairs with a posted gift
 * of amount > 0 on the same contact within 90 days. Points land on the gift's
 * week. The note is not listed again. Unmatched donation notes score 0 and
 * leave the gift bucket. Gift Assist is the same 100 pts but does not count
 * dollars, and stays on its own row. A new monthly Recurring Gift is one gift
 * (annualized dollars) and one 100-pt credit; later installments of that
 * commitment are dropped in prepareGifts. An AC raise credits only
 * (new − prior monthly) × 12.
 *
 * A voicemail, email, letter, visit, conversation, meeting, or general note
 * on or before the gift, within 90 days, assigns it (Raised and 100 points).
 * A note after the gift does not. A new monthly gift with that contact, when
 * it is not an increase, waits on Incoming at 0 points until Assign.
 * Raised dollars always pair with 100 pts.
 *
 * A row on the MA tracker spreadsheet does not assign Raised. The MA who
 * receives the dollars must have a qualifying contact on or before the gift
 * within 90 days, or a donation note within 90 days before or after the gift
 * (New Donation or New AC, Annunciation Circle updated, or Update Recurring
 * Gift). A gala ticket purchase posted in Virtuous is assigned the same way.
 * A gala-site Stripe ticket that is not yet in Virtuous waits on Incoming
 * only when an MA had a conversation, two-way email, or meeting on that
 * contact on or before the purchase, within 90 days. Tickets sold to people
 * the MAs did not contact are not listed.
 * An Incoming assignment also credits it, and that assigned owner wins over
 * another MA's qualifying contact on the same gift. Direct Solicitation (MGO)
 * uses the same 90-day contact rule as any other gift.
 * An officer's own gift counts for that officer when no other officer reached
 * the donor first. The household, a roster email, or a distinct nickname
 * identifies the officer.
 * `countedGifts` is accepted and ignored so older callers keep working.
 *
 * `flags` is the shared review-flags map (same object aggregate uses).
 * `portfolios` is `{ [contactId]: "MA Name" }` and still credits an MGO-coded
 * gift when that donor sits on exactly one MA portfolio.
 */
export function scoreAll({ notes = [], gifts = [], flags = {}, portfolios = {} }) {
  gifts = (gifts || []).map((g) => applyPassthroughCredit(g));
  const notesByContact = groupByContact(notes, (n) => n.contactId);
  const giftsForFacts = groupByContact(gifts, (g) => g.contactId);
  const factsFor = (record) => incomingFacts(record, notesByContact, giftsForFacts);
  const rows = [];
  const donationNotes = [];
  const activityByContact = new Map();
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
    const assistInWindow = gDate && notesOnContact.some((n) => {
      if (!n.assist) return false;
      const delta = daysFromNoteToGift(n.date, gDate);
      const window = SETTINGS.giftNoteDaysBefore ?? 90;
      return delta != null && Math.abs(delta) <= window;
    });
    const pendingGalaSite = isPendingGalaSiteTicket(g);
    const contacts = gDate && !pendingGalaSite && !assistInWindow && !isAssistGiftId(g.id)
      ? attributingContacts(gDate, notesOnContact)
      : [];
    if (contacts[0]) {
      const assigned = assignedOwnerForGift(g, contacts[0].note.owner, flags);
      const owner = assigned || contacts[0].note.owner;
      const r = scoreGift(g, contacts[0].note.owner, owner);
      if (r) {
        const credited = {
          ...r,
          source: assigned ? "assigned" : "contact",
          contactName: r.contactName || contacts[0].note.contactName || "",
          mgoAssigned: isMgoAttributedGift(g) ? true : undefined,
        };
        const assignedFlag = !!assigned;
        if (isMonthlyRecurring(g) && !g.acIncrease && !g.fullMonthly && !assignedFlag) {
          rows.push({
            ...credited,
            ...factsFor(g),
            needsReview: true,
            points: 0,
            label: "Recurring — needs review",
          });
          continue;
        }
        rows.push(credited);
        scoredGifts.push(credited);
        continue;
      }
    }
    if (gDate && isGalaGift(g) && !pendingGalaSite) {
      const hits = galaSecuringNotes(gDate, notesOnContact);
      const hit = hits[0];
      if (hit) {
        const r = scoreGift(g, hit.note.owner, hit.note.owner);
        if (r) {
          const credited = {
            ...r,
            kind: "gala",
            kindLabel: "Gala",
            source: "gala",
            label: "Gift · Gala",
          };
          rows.push(credited);
          scoredGifts.push(credited);
          continue;
        }
      }
    }
    const selfOwner = rosterDonorOwner(g);
    if (selfOwner) {
      const assigned = assignedOwnerForGift(g, selfOwner, flags);
      const owner = assigned || selfOwner;
      const r = scoreGift(g, owner, owner);
      if (r) {
        const credited = {
          ...r,
          source: assigned ? "assigned" : "self",
          contactName: r.contactName || contactDisplayName(g),
          mgoAssigned: isMgoAttributedGift(g) ? true : undefined,
        };
        rows.push(credited);
        scoredGifts.push(credited);
        continue;
      }
    }
    if (isMgoAttributedGift(g)) {
      const assigned = assignedOwnerForGift(g, reviewHint, flags);
      const fromPortfolio = portfolioOwnerFor(g.contactId, portfolios);
      const owner = assigned || fromPortfolio;
      if (owner) {
        const r = scoreGift(g, giftHint || owner, owner);
        if (r) {
          const credited = {
            ...r,
            mgoAssigned: true,
            source: assigned ? r.source : "portfolio",
          };
          if (!credited.assist) rows.push(credited);
          scoredGifts.push(credited);
          matchGifts.push(credited);
          continue;
        }
      }
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
  const notesInOrder = [...donationNotes].sort((a, b) => {
    const pin = (b.assignsGiftId ? 1 : 0) - (a.assignsGiftId ? 1 : 0);
    if (pin) return pin;
    return sortByDayThenId(a.date, a.noteId, b.date, b.noteId);
  });
  for (const note of notesInOrder) {
    const candidates = (() => {
      const ck = contactKey(note.contactId);
      return ck ? (giftsByContact.get(ck) || []) : [];
    })();
    const window = SETTINGS.giftNoteDaysBefore ?? 90;
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
  const securedPts = new Set(
    donationNotes.filter((n) => !n.unmatched && n.giftId != null).map((n) => `${n.giftId}:${n.owner}`),
  );
  for (const g of scoredGifts) {
    if (!g.assist) continue;
    const key = `${g.giftId}:${g.owner}`;
    if (securedPts.has(key)) continue;
    rows.push({
      owner: g.owner,
      type: "Mission Advancement | Gift Assist",
      points: 100,
      bucket: "gift",
      label: "Gift assist",
      day: g.day, date: g.date, weekday: g.weekday,
      contactId: g.contactId, contactName: g.contactName || "",
      giftId: g.giftId, giftAmount: g.postedAmount || 0,
      postedAmount: g.postedAmount || 0,
      amount: 0,
      giftType: g.giftType || "",
      project: g.project || "",
      source: "assist-backfill",
      assist: true,
    });
    securedPts.add(key);
    if (g.giftId != null) securedIds.add(String(g.giftId));
  }
  // One activity per received gift. The 100 points sit on that row.
  // The Virtuous note that secured it is not a second row.
  const raisedByKey = new Map();
  for (const row of rows) {
    if (row.bucket !== "donation" || row.assist || row.needsReview) continue;
    if ((row.amount || 0) <= 0 || row.giftId == null) continue;
    row.points = 100;
    const ck = contactKey(row.contactId);
    const touch = outreachBeforeGift(row.date, ck ? (activityByContact.get(ck) || []) : [], row.owner, { counted: true });
    row.touchCount = touch.touchCount;
    row.touchLabel = touch.touchLabel;
    raisedByKey.set(`${row.giftId}:${row.owner}`, row);
    securedIds.add(String(row.giftId));
  }
  for (const note of donationNotes) {
    if (note.assist || note.unmatched || note.giftId == null) continue;
    if (!raisedByKey.has(`${note.giftId}:${note.owner}`)) continue;
    note.points = 0;
    note.folded = true;
  }

  const raisedById = new Map(scoredGifts.map((g) => [String(g.giftId), g]));
  for (const g of gifts) {
    const gDate = giftDateOf(g);
    if (!gDate) continue;
    if (g.contactId == null) continue;
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
    const autoHits = possibleNotesForGift(gDate, notesOnContact);
    const olderHits = autoHits.length ? [] : reviewContacts(gDate, notesOnContact);
    const hits = autoHits.length ? autoHits : olderHits;
    if (!hits.length) continue;
    const pendingGalaSite = isPendingGalaSiteTicket(g);
    const reviewWindow = olderHits.length > 0;
    const hit = hits[0];
    const monthly = isMonthlyRecurring(g);
    const factor = SETTINGS.monthlyAnnualizeFactor || 12;
    const amount = raised
      ? raised.amount
      : (monthly ? roundCents(postedAmount * factor) : postedAmount);
    const annualized = raised ? !!raised.annualized : monthly;
    const kind = giftKindOf({ ...g, acIncrease: raised?.acIncrease || g.acIncrease });
    rows.push({
      ...factsFor(g),
      owner: hit?.note.owner || "",
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
      label: pendingGalaSite
        ? "Gala site ticket"
        : reviewWindow ? "Review — older contact" : "Incoming gift",
      reviewWindow,
      day: isoDay(gDate),
      date: gDate,
      weekday: isWeekday(gDate),
      contactId: g.contactId,
      contactName:
        contactDisplayName(g)
        || notesOnContact.map((n) => n.contactName).find(Boolean)
        || hit?.note.contactName
        || "",
      giftId: g.id,
      giftType: g.giftType || "",
      project: giftProject(g),
      noteId: hit?.note.noteId,
      noteType: hit?.note.type,
      noteLabel: hit?.note.label,
      noteDay: hit?.note.day,
      daysAfterNote: hit?.days,
      inRaised: !!raised && (raised.amount || 0) > 0,
      source: pendingGalaSite ? "gala-site" : "possible",
      possible: true,
      galaSite: !!g.galaSite,
      inVirtuous: g.inVirtuous !== false && !g.galaSite ? true : !!g.inVirtuous,
      emailMatch: g.emailMatch || null,
    });
  }

  return rows.filter((r) => !r.folded && !(r.bucket === "donation" && (r.amount || 0) <= 0));
}

/** Score matched events for the display-only reference table. */
export function scoreEventsForDisplay(events = []) {
  return events.map(scoreEvent).filter(Boolean);
}

const trackedTypeById = new Map(
  [...TRACKED_EVENT_TYPES, ...RETIRED_TRACKED_EVENT_TYPES].map((t) => [t.id, t]),
);

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
  const preset = trackedTypeById.get(event.eventType)
    || [...TRACKED_EVENT_TYPES, ...RETIRED_TRACKED_EVENT_TYPES].find((t) => t.type === event.eventType);
  const type = preset?.type || String(event.eventType || "Mission Advancement | Event").trim();
  const typeLabel = preset?.label || type;
  const name = String(event.name || "").trim();
  const projectType = preset?.id === "projects" || event.eventType === "projects" || event.eventType === "Projects"
    ? String(event.projectType || "").trim().replace(/\s+/g, " ")
    : "";
  const hrsLabel = `${hours} ${hours === 1 ? "hr" : "hrs"}`;
  const label = [typeLabel, projectType, hrsLabel, name].filter(Boolean).join(" · ");
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
