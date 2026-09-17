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

export function isHiddenAthleticsFund(project: string | null | undefined): boolean {
  return (project || "").trim().toLowerCase() === "aquinas center";
}

export function intersectDateRange(
  aStart: string | null,
  aEnd: string | null,
  bStart: string,
  bEnd: string,
): { start: string; end: string } | null {
  if (!bStart || !bEnd) return null;
  const start = aStart && aStart > bStart ? aStart : bStart;
  const end = aEnd && aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return null;
  return { start, end };
}

export function giftsFromLastTwoFiscalYears(
  gifts: AthleticsGivingGift[],
  fyStart: string,
): AthleticsGivingGift[] {
  const cutoff = previousFiscalYearWindow(fyStart).start;
  return gifts.filter((gift) => {
    if (isHiddenAthleticsFund(gift.project)) return false;
    if (cutoff && (gift.giftDate || "") < cutoff) return false;
    return true;
  });
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

export type DatePreset = "this-week" | "last-week" | "this-month" | "fytd" | "last-fy" | "all" | "custom";

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "fytd", label: "FY27" },
  { id: "last-fy", label: "FY26" },
  { id: "this-week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "this-month", label: "This month" },
  { id: "all", label: "FY26 + FY27" },
  { id: "custom", label: "Date range" },
];

export function previousFiscalYearWindow(fyStart: string): { start: string; end: string } {
  const start = fyStart.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { start: "", end: "" };
  const year = Number(start.slice(0, 4));
  return { start: `${year - 1}${start.slice(4)}`, end: addDaysIso(start, -1) };
}

export function previousFiscalYearLabel(fiscalYearLabel: string | null | undefined): string {
  const match = (fiscalYearLabel || "").match(/^FY\s+(\d{4})-(\d{2})$/);
  if (!match) return "Last fiscal year";
  return `FY ${Number(match[1]) - 1}-${String(Number(match[2]) - 1).padStart(2, "0")}`;
}

export function shortFiscalYearLabel(fiscalYearLabel: string | null | undefined): string {
  const match = (fiscalYearLabel || "").match(/^FY\s+\d{4}-(\d{2})$/);
  return match ? `FY${match[1]}` : "FY";
}

export function shortPreviousFiscalYearLabel(fiscalYearLabel: string | null | undefined): string {
  const match = (fiscalYearLabel || "").match(/^FY\s+\d{4}-(\d{2})$/);
  if (!match) return "FY";
  return `FY${String(Number(match[1]) - 1).padStart(2, "0")}`;
}

