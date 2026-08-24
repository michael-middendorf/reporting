/** Shapes for the Fall Appeal snapshot (fall-appeal/latest.json).
 *
 * All figures are Virtuous gift data for the appeal campaign. Out of scope
 * (data lives outside Virtuous): direct-mail volume, email engagement, website
 * + digital-source analytics, response/conversion rates, and cost-derived
 * metrics (ROI, cost-to-raise, net-of-cost) + the Annual Fund goal.
 */

export type Totals = { revenue: number; gifts: number };

export type FallAppealSummary = {
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

/** Year-over-year point-in-time (pace) comparison vs a prior appeal campaign. */
export type FallAppealYoY = {
  priorCampaign: string;
  priorStart: string | null;
  /** Current appeal cumulative through today (its day-offset from start). */
  currentToDate: Totals;
  /** Prior appeal cumulative at the SAME day-offset ("where we were last year"). */
  priorToDate: Totals;
  /** Prior appeal final totals. */
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

export type SegmentRow = {
  key: string;
  label: string;
  group: "constituency" | "donorType";
  revenue: number;
  gifts: number;
  avgGift: number;
  donors: number;
};

export type StateRow = {
  state: string;
  revenue: number;
  gifts: number;
  donors: number;
  avgGift: number;
};

export type Geography = {
  topStates: StateRow[];
  donorsGeocoded: number;
  donorsTotal: number;
  partial: boolean;
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

export type MailSegment = {
  segment: string;
  revenue: number;
  gifts: number;
  avgGift: number;
};

export type FallAppealSnapshot = {
  generated_at: string;
  campaign: string;
  asOf: string;
  appealStart: string | null;
  campaignStart?: string | null;
  campaignEnd?: string | null;
  empty: boolean;
  summary: FallAppealSummary;
  yoy: FallAppealYoY | null;
  giftBreakdown: GiftBand[];
  segments: SegmentRow[];
  /** Spec segments not yet computable from tags (need multi-year fiscal history). */
  deferredSegments: string[];
  geography: Geography;
  timeline: TimelineWeek[];
  mailSegments: MailSegment[];
  overlays: { label: string; date: string }[];
  cache?: string;
  error?: string;
};

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

/** ISO date (`YYYY-MM-DD`) → `Aug 16, 2026`. Noon local avoids TZ day-shift. */
export function formatMdDate(iso: string | null | undefined): string {
  if (!iso) return "—";
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
