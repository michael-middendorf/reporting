/**
 * Spring 2027 hall demand projected from the Fall 2026 assignment pull.
 * This is not an eRez Spring 2027 session. The publisher still requests
 * 2026FALL01 and 2026FALL03Ireland only.
 *
 * Spring beds = halls now + Ireland + Rome
 *   − December undergraduate conferrals (capped by seniors in that pool)
 *   − fall-to-spring attrition on the undergraduates who remain.
 * May graduates stay through spring, so the live senior count is not subtracted.
 * Fall 2027 on this page is those spring beds after spring-to-fall attrition.
 * It is returners only: no incoming class, melt, or fill percent.
 */
import { RET, isCommuter, isIreland, isRome, secOf } from "./model";
import type { Resident } from "./types";

export type SexCounts = { w: number; m: number; o: number };

export type AttritionRate = { left: number; base: number };

/**
 * December 2025 undergraduate conferrals.
 * Women 14, men 20. Planning subtraction, not the live senior headcount.
 */
export const DECEMBER_UG_GRADS: SexCounts = { w: 14, m: 20, o: 0 };

/**
 * FA25 undergraduate degree-seeking students who were not undergraduate in
 * Spring 2026, after December conferrals were removed. Leave of absence
 * counts as not retained. Women 29/698, men 41/610, all 70/1,308.
 */
export const FA_TO_SP_ATTRITION = {
  w: { left: 29, base: 698 },
  m: { left: 41, base: 610 },
  all: { left: 70, base: 1308 },
} as const;

function oneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Complement of the S25→FA25 retention already on the Fall 2026 sheet. */
export const SP_TO_FA_ATTRITION = {
  w: oneDecimal(100 - RET.w),
  m: oneDecimal(100 - RET.m),
  all: oneDecimal(100 - RET.all),
} as const;

export type SpringProjection = {
  halls: SexCounts;
  ireland: SexCounts;
  rome: SexCounts;
  mbk: SexCounts;
  commuter: SexCounts;
  unassigned: SexCounts;
  /** Halls + Ireland + Rome. */
  pool: SexCounts;
  ugPool: SexCounts;
  nonUg: SexCounts;
  /** Undergraduate seniors inside the spring pool. Possible graduates. */
  seniors: SexCounts;
  /** Seniors in Middle Brook, commuter, or unassigned rows. */
  seniorsElsewhere: SexCounts;
  decemberPlanning: SexCounts;
  decemberSubtracted: SexCounts;
  ugRemaining: SexCounts;
  attritionLeaves: SexCounts;
  spring: SexCounts;
  fallLeavers: SexCounts;
  fallReturners: SexCounts;
};

export function sexTotal(counts: SexCounts): number {
  return counts.w + counts.m + counts.o;
}

export function ratePct(rate: AttritionRate): number {
  if (!rate.base) return 0;
  return oneDecimal((rate.left / rate.base) * 100);
}

export function isUgHousingClass(r: { class_status?: string }): boolean {
  const cls = (r.class_status || "").trim().toLowerCase();
  if (!cls) return true;
  if (cls.startsWith("grad")) return false;
  if (cls === "ndeg" || cls.includes("non-degree") || cls.includes("non degree")) return false;
  return true;
}

export function isPossibleGraduate(r: { class_status?: string }): boolean {
  return (r.class_status || "").trim().toLowerCase() === "senior";
}

function blank(): SexCounts {
  return { w: 0, m: 0, o: 0 };
}

function add(target: SexCounts, gender?: string) {
  const g = (gender || "").trim().toUpperCase();
  if (g === "F") target.w += 1;
  else if (g === "M") target.m += 1;
  else target.o += 1;
}

function plus(a: SexCounts, b: SexCounts): SexCounts {
  return { w: a.w + b.w, m: a.m + b.m, o: a.o + b.o };
}

function minus(a: SexCounts, b: SexCounts): SexCounts {
  return { w: a.w - b.w, m: a.m - b.m, o: a.o - b.o };
}

type BedBucket = "hall" | "ireland" | "rome" | "mbk" | "commuter" | "unassigned";

function bedBucket(r: Resident): BedBucket {
  if (isIreland(r.building)) return "ireland";
  if (isRome(r)) return "rome";
  if (r.building === "MBK") return "mbk";
  if (isCommuter(r)) return "commuter";
  if (secOf(r.building)) return "hall";
  return "unassigned";
}

function leaveCount(remaining: number, rate: AttritionRate): number {
  if (remaining <= 0 || rate.base <= 0) return 0;
  return Math.min(remaining, Math.round((remaining * rate.left) / rate.base));
}

function retain(n: number, attritionPct: number): number {
  if (n <= 0) return 0;
  return Math.max(0, Math.round((n * (100 - attritionPct)) / 100));
}

export function projectSpring(residents: readonly Resident[]): SpringProjection {
  const halls = blank();
  const ireland = blank();
  const rome = blank();
  const mbk = blank();
  const commuter = blank();
  const unassigned = blank();
  const ugPool = blank();
  const nonUg = blank();
  const seniors = blank();
  const seniorsElsewhere = blank();
  const boxes: Record<BedBucket, SexCounts> = { hall: halls, ireland, rome, mbk, commuter, unassigned };

  for (const r of residents) {
    const bucket = bedBucket(r);
    add(boxes[bucket], r.gender);
    const inPool = bucket === "hall" || bucket === "ireland" || bucket === "rome";
    if (isPossibleGraduate(r)) add(inPool ? seniors : seniorsElsewhere, r.gender);
    if (!inPool) continue;
    if (isUgHousingClass(r)) add(ugPool, r.gender);
    else add(nonUg, r.gender);
  }

  const pool = plus(plus(halls, ireland), rome);
  const decemberSubtracted: SexCounts = {
    w: Math.min(DECEMBER_UG_GRADS.w, seniors.w),
    m: Math.min(DECEMBER_UG_GRADS.m, seniors.m),
    o: 0,
  };
  const ugRemaining = minus(ugPool, decemberSubtracted);
  const attritionLeaves: SexCounts = {
    w: leaveCount(ugRemaining.w, FA_TO_SP_ATTRITION.w),
    m: leaveCount(ugRemaining.m, FA_TO_SP_ATTRITION.m),
    o: leaveCount(ugRemaining.o, FA_TO_SP_ATTRITION.all),
  };
  const spring = minus(minus(pool, decemberSubtracted), attritionLeaves);
  const fallReturners: SexCounts = {
    w: retain(spring.w, SP_TO_FA_ATTRITION.w),
    m: retain(spring.m, SP_TO_FA_ATTRITION.m),
    o: retain(spring.o, SP_TO_FA_ATTRITION.all),
  };

  return {
    halls,
    ireland,
    rome,
    mbk,
    commuter,
    unassigned,
    pool,
    ugPool,
    nonUg,
    seniors,
    seniorsElsewhere,
    decemberPlanning: { ...DECEMBER_UG_GRADS },
    decemberSubtracted,
    ugRemaining,
    attritionLeaves,
    spring,
    fallLeavers: minus(spring, fallReturners),
    fallReturners,
  };
}
