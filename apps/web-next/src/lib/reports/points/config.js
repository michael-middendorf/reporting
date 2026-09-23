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

export function maForEmail(email) {
  const n = String(email || "").trim().toLowerCase();
  if (!n) return null;
  return MA_ROSTER.find((m) => (m.email || "").toLowerCase() === n) || null;
}

/** Virtuous note type used when assigning an Incoming gift. */
export function noteTypeForIncoming(kind, assist = false) {
  if (assist) return "Mission Advancement | Gift Assist";
  if (kind === "ac-increase") return "Mission Advancement | Update Recurring Gift";
  return "Mission Advancement | New Donation or New AC";
}

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
    resolved: "Large events: 25 points per hour on this dashboard. One-on-one Event notes on a contact: 25 points.",
    note: "Add Event hours here for large events only. A Mission Advancement | Event or Marketing Event note on a donor’s contact still counts as 25 points (one-on-one).",
  },
  mgo_appointment: {
    title: "Appointment set for MGO (10 pts)",
    pdf: "10 points for an appointment set for an MGO with a qualified prospect.",
    spreadsheet: "Not a discrete line item.",
    resolved: "Mapped to MGO task/note types (see below), else unmatched",
    note: "Best-effort mapped to the ‘FY27 MGO Goal Activity’ note type / ‘FY27 MGO Goal Task’. Confirm this is how MAs log MGO appointments.",
  },
  invalid_address: {
    title: "Invalid / updated mailing address",
    pdf: "Updated contact info / credit card is 5 pts.",
    spreadsheet: "‘Invalid Address’ is given 1 point.",
    resolved: "1 point",
    note: "Counted at 1 point to match the tracker (confirmed 2026-09-09). Logged as ‘Mission Advancement | Invalid Mailing Address’ or ‘AS - Address Change/Update’.",
  },
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
    resolved: "25 points when logged on a contact (one-on-one). Large events use hours on this dashboard.",
    note: "A ‘Mission Advancement | Event’ or ‘Marketing Event’ note on a donor still counts at 25 points, same as a meeting. Use Add Event hours only for large events.",
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
  "mission advancement | gift assist":
    { points: 100, bucket: "gift", label: "Gift assist", source: "spreadsheet", assist: true },
  "mission advancement | verbal gift commitment":
    { points: 0, bucket: "commitment", label: "Verbal commitment", source: "note" },

  "general":    { points: 0, bucket: "general", label: "General note", source: "assumed" },
  "letter":     { points: 5, bucket: "note", label: "Handwritten note / letter", source: "pdf+spreadsheet" },
  "text message": { points: 2, bucket: "email", label: "Text message", source: "spreadsheet", conflict: "email_sent" },
  "in person":  { points: 25, bucket: "facetoface", label: "Face-to-face (coffee/lunch)", source: "pdf+spreadsheet" },

  "mission advancement | invalid mailing address":
    { points: 1, bucket: "address", label: "Invalid mailing address", source: "spreadsheet", conflict: "invalid_address" },
  "as - address change/update":
    { points: 1, bucket: "address", label: "Address change/update", source: "spreadsheet", conflict: "invalid_address" },

  "obituary":
    { points: 3, bucket: "obituary", label: "Obituary", source: "spreadsheet", conflict: "obituary" },

  "mission advancement | event":
    { points: 25, bucket: "event", label: "One-on-one event", source: "pdf", conflict: "mas_event_note" },
  "mission advancement | marketing event":
    { points: 25, bucket: "event", label: "One-on-one marketing event", source: "pdf", conflict: "mas_event_note" },

  "mission advancement | meeting":
    { points: 25, bucket: "facetoface", label: "MAS Meeting (face-to-face)", source: "pdf", conflict: "mas_meeting_note" },

  "fy27 mgo goal activity":
    { points: 10, bucket: "mgo", label: "MGO appointment set", source: "assumed", conflict: "mgo_appointment" },
};

