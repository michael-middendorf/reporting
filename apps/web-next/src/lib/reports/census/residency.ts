import {
  EREZ_PRICE,
  META,
  isCommuterAbroad,
  isIreland,
  isRome,
  priceTypeOf,
} from "../housing/model";
import type { Resident } from "../housing/types";
import type { CensusHousing, LabeledCount } from "./types";

export const CENSUS_RESIDENCY_ORDER = [
  "Commuter",
  "Other",
  "Resident",
  "Study Abroad",
  "Unassigned",
] as const;

export type CensusResidencyBucket = (typeof CENSUS_RESIDENCY_ORDER)[number];

const CAMPUS_HALLS = new Set(
  Object.keys(META).filter((code) => META[code].sec === "w" || META[code].sec === "m"),
);

export type HousingAssignmentRow = {
  pcid: string;
  name: string;
  email: string;
  building: string;
  room: string;
  priceType: string;
  residency: CensusResidencyBucket;
  classStatus: string;
  studentType: string;
  includedInCensus: boolean;
};

export function isLikelyUgResident(r: {
  class_status?: string;
  college_attend?: string;
}): boolean {
  const cls = (r.class_status || "").trim().toLowerCase();
  if (cls.startsWith("grad") || cls === "ndeg" || cls.includes("non-degree") || cls.includes("non degree")) {
    return false;
  }
  const coll = (r.college_attend || "").trim().toUpperCase();
  if (coll === "DUAL" || coll === "EACO" || coll === "ND" || coll === "GRAD") return false;
  return true;
}

/** FA25 census buckets: Resident / Commuter / Study Abroad / Other. */
export function censusResidencyOf(r: { building?: string; price_type?: string }): Exclude<
  CensusResidencyBucket,
  "Unassigned"
> {
  const building = (r.building || "").trim();
  const price = priceTypeOf(r);
  if (isIreland(building) || isRome(r) || isCommuterAbroad(r) || price === EREZ_PRICE.IRELAND) {
    return "Study Abroad";
  }
  if (building === "Commuter" || price === EREZ_PRICE.COMMUTER) return "Commuter";
  if (CAMPUS_HALLS.has(building) || price === EREZ_PRICE.HALL) return "Resident";
  return "Other";
}

export function housingAssignmentRows(residents: Resident[]): HousingAssignmentRow[] {
  return residents.map((r) => ({
    pcid: r.pcid || "",
    name: r.name || [r.first, r.last].filter(Boolean).join(" "),
    email: r.email || "",
    building: r.building || "",
    room: r.room || "",
    priceType: r.price_type || "",
    residency: censusResidencyOf(r),
    classStatus: r.class_status || "",
    studentType: r.student_type || "",
    includedInCensus: isLikelyUgResident(r),
  }));
}

export function residencyFromErez(
  residents: Resident[],
  ugN: number,
): {
  rows: LabeledCount[];
  ugOnCampusPct: number | null;
  housing: CensusHousing;
} {
  const counts: Record<CensusResidencyBucket, number> = {
    Commuter: 0,
    Other: 0,
    Resident: 0,
    "Study Abroad": 0,
    Unassigned: 0,
  };
  let ugMatched = 0;
  for (const r of residents) {
    if (!isLikelyUgResident(r)) continue;
    counts[censusResidencyOf(r)] += 1;
    ugMatched += 1;
  }
  const unassigned = Math.max(0, ugN - ugMatched);
  counts.Unassigned = unassigned;
  const denom = ugN > 0 ? ugN : ugMatched;
  const rows: LabeledCount[] = CENSUS_RESIDENCY_ORDER.filter((label) => counts[label] > 0).map(
    (label) => ({
      label,
      n: counts[label],
      pct: denom ? counts[label] / denom : 0,
    }),
  );
  return {
    rows,
    ugOnCampusPct: denom ? counts.Resident / denom : null,
    housing: {
      source: "erez",
      generated: null,
      session: null,
      erezCount: residents.length,
      ugMatched,
      unassigned,
    },
  };
}
