/**
 * report.js — Calculation & audit export for the MA Points report.
 *
 * Turns the EXACT scored rows the dashboard totals from into a downloadable
 * CSV (opens in Excel / Google Sheets / Numbers), one line per task, with a
 * click-through link to the source record in Virtuous. Because it consumes the
 * same aggregate `model` the page renders, the summary block is guaranteed to
 * tie out to the on-screen totals — that's the whole point of an audit sheet.
 *
 * Uncounted / removed tasks are included on purpose: to verify that *every*
 * task counted correctly you also have to see the ones that did NOT score.
 *
 * No external libraries: builds a string, triggers a Blob download.
 */
import { CONFLICTS, VIRTUOUS_APP_BASE } from "./config.js";

function formatExportDay(iso) {
  if (!iso) return "";
  const d = new Date(String(iso) + (String(iso).includes("T") ? "" : "T00:00:00"));
  if (Number.isNaN(+d)) return String(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Deep link to the contact in Virtuous; the conversation log is its Notes tab. */
export function virtuousContactUrl(contactId) {
  if (!contactId) return "";
  return `${VIRTUOUS_APP_BASE}/Generosity/Contact/View/${contactId}`;
}

/** Deep link to the contact's Giving tab (gifts list). Gift/View is the raw record page. */
export function virtuousGiftUrl(contactId) {
  if (contactId == null || contactId === "") return "";
  return `${VIRTUOUS_APP_BASE}/Generosity/Contact/Gifts/${contactId}`;
}

/* ---- CSV helpers (RFC-4180) --------------------------------------------- */
/** Escape one cell. Also neutralizes CSV/formula injection (leading = + - @). */
function cell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // defang spreadsheet formula execution
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (cells) => cells.map(cell).join(",");

/** Human status for a scored row. */
export function statusOf(r) {
  if (r.removed) return "removed";
  if (r.unmatched) {
    // Coverage-gap notes (unknown type) vs donation notes in the rubric waiting on dollars.
    if (r.source === "unmatched" || !r.label) return "NOT COUNTED — type not in rubric";
    return "NOT COUNTED: awaiting posted gift";
  }
  if (r.points === 0) return "counted (0 pts)";
  return "counted";
}

/** Conflict flag text (title → resolved value), or "". */
function conflictText(r) {
  if (!r.conflict) return "";
  const c = CONFLICTS[r.conflict];
  return c ? `${c.title} → scored as ${c.resolved}` : r.conflict;
}

/** Count/remove text for a row, given the shared override map keyed by row id. */
function reviewText(r, flags) {
  if (!flags) return r.removed ? "REMOVED" : "";
  const id = r.noteId != null && r.noteId !== ""
    ? String(r.noteId)
    : (r.giftId != null && r.giftId !== "" ? `gift:${r.giftId}` : null);
  const f = id ? flags[id] : null;
  if (!f || f.status !== "removed") return r.removed ? "REMOVED" : "";
  const who = f.flaggedBy ? ` by ${f.flaggedBy}` : "";
  const reason = f.reason ? `: ${f.reason}` : "";
  return `REMOVED${who}${reason}`;
}

/**
 * Build the full calculation/audit CSV from an aggregate `model`
 * (see aggregate.js) for the currently selected date range. `flags` is the
 * shared count/remove map (row id -> flag) so the audit sheet carries the same
 * inclusion state shown in the dashboard.
 */
export function buildCalculationCSV(model, { meta = {}, rangeLabel = "All", generatedOn = "", flags = {} } = {}) {
  const L = [];

  // --- Provenance header ---------------------------------------------------
  L.push(line(["MA Points — Calculation & Audit Report"]));
  L.push(line(["Date range", rangeLabel]));
  if (generatedOn) L.push(line(["Report generated", generatedOn]));
  if (meta.generated_at) L.push(line(["Data last refreshed", meta.generated_at]));
  if (meta.sample) L.push(line(["WARNING", "SAMPLE DATA — not live Virtuous values"]));
  L.push(line(["How points work", "Each task is scored from its Virtuous note type against the MAS Points rubric. See the Methodology page for every rule."]));
  L.push(line(["Note", "Large-event hours on this dashboard score 25 per hour. A one-on-one Event or Marketing Event note on a contact still scores 25 points."]));
  L.push("");

  // --- Summary (reconciles to the dashboard) -------------------------------
  L.push(line(["SUMMARY — totals per MA (these match the dashboard exactly)"]));
  L.push(line(["MA", "Total Points", "Scored Activities", "Conversations", "Dials", "Gifts logged", "Dollars received", "Uncounted / Flagged"]));
  for (const o of model.owners) {
    L.push(line([o.name, o.points, o.count, o.conversations, o.dials, o.gifts || 0, o.giftAmount || 0, o.unmatched]));
  }
  const t = model.totals;
  L.push(line(["TEAM TOTAL", t.points, t.count, t.conversations, t.dials, t.gifts || 0, t.giftAmount || 0, t.unmatched]));
  L.push("");

  // --- Detail: one row per task -------------------------------------------
  L.push(line(["DETAIL — every task (click 'Open in Virtuous' / 'Open gift in Virtuous')"]));
  const cols = [
    "MA", "Date", "Weekday?", "Contact", "Contact ID", "Note Type (Virtuous)",
    "Activity", "Category", "Points", "Status", "Rule Source", "Conflict Flag",
    "Count/Remove", "Note ID", "Open in Virtuous", "Gift ID", "Open gift in Virtuous",
  ];
  L.push(line(cols));

  const rows = [...model.rows]
    .filter((r) => r.bucket !== "possible")
    .sort((a, b) => a.owner.localeCompare(b.owner) || a.day.localeCompare(b.day));

  let curOwner = null;
  let subtotal = 0;
  const flush = () => {
    if (curOwner === null) return;
    // Subtotal row: label under "Activity", value under "Points".
    const blank = Array(cols.length).fill("");
    blank[6] = `Subtotal — ${curOwner}`;
    blank[8] = subtotal;
    L.push(line(blank));
    L.push("");
  };

  for (const r of rows) {
    if (r.owner !== curOwner) {
      flush();
      curOwner = r.owner;
      subtotal = 0;
    }
    if (!r.removed) subtotal += r.points;
    L.push(line([
      r.owner,
      formatExportDay(r.day),
      r.weekday ? "Y" : "N (weekend)",
      r.contactName || "",
      r.contactId || "",
      r.type,
      r.label,
      r.bucket,
      r.points,
      statusOf(r),
      r.source || "",
      conflictText(r),
      reviewText(r, flags),
      r.noteId || "",
      virtuousContactUrl(r.contactId),
      r.giftId || "",
      r.giftId ? virtuousGiftUrl(r.contactId) : "",
    ]));
  }
  flush();

  // --- Gifts (same list as Donations Received) -----------------------------
  L.push(line(["GIFTS — posted gifts attributed in this range"]));
  L.push(line([
    "MA", "Date", "Donor", "Contact ID", "Type", "Designation",
    "Amount", "Gift ID", "Open gift in Virtuous",
  ]));
  const giftRows = [...(model.gifts || [])].sort(
    (a, b) => (a.owner || "").localeCompare(b.owner || "") || (a.day || "").localeCompare(b.day || ""),
  );
  for (const g of giftRows) {
    L.push(line([
      g.owner,
      formatExportDay(g.day),
      g.contactName || "",
      g.contactId || "",
      g.annualized ? "Monthly ×12" : (g.giftType || ""),
      g.project || "",
      g.amount || 0,
      g.giftId || "",
      virtuousGiftUrl(g.contactId),
    ]));
  }
  L.push("");

  L.push(line(["INCOMING GIFTS — posted after a conversation or meeting, no donation note yet"]));
  L.push(line([
    "Possible MAs", "Gift date", "Donor", "Contact ID", "Kind", "Amount", "Nearest note", "Note date",
    "Days after note", "Already in Raised", "Gift ID", "Open contact in Virtuous", "Open gift in Virtuous",
  ]));
  const possibleRows = [...(model.possibleGifts || [])].sort(
    (a, b) => (a.day || "").localeCompare(b.day || "") || (a.contactName || "").localeCompare(b.contactName || ""),
  );
  for (const g of possibleRows) {
    const mas = (g.owners || []).map((o) => o.name).filter(Boolean);
    L.push(line([
      mas.length ? mas.join("; ") : (g.owner || ""),
      formatExportDay(g.day),
      g.contactName || "",
      g.contactId || "",
      g.kindLabel || g.giftType || "",
      g.amount || 0,
      g.noteType || g.noteLabel || "",
      formatExportDay(g.noteDay),
      g.daysAfterNote ?? "",
      g.inRaised ? "Y" : "N",
      g.giftId || "",
      virtuousContactUrl(g.contactId),
      virtuousGiftUrl(g.contactId),
    ]));
  }

  L.push("");
  L.push(line(["MGO-CODED GIFTS — listed for review, not in Raised until assigned"]));
  L.push(line([
    "MA (note owner)", "Date", "Donor", "Contact ID", "Type", "Designation",
    "Amount", "Gift ID", "Open gift in Virtuous", "Status",
  ]));
  const reviewRows = [...(model.reviewGifts || [])].sort(
    (a, b) => (a.owner || "").localeCompare(b.owner || "") || (a.day || "").localeCompare(b.day || ""),
  );
  for (const g of reviewRows) {
    L.push(line([
      g.owner,
      formatExportDay(g.day),
      g.contactName || "",
      g.contactId || "",
      g.annualized ? "Monthly ×12" : (g.giftType || ""),
      g.project || "",
      g.amount || 0,
      g.giftId || "",
      virtuousGiftUrl(g.contactId),
      "not in Raised until assigned",
    ]));
  }

  return L.join("\r\n");
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadText(filename, text, mime = "text/csv;charset=utf-8;") {
  // Leading BOM so Excel reads UTF-8 (accents in donor names, curly quotes).
  const blob = new Blob(["﻿" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
