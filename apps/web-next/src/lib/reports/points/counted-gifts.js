/**
 * Gifts listed on the MA tracker.
 * Matching is name + amount + date only. A match does not assign Raised;
 * scoreAll requires a donation note or an Incoming / MGO assignment.
 */
import { MA_ROSTER } from "./config.js";
import countedJson from "./counted-gifts.json";

export const COUNTED_SPREADSHEET_GIFTS = countedJson;

const STOP = new Set(["and", "the", "for", "with", "from", "mrs", "mr", "ms"]);

function tokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function overlap(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  let n = 0;
  for (const t of A) if (B.has(t)) n += 1;
  return n;
}

function amountsClose(posted, sheet, monthlySheet) {
  const x = Number(posted);
  const y = Number(sheet);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return false;
  if (Math.abs(x - y) <= 0.6) return true;
  if (Math.abs(x * 12 - y) <= 1.5) return true;
  if (Math.abs(y * 12 - x) <= 1.5) return true;
  if (monthlySheet && Math.abs(x * 12 - y) <= 2) return true;
  return false;
}

function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 99;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function lastNamesClose(a, b) {
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  return a.length >= 4 && b.length >= 4 && editDistance(a, b) <= 1;
}

function daysApart(a, b) {
  if (!a || !b) return 99;
  const ms = Math.abs(new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`));
  return Math.round(ms / 86400000);
}

/** Map "Elena", "Betsy and Caleb" to roster MA names (all of them). */
export function rosterOwnersFromSheetName(name) {
  const parts = String(name || "")
    .split(/\s+and\s+|\/|,/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const hit = MA_ROSTER.find((m) => {
      const full = m.name.toLowerCase();
      const short = String(m.short || "").toLowerCase();
      const needle = p.toLowerCase();
      return full === needle || short === needle || full.startsWith(`${needle} `);
    });
    if (hit && !seen.has(hit.name)) {
      seen.add(hit.name);
      out.push(hit.name);
    }
  }
  return out;
}

export function rosterOwnerFromSheetName(name) {
  return rosterOwnersFromSheetName(name)[0] || null;
}

export function matchCountedSpreadsheetGift(gift, counted = COUNTED_SPREADSHEET_GIFTS, used = new Set()) {
  const donor = gift.contactName || gift.name || "";
  const posted = Number(gift.postedAmount || gift.amount) || 0;
  const monthly = Number(gift.newMonthly) || 0;
  const day = gift.day;
  const lastGift = tokens(donor).pop() || "";
  // Gift Query rows often have no donor name. A blank name must not match
  // another household on amount and date alone.
  if (!lastGift) return null;
  let best = null;
  let bestScore = Infinity;
  counted.forEach((row, i) => {
    if (used.has(i)) return;
    if (String(row.received || "").trim().toLowerCase() === "no") return;
    const owners = rosterOwnersFromSheetName(row.owner);
    if (!owners.length) return;
    const names = overlap(donor, row.donor);
    const lastSheet = tokens(row.donor).pop() || "";
    if (!lastSheet || !lastNamesClose(lastGift, lastSheet)) return;
    const gap = daysApart(day, row.day);
    if (gap > 21) return;
    const amountOk =
      amountsClose(posted, row.amount, row.monthly) ||
      amountsClose(monthly, row.amount, row.monthly) ||
      amountsClose(monthly * 12, row.amount, false);
    if (!amountOk || names < 1) return;
    const score = gap * 10 - names;
    if (score < bestScore) {
      bestScore = score;
      best = { index: i, owner: owners[0], owners, row };
    }
  });
  return best;
}
