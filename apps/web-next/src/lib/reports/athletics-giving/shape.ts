/** Snapshot from the athletics-giving publisher (Virtuous GiftDesignation). */

export const ATHLETICS_GIVING_CACHE_KEY =
  process.env.ATHLETICS_GIVING_CACHE_KEY || "athletics-giving/latest.json";

export const FEE_PROJECT_CODES = new Set(["CREDITCARDCOSTS"]);

export type AthleticsGivingTotals = {
  amount: number;
  programAmount: number;
  feeAmount: number;
  giftCount: number;
  designationCount: number;
};

export type AthleticsGivingFund = {
  project: string | null;
  projectCode: string | null;
  amount: number;
  giftCount: number;
  isFee: boolean;
};

export type AthleticsGivingGift = {
  giftId: number | string | null;
  giftDate: string | null;
  contactId: number | string | null;
  contactName: string | null;
  contactUrl: string | null;
  amountDesignated: number;
  project: string | null;
  projectCode: string | null;
  segment: string | null;
  segmentCode: string | null;
  giftType: string | null;
  isFee: boolean;
  isPrivate: boolean;
};

export type AthleticsGivingSnapshot = {
  generated_at: string;
  source: "virtuous";
  segments: string[];
  fiscalYear: number;
  fiscalYearLabel: string;
  fyStart: string;
  fyEnd: string;
  asOf: string;
  weekly: AthleticsGivingTotals;
  fytd: AthleticsGivingTotals;
  allTime: AthleticsGivingTotals;
  funds: AthleticsGivingFund[];
  gifts: AthleticsGivingGift[];
  error?: string;
};

export function isGivingReady(data: AthleticsGivingSnapshot | null | undefined): data is AthleticsGivingSnapshot {
  return Boolean(data?.source === "virtuous" && Array.isArray(data.gifts) && data.weekly && data.fytd);
}

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function usdExact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatGiftDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${month}/${day}/${year}`;
}

export function giftsInRange(
  gifts: AthleticsGivingGift[],
  start: string | null,
  end: string | null,
): AthleticsGivingGift[] {
  return gifts.filter((gift) => {
    const day = gift.giftDate || "";
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  });
}
