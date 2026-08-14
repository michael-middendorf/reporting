/**
 * report.js — Calculation & audit export for the MA Points report.
 *
 * Turns the EXACT scored rows the dashboard totals from into a downloadable
 * CSV (opens in Excel / Google Sheets / Numbers), one line per task, with a
 * click-through link to the source record in Virtuous. Because it consumes the
 * same aggregate `model` the page renders, the summary block is guaranteed to
 * tie out to the on-screen totals — that's the whole point of an audit sheet.
 *
 * Uncounted / flagged tasks are included on purpose: to verify that *every*
 * task counted correctly you also have to see the ones that did NOT score.
 *
 * No external libraries: builds a string, triggers a Blob download.
 */
import { CONFLICTS, VIRTUOUS_APP_BASE } from "./config.js";

/** Deep link to the contact in Virtuous; the conversation log is its Notes tab. */
export function virtuousContactUrl(contactId) {
  if (!contactId) return "";
  return `${VIRTUOUS_APP_BASE}/Generosity/Contact/View/${contactId}`;
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
function statusOf(r) {
  if (r.unmatched) return "NOT COUNTED — type not in rubric";
  if (r.points === 0) return "counted (0 pts)";
  return "counted";
}

/** Conflict flag text (title → resolved value), or "". */
function conflictText(r) {
  if (!r.conflict) return "";
  const c = CONFLICTS[r.conflict];
  return c ? `${c.title} → scored as ${c.resolved}` : r.conflict;
}

/** Review-flag text for a row, given the shared flag map keyed by noteId. */
function reviewText(r, flags) {
  const f = flags && r.noteId != null ? flags[String(r.noteId)] : null;
  if (!f) return "";
  const who = f.flaggedBy ? ` by ${f.flaggedBy}` : "";
  const reason = f.reason ? `: ${f.reason}` : "";
  return `${f.status === "resolved" ? "RESOLVED" : "FLAGGED FOR REVIEW"}${who}${reason}`;
}

/**
 * Build the full calculation/audit CSV from an aggregate `model`
 * (see aggregate.js) for the currently selected date range. `flags` is the
 * shared review-flag map (noteId -> flag) so the audit sheet carries the same
 * review state shown in the dashboard.
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
  L.push(line(["Note", "Events are reference-only and excluded here — Virtuous events carry no MA owner and never score to an MA."]));
  L.push("");

  // --- Summary (reconciles to the dashboard) -------------------------------
  L.push(line(["SUMMARY — totals per MA (these match the dashboard exactly)"]));
  L.push(line(["MA", "Total Points", "Scored Activities", "Conversations", "Dials", "Uncounted / Flagged"]));
  for (const o of model.owners) {
    L.push(line([o.name, o.points, o.count, o.conversations, o.dials, o.unmatched]));
  }
  const t = model.totals;
  L.push(line(["TEAM TOTAL", t.points, t.count, t.conversations, t.dials, t.unmatched]));
  L.push("");

  // --- Detail: one row per task -------------------------------------------
  L.push(line(["DETAIL — every task (click 'Open in Virtuous' to read the log)"]));
  const cols = [
    "MA", "Date", "Weekday?", "Contact", "Contact ID", "Note Type (Virtuous)",
    "Activity", "Category", "Points", "Status", "Rule Source", "Conflict Flag",
    "Review Flag", "Note ID", "Open in Virtuous",
  ];
  L.push(line(cols));

  const rows = [...model.rows].sort(
    (a, b) => a.owner.localeCompare(b.owner) || a.day.localeCompare(b.day),
  );

  let curOwner = null;
  let subtotal = 0;
  const flush = () => {
    if (curOwner === null) return;
    // Subtotal row: label under "Activity", value under "Points".
    L.push(line(["", "", "", "", "", "", `Subtotal — ${curOwner}`, "", subtotal, "", "", "", "", "", ""]));
    L.push("");
  };

  for (const r of rows) {
    if (r.owner !== curOwner) {
      flush();
      curOwner = r.owner;
      subtotal = 0;
    }
    subtotal += r.points;
    L.push(line([
      r.owner,
      r.day,
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
    ]));
  }
  flush();

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
