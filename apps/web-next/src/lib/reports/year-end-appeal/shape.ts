/** Shapes for the Year-End Appeal snapshot (year-end-appeal/latest.json).
 *
 * Aggregates only. Gift figures are Virtuous CRM data keyed by the source code
 * on each gift (FYE27YE_{segment}_{length}_{asset}). No donor-level rows.
 */

export type Totals = { revenue: number; gifts: number };

export type YearEndSummary = {
  totalRevenue: number;
  totalGifts: number;
  avgGift: number;
  medianGift: number;
  donors: number;
};

export type PacePoint = {
  dayOffset: number;
  currentCum: Totals | null;
  priorCum: Totals | null;
};

export type YearEndYoY = {
  priorCampaign: string;
  priorStart: string | null;
  currentToDate: Totals;
  priorToDate: Totals;
  priorFinal: Totals;
  revenueDeltaPct: number | null;
  giftsDeltaPct: number | null;
  asOfOffset: number;
  points: PacePoint[];
};

export type GiftBand = {
  key: string;
  label: string;
  gifts: number;
  revenue: number;
  pctOfRevenue: number;
};

export type TimelineWeek = {
  weekStart: string;
  label: string;
  revenue: number;
  gifts: number;
  cumRevenue: number;
  cumGifts: number;
  overlays: string[];
};

/** Fields shared by every rolled-up bucket. mailed and responseRate are null until counts are loaded. */
export type BucketStats = {
  revenue: number;
  gifts: number;
  donors: number;
  avgGift: number;
  mailed: number | null;
  responseRate: number | null;
};

export type SegmentBucket = BucketStats & { key: string; label: string };
export type LengthBucket = BucketStats & { scope: string; length: string };
export type AssetBucket = BucketStats & { asset: string; label: string };
export type CodeRow = BucketStats & {
  code: string;
  segment: string | null;
  length: string | null;
  asset: string;
};

export type Unmatched = { revenue: number; gifts: number; codes: string[] };

export type YearEndSnapshot = {
  generated_at: string;
  campaign: string;
  asOf: string;
  campaignStart: string | null;
  campaignEnd: string | null;
  empty: boolean;
  summary: YearEndSummary;
  yoy: YearEndYoY | null;
  giftBreakdown: GiftBand[];
  timeline: TimelineWeek[];
  bySegment: SegmentBucket[];
  byLength: LengthBucket[];
  byAsset: AssetBucket[];
  byCode: CodeRow[];
  unmatched: Unmatched;
  mailedAvailable: boolean;
  overlays: { label: string; date: string }[];
  cache?: string;
  error?: string;
};

export const YEAR_END_CAMPAIGN = "2026 End of Calendar Year";
export const YEAR_END_START = "2026-11-13";
export const YEAR_END_END = "2027-06-30";

/** Empty snapshot with every section present, so the page renders before the first drop. */
export function emptySnapshot(overrides: Partial<YearEndSnapshot> = {}): YearEndSnapshot {
  return {
    generated_at: "",
    campaign: YEAR_END_CAMPAIGN,
    asOf: new Date().toISOString().slice(0, 10),
    campaignStart: YEAR_END_START,
    campaignEnd: YEAR_END_END,
    empty: true,
    summary: { totalRevenue: 0, totalGifts: 0, avgGift: 0, medianGift: 0, donors: 0 },
    yoy: null,
    giftBreakdown: [],
    timeline: [],
    bySegment: [],
    byLength: [],
    byAsset: [],
    byCode: [],
    unmatched: { revenue: 0, gifts: 0, codes: [] },
    mailedAvailable: false,
    overlays: [],
    ...overrides,
  };
}

/** Fill any section an older or partial snapshot lacks, so the page never reads undefined. */
export function normalizeSnapshot(raw: Partial<YearEndSnapshot>): YearEndSnapshot {
  const base = emptySnapshot();
  return {
    ...base,
    ...raw,
    summary: raw.summary ?? base.summary,
    giftBreakdown: raw.giftBreakdown ?? [],
    timeline: raw.timeline ?? [],
    bySegment: raw.bySegment ?? [],
    byLength: raw.byLength ?? [],
    byAsset: raw.byAsset ?? [],
    byCode: raw.byCode ?? [],
    unmatched: raw.unmatched ?? base.unmatched,
    overlays: raw.overlays ?? [],
    yoy: raw.yoy ?? null,
    mailedAvailable: Boolean(raw.mailedAvailable),
  };
}

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

/** Percent with two decimals, or n/a when the rate is unknown. */
export function pctOrNa(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return `${n.toFixed(2)}%`;
}

/** ISO date (`YYYY-MM-DD`) to `Nov 13, 2026`. Noon local avoids TZ day-shift. */
export function formatMdDate(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function addDaysIso(iso: string | null | undefined, days: number): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Head-to-head rows for 2P vs 4P in one scope ("total" or a donor segment). */
export function lengthPair(rows: LengthBucket[], scope: string): { twoPage: LengthBucket | null; fourPage: LengthBucket | null } {
  return {
    twoPage: rows.find((r) => r.scope === scope && r.length === "2P") ?? null,
    fourPage: rows.find((r) => r.scope === scope && r.length === "4P") ?? null,
  };
}

/** Distinct scopes present in byLength, "total" first. */
export function lengthScopes(rows: LengthBucket[]): string[] {
  const scopes = [...new Set(rows.map((r) => r.scope))];
  return scopes.sort((a, b) => (a === "total" ? -1 : b === "total" ? 1 : a.localeCompare(b)));
}
