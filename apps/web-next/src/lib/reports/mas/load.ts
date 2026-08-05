import { apiFetch } from "@/lib/api";

export async function loadMasJson<T = unknown>(path: string): Promise<T> {
  const res = await apiFetch(`/api/reports/mas/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Shapes as published on mas-report-cache …/data/ */
export type MasSummaryCard = {
  id: string;
  label: string;
  value: string | number;
  context?: string;
};

export type MasLeaderRow = {
  ma_owner: string;
  ma_owner_identity?: string;
  outreach_notes?: number;
  two_way_engagements?: number;
  one_way_outreach?: number;
  failed_contacts?: number;
  distinct_contacts?: number;
  follow_on_donors_30?: number;
  follow_on_donors_90?: number;
  follow_on_donors_365?: number;
  follow_on_dollars_30?: string | number;
  follow_on_dollars_90?: string | number;
  follow_on_dollars_365?: string | number;
};

export type Scorecards = {
  summary_cards?: MasSummaryCard[];
  leaderboard?: MasLeaderRow[];
  owners?: MasLeaderRow[];
  overall?: Record<string, unknown>;
};

export type Trends = {
  weekly?: unknown[];
  monthly?: unknown[];
  type_mix?: Record<string, number>;
  activity_totals?: Record<string, number>;
};

export type FollowOnGift = {
  gift_id?: number;
  contact_id?: number;
  contact_name?: string;
  gift_date?: string;
  gift_amount?: string | number;
  linked_ma_owner?: string;
  linked_engagement_type?: string;
  segment?: string;
};

export type Engagement = {
  ma_owner?: string;
  engagement_type?: string;
  engagement_bucket?: string;
  contact_name?: string;
  engagement_date?: string;
};

export function drilldownHref(spec: Record<string, unknown>) {
  return `/mas/drilldown?spec=${encodeURIComponent(JSON.stringify(spec))}`;
}

export function money(n: string | number | null | undefined) {
  if (n == null || n === "") return "—";
  const num = typeof n === "number" ? n : parseFloat(String(n).replace(/[$,]/g, ""));
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

export function leaderboardFrom(scorecards: Scorecards | null): MasLeaderRow[] {
  if (!scorecards) return [];
  return scorecards.leaderboard || scorecards.owners || [];
}