export function datePresetLabel(preset: DatePreset, fiscalYearLabel?: string | null): string {
  const thisFy = shortFiscalYearLabel(fiscalYearLabel);
  const lastFy = shortPreviousFiscalYearLabel(fiscalYearLabel);
  if (preset === "fytd") return thisFy === "FY" ? "This fiscal year" : thisFy;
  if (preset === "last-fy") return lastFy === "FY" ? "Last fiscal year" : lastFy;
  if (preset === "all") return thisFy === "FY" ? "FY26 + FY27" : `${lastFy} + ${thisFy}`;
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
  if (preset === "last-week") return { start: addDaysIso(day, -14), end: addDaysIso(day, -8) };
  if (preset === "this-month") return { start: monthStartIso(day), end: day };
  if (preset === "fytd") return { start: fyStart.slice(0, 10) || null, end: day };
  if (preset === "last-fy") {
    const previous = previousFiscalYearWindow(fyStart);
    return { start: previous.start || null, end: previous.end || null };
  }
  if (preset === "custom") {
    const cutoff = previousFiscalYearWindow(fyStart).start;
    const start = customStart && cutoff && customStart < cutoff ? cutoff : customStart || null;
    return { start, end: customEnd || null };
  }
  if (preset === "all") {
    const previous = previousFiscalYearWindow(fyStart);
    return { start: previous.start || null, end: day };
  }
  return { start: previousFiscalYearWindow(fyStart).start || null, end: day };
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

export const PROGRAM_SEGMENTS = new Set([
  "Athletics Fundraising",
  "Athletics - Specific Sport",
  "Athletics Fundraising-HIST_DS",
]);

export const ATHLETICS_GENERAL_CODE = "6117AthGEN";
export const ATHLETICS_SPONSORSHIP_EVENT = "Athletics Sponsorship";

/** Ledo Pizza (125573) books its athletics sponsorship to 6117AthGEN,
 *  often on a golf-tournament segment. */
export const ATHLETICS_SPONSOR_CONTACT_IDS = new Set(["125573"]);

const NAMED_EVENT_RE = /tournament|booster|hall of fame/i;
const SPONSORSHIP_RE = /sponsorship/i;

export function isEventSegment(segment: string | null | undefined): boolean {
  const name = (segment || "").trim();
  if (!name || SPONSORSHIP_RE.test(name)) return false;
  return NAMED_EVENT_RE.test(name);
}

export function isKnownAthleticsSponsor(gift: Pick<AthleticsGivingGift, "contactId" | "contactName">): boolean {
  const id = gift.contactId == null ? "" : String(gift.contactId);
  if (id && ATHLETICS_SPONSOR_CONTACT_IDS.has(id)) return true;
  const name = (gift.contactName || "").toLowerCase();
  return name.includes("ledo pizza");
}

export function isAthleticsSponsorshipGift(gift: AthleticsGivingGift): boolean {
  if (gift.isFee) return false;
  if (SPONSORSHIP_RE.test(gift.segment || "") || SPONSORSHIP_RE.test(gift.segmentCode || "")) {
    return true;
  }
  if ((gift.projectCode || "") !== ATHLETICS_GENERAL_CODE) return false;
  if (isKnownAthleticsSponsor(gift)) return true;
  return !isEventSegment(gift.segment);
}

export function eventLabel(segment: string): string {
  return segment.replace(/-HIST_EV$/i, "").trim();
}

export function eventOptions(gifts: AthleticsGivingGift[]): string[] {
  const names = new Set<string>();
  let hasSponsorship = false;
  for (const gift of gifts) {
    if (isAthleticsSponsorshipGift(gift)) {
      hasSponsorship = true;
      continue;
    }
    if (isEventSegment(gift.segment) && gift.segment) names.add(gift.segment);
  }
  if (hasSponsorship) names.add(ATHLETICS_SPONSORSHIP_EVENT);
  return [...names].sort((a, b) => b.localeCompare(a));
}

export type GivingFilters = {
  start: string | null;
  end: string | null;
  sportKey: string;
  event: string;
  fund: string;
  search: string;
};

export function filterGifts(gifts: AthleticsGivingGift[], filters: GivingFilters): AthleticsGivingGift[] {
  const needle = filters.search.trim().toLowerCase();
  const event = filters.event || "all";
  return gifts.filter((gift) => {
    const day = gift.giftDate || "";
    if (filters.start && day < filters.start) return false;
    if (filters.end && day > filters.end) return false;
    if (filters.sportKey !== "all" && sportForGift(gift).key !== filters.sportKey) return false;
    if (event !== "all") {
      if (event === ATHLETICS_SPONSORSHIP_EVENT) {
        if (!isAthleticsSponsorshipGift(gift)) return false;
      } else if (isAthleticsSponsorshipGift(gift) || (gift.segment || "") !== event) {
        return false;
      }
    }
    if (filters.fund !== "all" && (gift.projectCode || gift.project || "") !== filters.fund) return false;
    if (!needle) return true;
    const sport = sportForGift(gift);
    return [gift.contactName, gift.project, gift.segment, gift.projectCode, sport.label]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export type FundYearCompare = {
  project: string | null;
  projectCode: string | null;
  thisYear: number;
  lastYear: number;
  thisYearGifts: number;
  lastYearGifts: number;
};

export function fundsThisYearVsLastYear(
  gifts: AthleticsGivingGift[],
  thisStart: string,
  thisEnd: string,
  lastStart: string,
  lastEnd: string,
): FundYearCompare[] {
  const buckets = new Map<
    string,
    FundYearCompare & { thisIds: Set<string>; lastIds: Set<string>; thisAnon: number; lastAnon: number }
  >();
  for (const gift of gifts) {
    if (gift.isFee) continue;
    const day = gift.giftDate || "";
    const inThis = Boolean(thisStart && thisEnd && day >= thisStart && day <= thisEnd);
    const inLast = Boolean(lastStart && lastEnd && day >= lastStart && day <= lastEnd);
    if (!inThis && !inLast) continue;
    const key = `${gift.projectCode || ""}|${gift.project || ""}`;
    const bucket = buckets.get(key) || {
      project: gift.project,
      projectCode: gift.projectCode,
      thisYear: 0,
      lastYear: 0,
      thisYearGifts: 0,
      lastYearGifts: 0,
      thisIds: new Set<string>(),
      lastIds: new Set<string>(),
      thisAnon: 0,
      lastAnon: 0,
    };
    const value = Number(gift.amountDesignated) || 0;
    const id = gift.giftId == null || gift.giftId === "" ? "" : String(gift.giftId);
    if (inThis) {
      bucket.thisYear += value;
      if (id) bucket.thisIds.add(id);
      else bucket.thisAnon += 1;
    }
    if (inLast) {
      bucket.lastYear += value;
      if (id) bucket.lastIds.add(id);
      else bucket.lastAnon += 1;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => ({
      project: bucket.project,
      projectCode: bucket.projectCode,
      thisYear: roundMoney(bucket.thisYear),
      lastYear: roundMoney(bucket.lastYear),
      thisYearGifts: bucket.thisIds.size + bucket.thisAnon,
      lastYearGifts: bucket.lastIds.size + bucket.lastAnon,
    }))
    .sort(
      (a, b) =>
        b.thisYear - a.thisYear || b.lastYear - a.lastYear || (a.project || "").localeCompare(b.project || ""),
    );
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