/* ---- Bucket display order + colors (for the activity breakdown) ---------- */
export const BUCKETS = [
  { id: "gift",         label: "Gifts secured",     points: 100, color: "var(--gold)" },
  { id: "event",        label: "MAS Events",        points: 25,  color: "#b45309" },
  { id: "facetoface",   label: "Meetings / F2F",    points: 25,  color: "#7a5cc0" },
  { id: "mgo",          label: "MGO appts",         points: 10,  color: "#2f6fed" },
  { id: "conversation", label: "Conversations",     points: 10,  color: "#3f7d54" },
  { id: "note",         label: "Letters / notes",   points: 5,   color: "#c85a3a" },
  { id: "address",      label: "Address updates",   points: 1,   color: "#0f766e" },
  { id: "obituary",     label: "Obituaries",        points: 3,   color: "#64748b" },
  { id: "email",        label: "Emails / texts",    points: 2,   color: "#5b8bb0" },
  { id: "dial",         label: "Dials / VMs",       points: 1,   color: "#8a97a6" },
  { id: "failed",       label: "Invalid / failed",  points: 1,  color: "#c2c9d1" },
  { id: "donation",     label: "Dollars received",  points: 0,   color: "#c8972d" },
];

/* ---- Tracker category layout (Totals sheet) -----------------------------
 * Same groups the spreadsheet uses. `types` match Virtuous note type
 * (lowercased). Gift is one row per posted gift: the dollars and the 100 pts. */
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
    buckets: ["event"],
  },
  {
    id: "donation",
    label: "Gift",
    buckets: ["donation"],
  },
  { id: "assist", label: "Assist", types: ["mission advancement | gift assist"] },
];

/* ---- Event scoring ------------------------------------------------------
 * Large events: hours added on this dashboard × EVENT_POINTS_PER_HOUR.
 * One-on-one: Virtuous Event notes on a contact still score (see POINTS_MAP). */
export const EVENT_RULES = [];

/** Dashboard-added events (reporting only, not written to Virtuous). */
export const EVENT_POINTS_PER_HOUR = 25;

export const TRACKED_EVENT_TYPES = [
  { id: "community", label: "Community Event", type: "Community Event" },
  { id: "tours", label: "Tours", type: "Tours" },
  { id: "amu", label: "AMU Event", type: "AMU Event" },
  { id: "event", label: "Event", type: "Mission Advancement | Event" },
  { id: "marketing", label: "Marketing Event", type: "Mission Advancement | Marketing Event" },
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
  /** A contact note counts only on or before the gift, within this many days. Notes after the gift date do not count. */
  giftNoteDaysBefore: 45,
  /**
   * If the last Annunciation Circle gift on the contact is older than this
   * many days, the membership lapsed. A new signup is the full monthly
   * amount × 12, not an increase off the old rate.
   */
  acLapseDays: 45,
  /**
   * Posted gifts counted as assists (100 pts, $0) even before a Gift Assist
   * note is logged. Sean Kelly / Ursula Pfahl $10k QCD 9/1/2026, solicitor
   * Colleen Dolnick MGO.
   */
  assistGiftIds: ["451486"],
  /**
   * Monday of the first All / leaderboard week. Second week of August 2026
   * (Mon Aug 10 – Sun Aug 16). Weeks before this are not listed.
   */
  evalStart: "2026-08-10",
};

