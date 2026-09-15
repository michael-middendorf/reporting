import { sportByKey } from "./sports";

export const FORBIDDEN_PROJECT_CODES = new Set(["6117AthGEN", "6644"]);

export const FUNDRAISING_CACHE_KEY =
  process.env.ATHLETICS_COACHING_FUNDRAISING_CACHE_KEY ||
  "athletics-coaching-fundraising/latest.json";

export type FundraisingGift = {
  donorName: string;
  amount: number;
  giftDate: string;
  fytd: boolean;
};

export type FundraisingSportRow = {
  key: string;
  projectCode: string | null;
  mapped: boolean;
  fytdAmount: number | null;
  fytdGiftCount: number | null;
  allTimeAmount: number | null;
  allTimeGiftCount: number | null;
  asOf: string | null;
  reason?: "unmapped" | "unavailable";
  gifts?: FundraisingGift[];
};

export type FundraisingCache = {
  generated_at: string;
  source: "virtuous";
  fiscalYear: number;
  fiscalYearLabel: string;
  fyStart: string;
  fyEnd: string;
  sports: Record<string, FundraisingSportRow>;
};

export type SportFundraising = {
  sport: string;
  sportLabel: string;
  generatedAt: string;
  source: "virtuous";
  fiscalYear: number;
  fiscalYearLabel: string;
  fyStart: string;
  fyEnd: string;
  key: string;
  projectCode: string | null;
  mapped: boolean;
  fytdAmount: number | null;
  fytdGiftCount: number | null;
  allTimeAmount: number | null;
  allTimeGiftCount: number | null;
  asOf: string | null;
  reason?: "unmapped" | "unavailable";
  gifts: FundraisingGift[];
};

function emptyTotals(reason: "unmapped" | "unavailable"): Pick<
  FundraisingSportRow,
  | "mapped"
  | "fytdAmount"
  | "fytdGiftCount"
  | "allTimeAmount"
  | "allTimeGiftCount"
  | "asOf"
  | "reason"
  | "gifts"
> {
  return {
    mapped: reason === "unmapped" ? false : true,
    fytdAmount: null,
    fytdGiftCount: null,
    allTimeAmount: null,
    allTimeGiftCount: null,
    asOf: null,
    reason,
    gifts: [],
  };
}

function isForbiddenCode(code: string | null | undefined): boolean {
  return Boolean(code && FORBIDDEN_PROJECT_CODES.has(code));
}

export function sportFundraisingFromCache(cache: FundraisingCache, sport: string): SportFundraising {
  const sportLabel = sportByKey[sport]?.label || sport;
  const raw = cache.sports?.[sport];
  const base = {
    sport,
    sportLabel,
    generatedAt: cache.generated_at,
    source: "virtuous" as const,
    fiscalYear: cache.fiscalYear,
    fiscalYearLabel: cache.fiscalYearLabel,
    fyStart: cache.fyStart,
    fyEnd: cache.fyEnd,
    key: sport,
  };

  if (!raw || isForbiddenCode(raw.projectCode) || !raw.projectCode || raw.mapped === false) {
    return {
      ...base,
      projectCode: raw?.projectCode && !isForbiddenCode(raw.projectCode) ? raw.projectCode : null,
      ...emptyTotals("unmapped"),
    };
  }

  if (raw.reason === "unavailable") {
    return {
      ...base,
      projectCode: raw.projectCode,
      ...emptyTotals("unavailable"),
    };
  }

  return {
    ...base,
    projectCode: raw.projectCode,
    mapped: true,
    fytdAmount: raw.fytdAmount,
    fytdGiftCount: raw.fytdGiftCount,
    allTimeAmount: raw.allTimeAmount,
    allTimeGiftCount: raw.allTimeGiftCount,
    asOf: raw.asOf,
    gifts: Array.isArray(raw.gifts) ? raw.gifts : [],
  };
}
