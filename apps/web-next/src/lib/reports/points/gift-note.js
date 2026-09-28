/**
 * Gift-note form opened from Possible gifts.
 * The Virtuous create-note page is an unstyled modal fragment and ignores
 * query parameters, so the dashboard hosts the form and posts the note.
 */

export const GIFT_NOTE_CHOICES = [
  { id: "gift", label: "Gift", type: "Mission Advancement | New Donation or New AC" },
  { id: "increase", label: "Recurring increase", type: "Mission Advancement | Update Recurring Gift" },
  { id: "assist", label: "Gift Assist", type: "Mission Advancement | Gift Assist" },
];

const CHOICE_BY_ID = new Map(GIFT_NOTE_CHOICES.map((choice) => [choice.id, choice]));
const CHOICE_BY_TYPE = new Map(GIFT_NOTE_CHOICES.map((choice) => [choice.type, choice]));

export function giftNoteChoice(idOrType) {
  const key = String(idOrType || "gift").trim();
  return CHOICE_BY_ID.get(key) || CHOICE_BY_TYPE.get(key) || null;
}

/** Popup path. Empty when the contact id is missing. */
export function giftNoteFormUrl(contactId, fields = {}) {
  const id = String(contactId ?? "").trim();
  if (!/^\d+$/.test(id)) return "";
  const q = new URLSearchParams();
  q.set("contactId", id);
  for (const key of ["name", "amount", "day", "project"]) {
    const value = fields[key];
    if (value == null || String(value).trim() === "") continue;
    q.set(key, String(value));
  }
  return `/advancement/points/gift-note?${q.toString()}`;
}

export function formatGiftDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return "";
  const [year, month, date] = String(day).split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatGiftAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Note text ready to save. The person can edit it before saving. */
export function giftNoteDraft({ amount, day } = {}) {
  const money = formatGiftAmount(amount);
  const when = formatGiftDay(day);
  if (money && when) return `Gift of ${money} on ${when}.`;
  if (when) return `Gift received on ${when}.`;
  if (money) return `Gift of ${money}.`;
  return "Gift received.";
}

/**
 * Body for POST /api/ContactNote. Type must be one of the gift choices.
 * Noon keeps the calendar day stable when Virtuous stores a date-time.
 */
export function buildGiftNotePayload({ contactId, type, note, day }) {
  const id = Number(contactId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("A Virtuous contact is required");
  }
  const choice = giftNoteChoice(type);
  if (!choice) throw new Error("Choose a gift note type");
  const text = String(note || "").trim();
  if (!text) throw new Error("Write a note before saving");
  if (text.length > 4000) throw new Error("Note is too long");
  const date = String(day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a note date");
  return {
    contactId: id,
    type: choice.type,
    note: text,
    noteDateTime: `${date}T12:00:00`,
    important: false,
    private: false,
  };
}
