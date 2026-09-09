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
 * Confirmed live from the ContactNote API (2026-08-04).
 * Optional startDate is a local calendar floor; notes and attributed gifts
 * before that day do not score. */
export const MA_ROSTER = [
  { name: "Alanna McCann",  email: "alanna.f.mccann@avemaria.edu",  short: "Alanna",  tableOrder: 0 },
  { name: "Sean Kelly",     email: "sean.e.kelly@avemaria.edu",     short: "Sean",    tableOrder: 1 },
  { name: "Joseph Blaso",   email: "joseph.c.blaso@avemaria.edu",   short: "Joseph",  tableOrder: 2 },
  { name: "Elena Barnes",   email: "",                              short: "Elena",   tableOrder: 3, startDate: "2026-07-20" },
  { name: "Caleb Metzen",   email: "",                              short: "Caleb",   tableOrder: 4, startDate: "2026-07-20" },
  { name: "Betsy Scaletty", email: "",                              short: "Betsy",   tableOrder: 5, startDate: "2026-07-20" },
  { name: "Natalia Abrams", email: "",                              short: "Natalia", tableOrder: 6, startDate: "2026-07-20" },
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
    resolved: "1 point",
    note: "Counted as a 1-pt dial to match the tracker (confirmed 2026-09-09). Logged as ‘Mission Advancement Call | Invalid Number’.",
  },
  email_sent: {
    title: "Email sent",
    pdf: "Email / text counts as 1 pt.",
    spreadsheet: "‘Email Sent’ is given 2 points.",
    resolved: "2 points",
    note: "Counted at 2 points to match the tracker (confirmed 2026-09-09). Logged as ‘Mission Advancement Call | Email Reach Out’. Text message uses the same 2 pts (it sits in the tracker’s Sent row).",
  },
  email_bounced: {
    title: "Email bounced",
    pdf: "Email / text counts as 1 pt.",
    spreadsheet: "‘Bounced’ is given 1 point.",
    resolved: "1 point",
    note: "Counted at 1 point (confirmed 2026-09-09). Virtuous type ‘Mission Advancement Call | Email Inactive’ is Bounced.",
  },
  email_conversation: {
    title: "Two-way email exchange",
    pdf: "Email counts as 1 pt (‘email / text’). Only a phone conversation earns 10.",
    spreadsheet: "‘Response Rec’d’ is given 3 points.",
    resolved: "3 points",
    note: "Counted at 3 points to match the tracker (confirmed 2026-09-09). Logged as ‘Mission Advancement Call | Email Conversation’.",
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
  // NOTE: the former `contact_update` conflict was RESOLVED (2026-08-14, per
  // Regina) — contact-info / credit-card changes count for 5 pts per the PDF
  // rubric. The two note-type mappings below now carry source "pdf" (no
  // conflict flag); the rule is documented in DEFINITIONS instead.
  obituary: {
    title: "Obituary notes",
    pdf: "Not a named activity; closest bucket is 5 pts for updated contact info.",
    spreadsheet: "‘Obituaries’ is given 3 points.",
    resolved: "3 points",
    note: "Counted at 3 points to match the tracker (confirmed 2026-09-09). Pulled from the Virtuous ‘Obituary’ note type, scoped to MA authors.",
  },
  mas_event_note: {
    title: "MAS Event note (attributed to an MA)",
    pdf: "‘Ave Near You’ event = 300; Marketing event (Zena’s team) = 75.",
    spreadsheet: "Not a discrete line item.",
    resolved: "300 points for ‘Mission Advancement | Event’; 75 for ‘Mission Advancement | Marketing Event’",
    note: "Virtuous Event records still have no MA owner. An MA takes the credit by logging ‘Mission Advancement | Event’ or ‘Mission Advancement | Marketing Event’.",
  },
  mas_meeting_note: {
    title: "MAS Meeting note",
    pdf: "25 points per face-to-face (coffee/lunch with a prospect).",
    spreadsheet: "‘Live Mtg’ is scored at 25.",
    resolved: "25 points",
    note: "Logged as ‘Mission Advancement | Meeting’. The existing ‘In Person’ type already scores 25 and continues to count.",
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
    { points: 2, bucket: "email", label: "Email reach-out", source: "spreadsheet", conflict: "email_sent" },
  "mission advancement call | email inactive":
    { points: 1, bucket: "email", label: "Email bounced", source: "spreadsheet", conflict: "email_bounced" },
  "mission advancement call | email conversation":
    { points: 3, bucket: "email", label: "Email conversation", source: "spreadsheet", conflict: "email_conversation" },
  "mission advancement call | invalid number":
    { points: 1, bucket: "failed", label: "Invalid number", source: "pdf+spreadsheet" },

  "mission advancement | new donation or new ac":
    { points: 100, bucket: "gift", label: "New donation / Annunciation Circle", source: "pdf+spreadsheet" },
  "mission advancement | annunciation circle updated":
    { points: 100, bucket: "gift", label: "Annunciation Circle updated", source: "assumed" },
  "mission advancement | update recurring gift":
    { points: 100, bucket: "gift", label: "Increased recurring gift", source: "assumed" },

  "letter":     { points: 5, bucket: "note", label: "Handwritten note / letter", source: "pdf+spreadsheet" },
  "text message": { points: 2, bucket: "email", label: "Text message", source: "spreadsheet", conflict: "email_sent" },
  "in person":  { points: 25, bucket: "facetoface", label: "Face-to-face (coffee/lunch)", source: "pdf+spreadsheet" },

  "mission advancement | invalid mailing address":
    { points: 5, bucket: "address", label: "Invalid mailing address", source: "pdf" },
  "as - address change/update":
    { points: 5, bucket: "address", label: "Address change/update", source: "pdf" },

  "obituary":
    { points: 3, bucket: "obituary", label: "Obituary", source: "spreadsheet", conflict: "obituary" },

  "mission advancement | event":
    { points: 300, bucket: "event", label: "MAS Event (Ave Near You)", source: "pdf", conflict: "mas_event_note" },
  "mission advancement | marketing event":
    { points: 75, bucket: "event", label: "MAS Marketing Event", source: "pdf", conflict: "mas_event_note" },
  "mission advancement | meeting":
    { points: 25, bucket: "facetoface", label: "MAS Meeting (face-to-face)", source: "pdf", conflict: "mas_meeting_note" },

  "fy27 mgo goal activity":
    { points: 10, bucket: "mgo", label: "MGO appointment set", source: "assumed", conflict: "mgo_appointment" },
};

/* ---- Bucket display order + colors (for the activity breakdown) ---------- */
export const BUCKETS = [
  { id: "gift",         label: "Gifts secured",     points: 100, color: "var(--gold)" },
  { id: "event",        label: "MAS Events",        points: 300, color: "#b45309" },
  { id: "facetoface",   label: "Meetings / F2F",    points: 25,  color: "#7a5cc0" },
  { id: "mgo",          label: "MGO appts",         points: 10,  color: "#2f6fed" },
  { id: "conversation", label: "Conversations",     points: 10,  color: "#3f7d54" },
  { id: "note",         label: "Letters / notes",   points: 5,   color: "#c85a3a" },
  { id: "address",      label: "Address updates",   points: 5,   color: "#0f766e" },
  { id: "obituary",     label: "Obituaries",        points: 3,   color: "#64748b" },
  { id: "email",        label: "Emails / texts",    points: 2,   color: "#5b8bb0" },
  { id: "dial",         label: "Dials / VMs",       points: 1,   color: "#8a97a6" },
  { id: "failed",       label: "Invalid / failed",  points: 1,  color: "#c2c9d1" },
  { id: "donation",     label: "Dollars received",  points: 0,   color: "#c8972d" },
];

/* ---- Tracker category layout (Totals sheet) -----------------------------
 * Same groups the spreadsheet uses. `types` match Virtuous note type
 * (lowercased). Donation is the 100-pt gift credit, not gift dollars. */
export const TRACKER_LAYOUT = [
  {
    id: "dial",
    label: "Dial",
    section: true,
    children: [
      { id: "lvm", label: "LVM", types: ["mission advancement call | voicemail"] },
      { id: "disconnected", label: "Disconnected", types: ["mission advancement call | invalid number"] },
    ],
  },
  {
    id: "conversation",
    label: "Conversation",
    types: ["mission advancement call | conversation"],
  },
  {
    id: "email",
    label: "Email",
    section: true,
    children: [
      {
        id: "email_sent",
        label: "Sent",
        types: [
          "mission advancement call | email reach out",
          "text message",
        ],
      },
      {
        id: "email_bounced",
        label: "Bounced",
        types: ["mission advancement call | email inactive"],
      },
      {
        id: "email_response",
        label: "Response Rec'd",
        types: ["mission advancement call | email conversation"],
      },
    ],
  },
  {
    id: "letter",
    label: "Letter",
    section: true,
    children: [
      { id: "letter_sent", label: "Sent", types: ["letter"] },
      { id: "obituaries", label: "Obituaries", types: ["obituary"] },
      {
        id: "invalid_updates",
        label: "Invalid Updates",
        types: [
          "mission advancement | invalid mailing address",
          "as - address change/update",
        ],
      },
    ],
  },
  { id: "tours", label: "Tours", types: ["in person"] },
  { id: "live_mtg", label: "Live Mtg", types: ["mission advancement | meeting"] },
  {
    id: "events",
    label: "Events",
    types: ["mission advancement | event", "mission advancement | marketing event"],
  },
  { id: "donation", label: "Donation", buckets: ["gift"] },
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

/** If true, Invalid Number notes score 1 pt (tracker Disconnected). */
export const SETTINGS = {
  invalidNumberScores: true,
  /** Tracker credits a new monthly AC as 12 months of the monthly amount. */
  monthlyAnnualizeFactor: 12,
  /** Credit a gift only if an MA activity note on that contact is on or before the gift, within this many days. */
  giftNoteDaysBefore: 45,
};

/**
 * On-page tracking chart: tracker row → Virtuous note type → points.
 * Gifts first. Bounced is the Email Inactive note type.
 */
export const TRACKING_CHART = {
  refresh:
    "Virtuous is pulled every 15 minutes. A note usually shows on this page within 15 minutes of being saved.",
  gifts: [
    {
      label: "Dollars received",
      detail:
        "Posted gift on the same contact as an MA note. Note date on or before the gift, within 45 days. Linked by contact, not a field on the gift. A thank-you after the gift does not count.",
    },
    {
      label: "Secured gift · 100 pts",
      detail:
        "Note type New Donation or New AC, Annunciation Circle Updated, or Update Recurring Gift, plus a posted gift on that contact within 45 days after the note.",
    },
    {
      label: "Monthly AC",
      detail: "New monthly commitment is amount × 12. An increase is only the difference × 12.",
    },
  ],
  rows: [
    { tracker: "LVM", type: "Mission Advancement Call | Voicemail", pts: 1 },
    { tracker: "Disconnected", type: "Mission Advancement Call | Invalid Number", pts: 1 },
    { tracker: "Conversation", type: "Mission Advancement Call | Conversation", pts: 10 },
    { tracker: "Email Sent", type: "Mission Advancement Call | Email Reach Out", pts: 2 },
    { tracker: "Email Sent", type: "Text Message", pts: 2 },
    { tracker: "Bounced", type: "Mission Advancement Call | Email Inactive", pts: 1 },
    { tracker: "Response Rec’d", type: "Mission Advancement Call | Email Conversation", pts: 3 },
    { tracker: "Letter Sent", type: "Letter", pts: 5 },
    { tracker: "Obituaries", type: "Obituary", pts: 3 },
    { tracker: "Invalid Address", type: "Invalid Mailing Address · Address Change/Update", pts: 5 },
    { tracker: "Live Mtg / Tour", type: "In Person · Mission Advancement | Meeting", pts: 25 },
    { tracker: "Event", type: "Mission Advancement | Event", pts: 300 },
    { tracker: "Marketing Event", type: "Mission Advancement | Marketing Event", pts: 75 },
    { tracker: "Secured gift", type: "New Donation or New AC · AC Updated · Update Recurring Gift", pts: 100 },
  ],
};

/* ---- Virtuous deep-link base --------------------------------------------
 * Used by the calculation/audit export and the in-page drill-in to build a
 * click-through to the source record. A contact opens at
 * `${VIRTUOUS_APP_BASE}/Generosity/Contact/View/{id}` (same convention as the
 * annunciation publisher); the conversation log lives on that contact's Notes
 * tab. Org: Ave Maria University (org 6339). */
export const VIRTUOUS_APP_BASE = "https://app.virtuoussoftware.com";

/* ---- Activity definitions -----------------------------------------------
 * Plain-language rules the Methodology page shows so reviewers know exactly
 * what makes an activity count (beyond the raw point value). */
export const DEFINITIONS = [
  {
    term: "How logging works",
    text:
      "The dashboard only sees what is logged in Virtuous, on the donor’s contact, with the correct note type, authored by the MA. " +
      "A note on the wrong person, a generic type, a note after the gift, or no note at all will not count. " +
      "Gifts are the same: there must be an MA note on that contact on or before the gift date (within 45 days). " +
      "A posted gift with no MA note on the contact is not attributed. A thank-you logged after the gift does not pull that gift. " +
      "100 points additionally require a donation note type (‘New Donation or New AC’, ‘Annunciation Circle updated’, or ‘Update recurring gift’) paired with a posted gift.",
  },
  {
    term: "Secured gift (100 pts)",
    text:
      "A new or increased gift earns 100 points only when an MA logs a donation note in Virtuous " +
      "(‘New Donation or New AC’, ‘Annunciation Circle updated’, or ‘Update recurring gift’) and a matching posted gift exists with amount greater than 0. " +
      "Points land on the gift's week, not the note's week. Each donation note is matched to the earliest unused posted gift on the same contact with giftDate on or after the note date. " +
      "A donation note with no matching posted gift scores 0 points and is not counted as a secured gift. " +
      "A new monthly commitment is one gift (annualized dollars) and one 100-pt credit; later installments of that same commitment are not counted again. " +
      "An AC increase counts only the difference (new monthly − prior monthly) × 12, not the new full amount. " +
      "Points are attributed to whoever authored the note (Virtuous `createdByUser`). " +
      "Only notes and gifts on or after the author's roster start date count.",
  },
  {
    term: "Updated contact info / credit card (5 pts)",
    text:
      "Contact-information and credit-card updates COUNT for 5 points, per the PDF rubric (grouped with handwritten note / " +
      "TSM book). Logged via the ‘Mission Advancement | Invalid Mailing Address’ and address change/update note types. " +
      "(Previously flagged for review; confirmed counting 2026-08-14.)",
  },
  {
    term: "Obituary (3 pts)",
    text:
      "Obituary notes authored by an MA count as 3 points, matching the tracker. Non-MA authors are ignored.",
  },
  {
    term: "Invalid number (1 pt)",
    text:
      "Invalid / disconnected numbers count as 1 point, matching the tracker’s Disconnected rows. " +
      "Logged as ‘Mission Advancement Call | Invalid Number’. They also count as a dial.",
  },
  {
    term: "Count / Remove",
    text:
      "Every scored task is counted in the totals by default. Remove drops that task from points, activity counts, and gift totals. Count puts it back. The choice is shared for everyone looking at the dashboard.",
  },
  {
    term: "Dollars received",
    text:
      "A posted Virtuous gift counts for an MA only if that MA logged a note on that donor’s contact on or before the gift date (call, letter, in person, email, or donation note), within 45 days. " +
      "No note on the person = the gift is not counted. A thank-you after the gift does not claim it. GFT_Solicitor is not used (it is usually an MGO, not the MA). " +
      "One-time gifts use the posted amount. A new monthly AC (Recurring Gift, frequency Monthly) is counted once as monthly amount × 12. " +
      "If that contact already had an Annunciation Circle monthly gift, only the increase is counted: (new monthly − prior monthly) × 12. " +
      "The matching posted installment is not also added. Same-rate continuations are not counted again. " +
      "Only notes and gifts on or after the author's roster start date count.",
  },
  {
    term: "MA start date",
    text:
      "An MA with startDate on the roster is scored only on that local calendar day and after. " +
      "Notes before that day are ignored. A posted gift dated before that day is not attributed to them.",
  },
];
