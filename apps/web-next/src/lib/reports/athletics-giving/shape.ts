/** Snapshot from the athletics-giving publisher (Virtuous GiftDesignation). */
import { resolveSportKey, SPORTS, sportByKey } from "@/lib/reports/athletics-coaching/sports";

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

export type DatePreset = "this-week" | "this-month" | "fytd" | "all" | "custom";

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "fytd", label: "This fiscal year" },
  { id: "this-week", label: "This week" },
  { id: "this-month", label: "This month" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom dates" },
];

export function datePresetLabel(preset: DatePreset, fiscalYearLabel?: string | null): string {
  if (preset === "fytd") {
    return fiscalYearLabel ? `This fiscal year (${fiscalYearLabel})` : "This fiscal year";
  }
  return DATE_PRESETS.find((item) => item.id === preset)?.label || preset;
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function monthStartIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function rangeForPreset(
  preset: DatePreset,
  asOf: string,
  fyStart: string,
  customStart: string,
  customEnd: string,
): { start: string | null; end: string | null } {
  const day = asOf.slice(0, 10);
  if (preset === "this-week") return { start: addDaysIso(day, -7), end: day };
  if (preset === "this-month") return { start: monthStartIso(day), end: day };
  if (preset === "fytd") return { start: fyStart.slice(0, 10) || null, end: day };
  if (preset === "custom") return { start: customStart || null, end: customEnd || null };
  return { start: null, end: null };
}

export function totalsFromGifts(gifts: AthleticsGivingGift[]): AthleticsGivingTotals {
  let amount = 0;
  let program = 0;
  let fees = 0;
  const giftIds = new Set<string>();
  let anonymous = 0;
  for (const gift of gifts) {
    const value = Number(gift.amountDesignated) || 0;
    amount += value;
    if (gift.isFee) fees += value;
    else program += value;
    if (gift.giftId == null || gift.giftId === "") anonymous += 1;
    else giftIds.add(String(gift.giftId));
  }
  return {
    amount: roundMoney(amount),
    programAmount: roundMoney(program),
    feeAmount: roundMoney(fees),
    giftCount: giftIds.size + anonymous,
    designationCount: gifts.length,
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

const OTHER_SPORT = { key: "other", label: "General / other" } as const;

const CODE_TO_SPORT: Record<string, string> = {
  "6578MXC": "cross-country",
  "6580WXC": "cross-country",
};
for (const sport of SPORTS) {
  if (sport.virtuousProjectCode) CODE_TO_SPORT[sport.virtuousProjectCode] = sport.key;
}

export function sportForGift(gift: Pick<AthleticsGivingGift, "project" | "projectCode" | "isFee">): {
  key: string;
  label: string;
} {
  const code = (gift.projectCode || "").trim();
  if (gift.isFee || code === "CREDITCARDCOSTS") return { key: "other", label: "Processing fees" };
  if (code === "6117AthGEN" || code === "6644") return OTHER_SPORT;
  const fromCode = code ? CODE_TO_SPORT[code] : undefined;
  if (fromCode && sportByKey[fromCode]) return { key: fromCode, label: sportByKey[fromCode].label };
  const fromName = resolveSportKey(gift.project || "");
  if (fromName && sportByKey[fromName]) return { key: fromName, label: sportByKey[fromName].label };
  return OTHER_SPORT;
}

export type GivingFilters = {
  start: string | null;
  end: string | null;
  sportKey: string;
  fund: string;
  search: string;
};

export function filterGifts(gifts: AthleticsGivingGift[], filters: GivingFilters): AthleticsGivingGift[] {
  const needle = filters.search.trim().toLowerCase();
  return gifts.filter((gift) => {
    const day = gift.giftDate || "";
    if (filters.start && day < filters.start) return false;
    if (filters.end && day > filters.end) return false;
    if (filters.sportKey !== "all" && sportForGift(gift).key !== filters.sportKey) return false;
    if (filters.fund !== "all" && (gift.projectCode || gift.project || "") !== filters.fund) return false;
    if (!needle) return true;
    const sport = sportForGift(gift);
    return [gift.contactName, gift.project, gift.segment, gift.projectCode, sport.label]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export function fundsFromGifts(gifts: AthleticsGivingGift[]): AthleticsGivingFund[] {
  const buckets = new Map<string, AthleticsGivingFund & { ids: Set<string>; anonymous: number }>();
  for (const gift of gifts) {
    const key = `${gift.projectCode || ""}|${gift.project || ""}`;
    const bucket = buckets.get(key) || {
      project: gift.project,
      projectCode: gift.projectCode,
      amount: 0,
      giftCount: 0,
      isFee: Boolean(gift.isFee),
      ids: new Set<string>(),
      anonymous: 0,
    };
    bucket.amount += Number(gift.amountDesignated) || 0;
    if (gift.giftId == null || gift.giftId === "") bucket.anonymous += 1;
    else bucket.ids.add(String(gift.giftId));
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => ({
      project: bucket.project,
      projectCode: bucket.projectCode,
      amount: roundMoney(bucket.amount),
      giftCount: bucket.ids.size + bucket.anonymous,
      isFee: bucket.isFee,
    }))
    .sort((a, b) => b.amount - a.amount || (a.project || "").localeCompare(b.project || ""));
}

export function giftExportRows(gifts: AthleticsGivingGift[]): (string | number)[][] {
  return [
    ["Gift Date", "Donor", "Amount", "Fund", "Project Code", "Sport", "Segment", "Gift Type", "Gift ID"],
    ...gifts.map((gift) => [
      gift.giftDate || "",
      gift.contactName || "",
      gift.amountDesignated,
      gift.project || "",
      gift.projectCode || "",
      sportForGift(gift).label,
      gift.segment || "",
      gift.giftType || "",
      gift.giftId == null ? "" : String(gift.giftId),
    ]),
  ];
}
