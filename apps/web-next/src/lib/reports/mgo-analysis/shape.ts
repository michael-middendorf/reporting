/**
 * Snapshot from the mgo-analysis publisher (DST-2830), S3 `mgo-analysis/latest.json`,
 * plus the pure helpers the page uses to derive tiles and the donor list.
 */

export type MgoNoteKind = "outreach" | "face_to_face" | "proposal" | "plan";

export type MgoAnalysisDefinitions = {
  outreachTypes: string[];
  faceToFaceTypes: string[];
  proposalTypes: string[];
  planTypes: string[];
  topProspectTag: string;
  openAskExcludedStatuses: string[];
  fundedStatuses: string[];
};

export type MgoAnalysisMgo = {
  key: string;
  name: string;
  firstName: string;
  email?: string | null;
  groupName?: string | null;
};

export type MgoKpis = {
  fyRaised: number;
  openAskAmount: number;
  openAskCount: number;
  fundedAmount: number;
  fundedCount: number;
  donorCount: number;
};

export type MgoNote = {
  /** For outreach / face_to_face: the author MGO. For proposal / plan: the contact's assigned MGO. */
  mgo: string;
  contactId: number;
  kind: MgoNoteKind;
  date: string;
  /** Present on proposal rows so the team total can count each note once. */
  noteId?: number | string | null;
};

export type MgoDonor = {
  contactId: number;
  name: string;
  contactUrl?: string | null;
  assignedMgo: string;
  assignedFirstName: string;
  topProspect: boolean;
  openAskAmount: number;
  openAskCount: number;
  formalProposal: boolean;
  planFy27: string | null;
  planDate?: string | null;
  lastGiftDate: string | null;
  lastMgoActivityDate: string | null;
};

export type MgoAnalysisSnapshot = {
  generated_at?: string;
  source?: string;
  fiscalYear?: { label: string; start: string; end: string };
  asOf?: string;
  definitions?: MgoAnalysisDefinitions;
  mgos?: MgoAnalysisMgo[];
  kpisByMgo?: Record<string, MgoKpis>;
  notes?: MgoNote[];
  donors?: MgoDonor[];
  error?: string;
};

export const TEAM_KEY = "__team__";

export type Period = "week" | "month" | "quarter" | "fy";

export const PERIOD_LABELS: Record<Period, string> = {
  week: "This week",
  month: "This month",
  quarter: "This fiscal quarter",
  fy: "Full FY",
};

export type DateWindow = { start: string; end: string; label: string };

// ---------- dates (ISO YYYY-MM-DD, computed in UTC so no timezone drift) ----------

function parseIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** "2026-02-24" to "2/24/2026"; blank for null or junk. */
export function mdy(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/**
 * Window containing `asOf`:
 * week = Monday through Sunday; month = calendar month;
 * quarter = fiscal quarter (Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun);
 * fy = full fiscal year (Jul 1 through Jun 30).
 */
export function periodWindow(asOf: string, period: Period): DateWindow {
  const day = parseIso(asOf);
  let start: Date;
  let end: Date;
  if (period === "week") {
    const sinceMonday = (day.getUTCDay() + 6) % 7;
    start = addDays(day, -sinceMonday);
    end = addDays(start, 6);
  } else if (period === "month") {
    start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    end = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));
  } else if (period === "fy") {
    const fyStartYear = day.getUTCMonth() >= 6 ? day.getUTCFullYear() : day.getUTCFullYear() - 1;
    start = new Date(Date.UTC(fyStartYear, 6, 1));
    end = new Date(Date.UTC(fyStartYear + 1, 6, 0));
  } else {
    const m = day.getUTCMonth(); // 0 = Jan
    const qStart = m >= 6 ? (m >= 9 ? 9 : 6) : m >= 3 ? 3 : 0;
    start = new Date(Date.UTC(day.getUTCFullYear(), qStart, 1));
    end = new Date(Date.UTC(day.getUTCFullYear(), qStart + 3, 0));
  }
  const s = toIso(start);
  const e = toIso(end);
  return { start: s, end: e, label: `${mdy(s)} to ${mdy(e)}` };
}

function inWindow(date: string, window: { start: string; end: string } | null): boolean {
  if (!window) return true;
  const d = (date || "").slice(0, 10);
  return d >= window.start && d <= window.end;
}

/**
 * Count notes of one kind for one MGO (`mgoKey`) or the team (`null`).
 * Team view counts every row, except that a note listed once per assigned MGO
 * (proposal / plan rows for a contact in two portfolios) is counted once by noteId.
 */
