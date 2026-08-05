import { apiFetch } from "@/lib/api";

export async function loadMasJson<T = unknown>(path: string): Promise<T> {
  const res = await apiFetch(`/api/reports/mas/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export type Scorecards = {
  summary_cards?: { id: string; label: string; value: string | number; context?: string }[];
  ma_leaderboard?: {
    ma_owner: string;
    outreach_notes?: number;
    two_way?: number;
    follow_on_gifts?: number;
    follow_on_amount?: number;
  }[];
};

export type Trends = {
  engagement_type_mix?: { label: string; count: number }[];
  momentum?: { label: string; value: number }[];
};

export function drilldownHref(spec: Record<string, unknown>) {
  return `/mas/drilldown?spec=${encodeURIComponent(JSON.stringify(spec))}`;
}
