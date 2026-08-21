/** Snapshot from the stained-glass-windows publisher. */

export type WindowGroupId = "rose" | "sanctuary" | "nave" | "unspecified" | string;

export type StainedGlassGift = {
  id: number | null;
  contactId: number | null;
  donorName: string | null;
  contactUrl: string | null;
  amount: number;
  giftDate: string | null;
  project: string | null;
  specifics: string | null;
  namingOpportunity: string | null;
};

export type StainedGlassWindow = {
  id: string;
  group: WindowGroupId;
  groupLabel: string;
  item: string;
  chapelObject: string | null;
  quantity: number | null;
  itemAmount: number | null;
  fundingRequest: number | null;
  fromInventory: boolean;
  amountReceived: number;
  remaining: number | null;
  pctReceived: number | null;
  giftCount: number;
  donorCount: number;
  gifts: StainedGlassGift[];
};

export type StainedGlassGroupSummary = {
  windowCount: number;
  extraWindowCount: number;
  fundingRequest: number;
  amountReceived: number;
  pctReceived: number;
  fullyFunded: number;
  partial: number;
  unfunded: number;
};

export type StainedGlassGroup = StainedGlassGroupSummary & {
  id: WindowGroupId;
  label: string;
  windows: StainedGlassWindow[];
};

export type StainedGlassSummary = StainedGlassGroupSummary & {
  giftCount: number;
  donorCount: number;
};

export type StainedGlassSnapshot = {
  generated_at: string;
  source: string;
  chapelProjects: string[];
  definition: string;
  summary: StainedGlassSummary;
  groups: StainedGlassGroup[];
  windows: StainedGlassWindow[];
  skipped?: { project: number; notWindow: number };
  cache?: string;
  error?: string;
};

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

export function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function fundingStatus(item: StainedGlassWindow): "funded" | "partial" | "unfunded" {
  if (item.fundingRequest && item.amountReceived >= item.fundingRequest - 0.005) return "funded";
  if (item.amountReceived > 0) return "partial";
  return "unfunded";
}