export function countNotes(
  notes: readonly MgoNote[] | null | undefined,
  mgoKey: string | null,
  kind: MgoNoteKind,
  window: { start: string; end: string } | null,
): number {
  let count = 0;
  const seen = new Set<string>();
  for (const n of notes ?? []) {
    if (n.kind !== kind) continue;
    if (mgoKey != null && n.mgo !== mgoKey) continue;
    if (!inWindow(n.date, window)) continue;
    if (mgoKey == null && (kind === "proposal" || kind === "plan")) {
      // Fallback key when the publisher omits noteId: same contact, same day.
      const key =
        n.noteId != null && n.noteId !== ""
          ? `id:${n.noteId}`
          : `c:${n.contactId}|${(n.date || "").slice(0, 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    count += 1;
  }
  return count;
}

export type KpiTiles = MgoKpis & {
  activityNotes: number;
  faceToFace: number;
  proposalDocs: number;
  window: DateWindow | null;
};

const ZERO_KPIS: MgoKpis = {
  fyRaised: 0,
  openAskAmount: 0,
  openAskCount: 0,
  fundedAmount: 0,
  fundedCount: 0,
  donorCount: 0,
};

/** Header tiles for the team (`null`) or one MGO, with activity counts for `period`. */
export function kpisFor(
  snapshot: MgoAnalysisSnapshot | null | undefined,
  mgoKey: string | null,
  period: Period = "month",
): KpiTiles {
  const base = snapshot?.kpisByMgo?.[mgoKey ?? TEAM_KEY] ?? ZERO_KPIS;
  const notes = snapshot?.notes ?? [];
  const window = snapshot?.asOf ? periodWindow(snapshot.asOf, period) : null;
  const fy = snapshot?.fiscalYear ? { start: snapshot.fiscalYear.start, end: snapshot.fiscalYear.end } : null;
  return {
    ...ZERO_KPIS,
    ...base,
    activityNotes: window ? countNotes(notes, mgoKey, "outreach", window) : 0,
    faceToFace: window ? countNotes(notes, mgoKey, "face_to_face", window) : 0,
    proposalDocs: countNotes(notes, mgoKey, "proposal", fy),
    window,
  };
}

// ---------- donor list ----------

export type DonorFilters = {
  /** Assigned MGO key; null or "" = team (every row). */
  mgo?: string | null;
  topProspect?: boolean;
  hasPlan?: boolean;
  hasProposal?: boolean;
  hasOpen?: boolean;
  q?: string;
};

export function hasPlan(d: MgoDonor): boolean {
  return Boolean(d.planFy27 && d.planFy27.trim());
}

export function hasOpenAsk(d: MgoDonor): boolean {
  return (d.openAskAmount ?? 0) > 0 || (d.openAskCount ?? 0) > 0;
}

/** Every checked filter must match (AND). */
export function filterDonors(donors: readonly MgoDonor[] | null | undefined, f: DonorFilters): MgoDonor[] {
  const needle = (f.q ?? "").trim().toLowerCase();
  return (donors ?? []).filter((d) => {
    if (f.mgo && d.assignedMgo !== f.mgo) return false;
    if (f.topProspect && !d.topProspect) return false;
    if (f.hasPlan && !hasPlan(d)) return false;
    if (f.hasProposal && !d.formalProposal) return false;
    if (f.hasOpen && !hasOpenAsk(d)) return false;
    if (needle && !(d.name || "").toLowerCase().includes(needle)) return false;
    return true;
  });
}

export type DonorSortKey =
  | "topProspect"
  | "name"
  | "assignedFirstName"
  | "openAskAmount"
  | "formalProposal"
  | "planFy27"
  | "lastGiftDate"
  | "lastMgoActivityDate";

export type SortDir = "asc" | "desc";

export const DEFAULT_SORT: { key: DonorSortKey; dir: SortDir } = { key: "topProspect", dir: "desc" };

/** Comparable value; null means blank (always sorted last). */
function sortValue(d: MgoDonor, key: DonorSortKey): string | number | null {
  switch (key) {
    case "topProspect":
      return d.topProspect ? 1 : 0;
    case "formalProposal":
      return d.formalProposal ? 1 : 0;
    case "openAskAmount":
      return hasOpenAsk(d) ? d.openAskAmount ?? 0 : null;
    case "name":
      return (d.name || "").toLowerCase() || null;
    case "assignedFirstName":
      return (d.assignedFirstName || "").toLowerCase() || null;
    case "planFy27":
      return hasPlan(d) ? d.planFy27!.trim().toLowerCase() : null;
    case "lastGiftDate":
      return d.lastGiftDate || null;
    case "lastMgoActivityDate":
      return d.lastMgoActivityDate || null;
  }
}

/** Sort by one column, blanks last, then donor name A to Z. */
export function sortDonors(
  donors: readonly MgoDonor[],
  key: DonorSortKey = DEFAULT_SORT.key,
  dir: SortDir = DEFAULT_SORT.dir,
): MgoDonor[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...donors].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va !== vb) {
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -1 * sign;
      if (va > vb) return 1 * sign;
    }
    const byName = (a.name || "").localeCompare(b.name || "", "en", { sensitivity: "base" });
    if (byName !== 0) return byName;
    return (a.assignedFirstName || "").localeCompare(b.assignedFirstName || "");
  });
}

/** Shorten to about `max` characters on a word boundary, with an ellipsis. */
export function truncate(text: string | null | undefined, max = 80): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Whole dollars; "$0" for zero, "" for missing. */
export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}
