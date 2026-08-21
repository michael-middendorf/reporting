/** Snapshot written by the chapel-naming publisher (chapel-naming/latest.json). */

export type ChapelNamingGift = {
  id: number | null;
  contactId: number | null;
  donorName: string | null;
  amount: number;
  giftDate: string | null;
  project: string | null;
  specifics: string | null;
  namingOpportunity: string | null;
};

export type ChapelNamingItem = {
  item: string;
  chapelObject: string;
  quantity: number | null;
  itemAmount: number | null;
  fundingRequest: number | null;
  type: string | null;
  setNote: number | string | null;
  constructionNotes: string | null;
  fromCatalog: boolean;
  amountReceived: number;
  pctReceived: number | null;
  giftCount: number;
  donorCount: number;
  gifts: ChapelNamingGift[];
};

export type ChapelNamingSummary = {
  itemCount: number;
  extraItemCount: number;
  fundingRequest: number;
  amountReceived: number;
  pctReceived: number;
  fullyFunded: number;
  partial: number;
  unfunded: number;
  giftCount: number;
  donorCount: number;
};

export type ChapelNamingSnapshot = {
  generated_at: string;
  source: string;
  chapelProjects: string[];
  summary: ChapelNamingSummary;
  items: ChapelNamingItem[];
  cache?: string;
  error?: string;
};

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function fundingStatus(item: ChapelNamingItem): "funded" | "partial" | "unfunded" {
  if (item.fundingRequest && item.amountReceived >= item.fundingRequest - 0.005) return "funded";
  if (item.amountReceived > 0) return "partial";
  return "unfunded";
}