/** Local calendar date for SETTINGS.evalStart (YYYY-MM-DD, not UTC midnight). */
export function evalStartDate() {
  const [y, m, d] = String(SETTINGS.evalStart).split("-").map(Number);
  return new Date(y, m - 1, d);
}

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
        "Posted gift counted in Raised only with 100 points: a New Donation or New AC, Annunciation Circle updated, or Update Recurring Gift note within 45 days before or after the gift, or an Incoming / MGO assignment. A conversation or meeting alone puts the gift on Incoming, not Raised. Credit goes to whoever logged that gift note, not the MA officer on the account. A letter, email, voicemail, or thank-you does not pull the gift. A row on the MA gift tracker does not assign the gift by itself. Gifts coded Direct Solicitation (MGO) show under MGO-coded gifts until assigned. A non-MA GFT_Solicitor is listed the same way.",
    },
    {
      label: "Secured gift · 100 pts",
      detail:
        "Note type New Donation or New AC, Annunciation Circle Updated, or Update Recurring Gift, plus a posted gift on that contact within 45 days after the note.",
    },
    {
      label: "Gift assist · 100 pts",
      detail:
        "Note type Mission Advancement | Gift Assist, plus a posted gift on that contact within 45 days. 100 points, no dollars. Use this when you assisted on a gift credited to someone else.",
    },
    {
      label: "Monthly AC",
      detail:
        "New monthly commitment is amount × 12. An increase on an active AC is only the difference × 12. " +
        "If they lapsed (no AC gift in the last 45 days) and signed up again, count the full new amount × 12.",
    },
    {
      label: "Incoming gifts",
      detail:
        "Posted gift (one-time, Mission Fund, new AC, or AC increase) after an MA conversation or meeting in the 45 days before the gift, with no donation note yet. Not Raised and not 100 points until assigned. A gala ticket purchase is a new donation: a conversation, two-way email, or meeting within 45 days of that gift counts it in Raised for the MA who spoke with the donor. Assign an MA here (or log the gift note in Virtuous) to count any other gift and 100 pts together.",
    },
    {
      label: "Event hours · 25 pts/hour",
      detail:
        "Large events only. Add an event on this dashboard with hours. Points = hours × 25 for the chosen MA. Reporting only — it does not create a Virtuous event or note. A one-on-one Event note on a contact still counts at 25 points.",
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
    { tracker: "Invalid Address", type: "Invalid Mailing Address · Address Change/Update", pts: 1 },
    { tracker: "Live Mtg / Tour", type: "In Person · Mission Advancement | Meeting", pts: 25 },
    { tracker: "Event (1:1)", type: "Mission Advancement | Event · Marketing Event on a contact", pts: 25 },
    { tracker: "Event hours", type: "Large event — Add Event on this dashboard", pts: 25 },
    { tracker: "Secured gift", type: "New Donation or New AC · AC Updated · Update Recurring Gift", pts: 100 },
    { tracker: "Gift Assist", type: "Mission Advancement | Gift Assist", pts: 100 },
  ],
};

/* ---- Virtuous deep-link base --------------------------------------------
 * Used by the calculation/audit export and the in-page drill-in to build a
 * click-through to the source record. A contact opens at
 * `${VIRTUOUS_APP_BASE}/Generosity/Contact/View/{id}` (same convention as the
 * annunciation publisher); the conversation log lives on that contact's Notes
 * tab. A gift opens the contact's Giving tab at
 * `${VIRTUOUS_APP_BASE}/Generosity/Contact/Gifts/{id}` (not Gift/View, which is
 * the raw record page). Org: Ave Maria University (org 6339). */
export const VIRTUOUS_APP_BASE = "https://app.virtuoussoftware.com";

/* ---- Activity definitions -----------------------------------------------
 * Plain-language rules the Methodology page shows so reviewers know exactly
 * what makes an activity count (beyond the raw point value). */
