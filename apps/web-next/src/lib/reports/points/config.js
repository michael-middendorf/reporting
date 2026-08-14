/**
 * config.js — single source of truth for the MA Points dashboard.
 *
 * Everything the scoring engine needs lives here so non-developers can adjust
 * the roster, point values, and tier thresholds without touching logic code.
 *
 * SCORING RECONCILIATION
 * ----------------------
 * Two artifacts define "the points":
 *   1. MAS Points.pdf        — the official comp-plan rubric (8 activity values + tiers).
 *   2. "MAs Points" spreadsheet — the working tracker the team fills in weekly.
 *
 * They do not perfectly agree. Per direction, we build to the PDF rubric and
 * FLAG every place the spreadsheet diverges (see CONFLICTS below and the
 * Methodology page). Each POINTS_MAP entry carries a `source` and, where
 * relevant, a `conflict` id so the UI can surface exactly what was assumed.
 */

/* ---- Roster -------------------------------------------------------------
 * `createdByUser` is the exact string Virtuous stamps on each ContactNote.
 * Confirmed live from the ContactNote API (2026-08-04). */
export const MA_ROSTER = [
  { name: "Sean Kelly",     email: "sean.e.kelly@avemaria.edu",     short: "Sean" },
  { name: "Joseph Blaso",   email: "joseph.c.blaso@avemaria.edu",   short: "Joseph" },
  { name: "Alanna McCann",  email: "alanna.f.mccann@avemaria.edu",  short: "Alanna" },
  { name: "Caleb Metzen",   email: "",                              short: "Caleb" },
  { name: "Elena Barnes",   email: "",                              short: "Elena" },
  { name: "Betsy Scaletty", email: "",                              short: "Betsy" },
  { name: "Natalia Abrams", email: "",                              short: "Natalia" },
];

export const MA_NAMES = MA_ROSTER.map((m) => m.name);

/* ---- Performance tiers (from MAS Points.pdf) ----------------------------
 * Evaluated on AVERAGE POINTS PER WEEKDAY over the evaluation period. */
export const TIERS = [
  { id: "far_exceeds", label: "Far Exceeds Expectation", min: 200, annual: 10000, payout: 5000,   color: "var(--gold)" },
  { id: "exceeds",     label: "Exceeds Expectation",     min: 100, annual: 7500,  payout: 3750,   color: "#3f7d54" },
  { id: "meets",       label: "Meets Expectation",       min: 0,   annual: 5000,  payout: 2500,   color: "var(--navy)" },
];

/** Return the tier object for a given average-points-per-weekday value. */
export function tierFor(avgPerWeekday) {
  return TIERS.find((t) => avgPerWeekday >= t.min) || TIERS[TIERS.length - 1];
}

/* ---- Example day targets (from the PDF, shown as reference goals) -------- */
export const DAY_TARGETS = {
  far_exceeds: { points: 262, blurb: "72 dials / speak to 6 people / 6 handwritten notes / 1 Annunciation Circle" },
  exceeds:     { points: 125, blurb: "50 dials / speak to 5 people / 5 handwritten notes" },
  meets:       { points: 102, blurb: "72 dials / reach 3 people" },
};

/* ---- Conflict registry --------------------------------------------------
 * Documented divergences between the PDF and the spreadsheet. The dashboard
 * scores per `resolved`; the Methodology page lists these verbatim so the
 * team can confirm or override each one. */
export const CONFLICTS = {
  invalid_number: {
    title: "Invalid / disconnected number",
    pdf: "Not listed as a scoring activity (treated as 0 — a dial that reached no one).",
    spreadsheet: "‘Disconnected’ rows are given 1 point.",
    resolved: "0 points",
    note: "PDF only awards the 1-pt dial credit for a dial that resulted in a voicemail/email/text. Set `invalidNumberScores: true` in config to give these 1 pt to match the spreadsheet.",
  },
  email_conversation: {
    title: "Two-way email exchange",
    pdf: "Email counts as 1 pt (‘email / text’). Only a phone conversation earns 10.",
    spreadsheet: "‘Response Rec’d’ is given 3 points.",
    resolved: "1 point",
    note: "We follow the PDF (email = 1). The spreadsheet’s 3-pt ‘Response Received’ has no PDF equivalent.",
  },
  event_subtype: {
    title: "Event points (300 vs 75)",
    pdf: "‘Ave Near You’ event = 300; Marketing event (Zena’s team) = 75.",
    spreadsheet: "Not tracked as line items.",
    resolved: "Requires event subtype",
    note: "A generic Virtuous Event/note can’t be split into 300 vs 75 automatically. These are matched by event name keywords (see EVENT_RULES) and otherwise flagged for manual tagging.",
  },
  mgo_appointment: {
    title: "Appointment set for MGO (10 pts)",
    pdf: "10 points for an appointment set for an MGO with a qualified prospect.",
    spreadsheet: "Not a discrete line item.",
    resolved: "Mapped to MGO task/note types (see below), else unmatched",
    note: "Best-effort mapped to the ‘FY27 MGO Goal Activity’ note type / ‘FY27 MGO Goal Task’. Confirm this is how MAs log MGO appointments.",
  },
  contact_update: {
    title: "Updated contact info / credit card (5 pts)",
    pdf: "5 points for updated contact info or credit card (grouped with handwritten note / TSM book).",
    spreadsheet: "Not a discrete line item.",
    resolved: "Mapped to address/CC update note types",
    note: "Mapped to ‘Mission Advancement | Invalid Mailing Address’ and address-change note types. Confirm.",
  },
};