export const DEFINITIONS = [
  {
    term: "How logging works",
    text:
      "The dashboard scores what is logged in Virtuous, on the donor’s contact, with the correct note type, authored by the MA. " +
      "Large-event hours added on this dashboard count at 25 points per hour and are not written to Virtuous. " +
      "A one-on-one Event or Marketing Event note on a contact still counts at 25 points. " +
      "A note on the wrong person, a generic type, a note after the gift, or no note at all will not count. " +
      "Raised dollars and 100 gift points always go together. A conversation or meeting on the donor, within 45 days, puts the gift on Incoming — not Raised and not 100 points — until someone assigns it or logs a donation note. " +
      "A New Donation note can be logged up to 45 days after the gift posts and still count. " +
      "A row on the MA gift tracker does not assign the gift by itself. " +
      "A letter, email, voicemail, or thank-you does not pull the gift. A thank-you logged after the gift does not pull that gift. " +
      "100 points require a donation note type (‘New Donation or New AC’, ‘Annunciation Circle updated’, or ‘Update recurring gift’), an Incoming assignment, or a Gift Assist note, paired with a posted gift. Gift Assist is 100 points and does not count dollars.",
  },
  {
    term: "Incoming gifts",
    text:
      "Incoming gifts are posted Virtuous gifts (one-time, Mission Fund, new Annunciation Circle, or an AC increase) on a donor an MA actually spoke with " +
      "(phone conversation, two-way email, in-person, or MAS meeting) on or before the gift date, within 45 days, " +
      "when there is no matching donation note yet. Every MA who spoke with that donor in the window is listed. " +
      "This is a review list, not points and not Raised. A voicemail, letter, or email-sent does not put a gift here. " +
      "Anyone can assign an MA. That scores 100 points and counts the gift in Raised immediately. " +
      "It does not write a note to Virtuous. Gift Assist is 100 points and $0. " +
      "If it was not because of you, leave it.",
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
    term: "Gift assist (100 pts, no dollars)",
    text:
      "Log ‘Mission Advancement | Gift Assist’ on the donor’s contact when you assisted on a gift credited to someone else (usually an MGO). " +
      "It scores 100 points when a posted gift on that contact is on or after the note, within 45 days. Dollars are not counted for that gift. " +
      "A tour or call on the same contact does not pull the dollars either once the gift is an assist.",
  },
  {
    term: "Invalid Address (1 pt)",
    text:
      "Invalid mailing address and address change/update notes count as 1 point, matching the tracker’s Invalid Address row. " +
      "Logged as ‘Mission Advancement | Invalid Mailing Address’ or ‘AS - Address Change/Update’.",
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
    term: "Event hours (25 pts per hour)",
    text:
      "Large events only. Add an event on the Points dashboard with an event type and hours. It scores 25 points per hour to the chosen MA. " +
      "It does not create a Virtuous event or note. One-on-one Event notes on a contact still count separately at 25 points.",
  },
  {
    term: "One-on-one Event (25 pts)",
    text:
      "Log ‘Mission Advancement | Event’ or ‘Mission Advancement | Marketing Event’ on the donor’s contact. " +
      "It scores 25 points, same as a meeting, because it is one-on-one. Do not use Add Event hours for that.",
  },
  {
    term: "Count / Remove",
    text:
      "Every scored task is counted in the totals by default. Remove drops that task from points, activity counts, and gift totals. Count puts it back. The choice is shared for everyone looking at the dashboard.",
  },
  {
    term: "Dollars received",
    text:
      "A posted Virtuous gift counts in Raised only with 100 points: a donation note on that contact within 45 days before the gift, or a donation note within 45 days after the gift, or an Incoming assignment, or an assigned MGO-coded gift. " +
      "A gala ticket purchase counts the same way when an MA has a conversation, two-way email, or meeting on that contact within 45 days of the gift. A gala invitation does not claim a different gift. " +
      "A conversation or meeting alone does not count the gift in Raised — it stays on Incoming. " +
      "A letter, email, voicemail, or thank-you does not claim the gift. A row on the MA gift tracker does not assign the gift by itself. Gift Assist notes do not count dollars. " +
      "Dollars go to the MA who logged the note, not the MA officer on the contact and not GFT_Solicitor. " +
      "Gifts coded Direct Solicitation (MGO) or Direct Solicitation (MGO)-HIST_DS show under MGO-coded gifts until assigned to an MA. " +
      "A nonempty GFT_Solicitor who is not on the MA roster is listed the same way. " +
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
  {
    term: "Leaderboard period",
    text:
      "All-weeks ranks, totals, and personal bests start on Monday of the second week of August (Aug 10, 2026) and run forward. " +
      "Activity before that week is not on the All leaderboard. Pick a single week to see only that week.",
  },
];