/* ---- Points map: Virtuous note `type` (lowercased) -> rule ---------------
 * points  : integer awarded
 * bucket  : coarse category for grouping / the activity breakdown
 * label   : human label shown in the UI
 * source  : "pdf" | "pdf+spreadsheet" | "assumed"
 * conflict: optional key into CONFLICTS */
export const POINTS_MAP = {
  "mission advancement call | conversation":
    { points: 10, bucket: "conversation", label: "Phone conversation", source: "pdf+spreadsheet" },
  "mission advancement call | voicemail":
    { points: 1, bucket: "dial", label: "Voicemail / dial", source: "pdf+spreadsheet" },
  "mission advancement call | email reach out":
    { points: 1, bucket: "email", label: "Email reach-out", source: "pdf" },
  "mission advancement call | email inactive":
    { points: 1, bucket: "email", label: "Email (inactive)", source: "pdf" },
  "mission advancement call | email conversation":
    { points: 1, bucket: "email", label: "Email conversation", source: "pdf", conflict: "email_conversation" },
  "mission advancement call | invalid number":
    { points: 0, bucket: "failed", label: "Invalid number", source: "pdf", conflict: "invalid_number" },

  "mission advancement | new donation or new ac":
    { points: 100, bucket: "gift", label: "New donation / Annunciation Circle", source: "pdf+spreadsheet" },
  "mission advancement | annunciation circle updated":
    { points: 100, bucket: "gift", label: "Annunciation Circle updated", source: "assumed" },
  "mission advancement | update recurring gift":
    { points: 100, bucket: "gift", label: "Increased recurring gift", source: "assumed" },

  "letter":     { points: 5, bucket: "note", label: "Handwritten note / letter", source: "pdf+spreadsheet" },
  "text message": { points: 1, bucket: "email", label: "Text message", source: "pdf" },
  "in person":  { points: 25, bucket: "facetoface", label: "Face-to-face (coffee/lunch)", source: "pdf+spreadsheet" },

  "mission advancement | invalid mailing address":
    { points: 5, bucket: "note", label: "Updated contact info", source: "assumed", conflict: "contact_update" },
  "as - address change/update":
    { points: 5, bucket: "note", label: "Address change/update", source: "assumed", conflict: "contact_update" },

  "fy27 mgo goal activity":
    { points: 10, bucket: "mgo", label: "MGO appointment set", source: "assumed", conflict: "mgo_appointment" },
};

/* ---- Bucket display order + colors (for the activity breakdown) ---------- */
export const BUCKETS = [
  { id: "gift",       label: "Gifts secured",   points: 100, color: "var(--gold)" },
  { id: "facetoface", label: "Face-to-face",    points: 25,  color: "#7a5cc0" },
  { id: "mgo",        label: "MGO appts",        points: 10,  color: "#2f6fed" },
  { id: "conversation", label: "Conversations", points: 10,  color: "#3f7d54" },
  { id: "note",       label: "Notes / updates", points: 5,   color: "#c85a3a" },
  { id: "email",      label: "Emails / texts",  points: 1,   color: "#5b8bb0" },
  { id: "dial",       label: "Dials / VMs",     points: 1,   color: "#8a97a6" },
  { id: "failed",     label: "Invalid / failed", points: 0,  color: "#c2c9d1" },
];

/* ---- Event scoring (300 / 75) -------------------------------------------
 * Matched from Event records by name keywords, otherwise flagged. */
export const EVENT_RULES = [
  // Live event names use both "Ave Near You" and "AMU Near You"; match either.
  { match: /(?:ave|amu)?\s*near\s*you/i, points: 300, label: "‘Ave Near You’ event" },
  { match: /market/i,                    points: 75,  label: "Marketing event" },
];

/* ---- Data source --------------------------------------------------------
 * The frontend fetches RAW Virtuous JSON only; all processing happens here.
 * Locally we read from ./data; in production from the CloudFront-fronted
 * cache bucket. Override with ?data=<baseUrl> for testing. */
export const DATA_BASE = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('data')) || '/api/reports/points';

export const RAW_FILES = {
  notes: "notes.json",
  gifts: "gifts.json",
  events: "events.json",
  meta: "meta.json",
};

/** If true, Invalid Number notes score 1 pt (spreadsheet behavior). */
export const SETTINGS = {
  invalidNumberScores: false,
};

/* ---- Virtuous deep-link base --------------------------------------------
 * Used by the calculation/audit export and the in-page drill-in to build a
 * click-through to the source record. A contact opens at
 * `${VIRTUOUS_APP_BASE}/Generosity/Contact/View/{id}` (same convention as the
 * annunciation publisher); the conversation log lives on that contact's Notes
 * tab. Org: Ave Maria University (org 6339). */
export const VIRTUOUS_APP_BASE = "https://app.virtuoussoftware.com";
