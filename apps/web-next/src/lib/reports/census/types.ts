export type CountFte = { headcount: number; fte?: number | null };

export type LabeledCount = {
  label: string;
  n: number;
  pct?: number;
  fullTime?: number;
  incoming?: number;
  male?: number;
  female?: number;
  pctOfAthletes?: number;
  pctOfAll?: number;
};

export type CensusSummary = {
  newStudents: CountFte;
  ftca: CountFte;
  tran: CountFte;
  read: CountFte;
  secb: CountFte;
  luxMundiUg: CountFte;
  returning: CountFte;
  ireland: CountFte;
  degreeSeeking: CountFte;
  dualEnrollment: CountFte;
  nonDegree: CountFte;
  totalUndergraduate: CountFte;
  gradMa: CountFte;
  gradPhd: CountFte;
  gradMba: CountFte;
  gradMedcl: CountFte;
  luxMundiGrad: CountFte;
  totalGraduate: CountFte;
  totalEnrollment: CountFte;
};

export type FtcaAttrition = {
  cohort: number;
  enrolledThisFall: number;
  notRetained: number;
  retentionRate: number;
  byState: AttritionRow[];
  byAthlete: AttritionRow[];
  bySport: AttritionRow[];
  byGpa: AttritionRow[];
  byEthnicity: AttritionRow[];
  byCatholicAthlete: AttritionRow[];
};

export type AttritionRow = {
  label: string;
  students: number;
  notRetained: number;
  retainedPct: number;
  shareOfNotRetained: number;
};

export type HistoricalSeries = { hc?: (number | null)[]; fte?: (number | null)[] };

export type CensusHousing = {
  source: "erez";
  generated: string | null;
  session: string | null;
  erezCount: number;
  ugMatched: number;
  unassigned: number;
};

export type CensusSnapshot = {
  term: string;
  generated: string;
  status: "draft" | "final";
  pending: string[];
  kpis: {
    states: number;
    allStudents: number;
    ugStudents: number;
    foreignCountries: number;
    ugOnCampusPct: number | null;
    incomingHsGpa: number | null;
    pctCatholic: number | null;
    avgClt: number | null;
    avgAct: number | null;
    avgSat: number | null;
  };
  summary: CensusSummary;
  historical: {
    years: number[];
    [k: string]: HistoricalSeries | number[] | undefined;
  };
  housing?: CensusHousing;
  ug: {
    n: number;
    states: LabeledCount[];
    countries: LabeledCount[];
    gender: LabeledCount[];
    classLevel: LabeledCount[];
    sports: LabeledCount[];
    religion: LabeledCount[];
    athlete: LabeledCount[];
    incomingAthlete: LabeledCount[];
    residency: LabeledCount[];
    honorsByClass: LabeledCount[];
    honorsN: number;
    athleticReligion: LabeledCount[];
    floridaAthlete: LabeledCount[];
    floridaCatholic: LabeledCount[];
    nonFloridaCatholicAthlete: LabeledCount[];
    genderLoad: {
      gender: string;
      incomingReturning: string;
      full: number;
      half: number;
      less: number;
      other: number;
      total: number;
    }[];
    majors: {
      label: string;
      freshman: number;
      sophomore: number;
      junior: number;
      senior: number;
      total: number;
    }[];
  };
  ftcaAttrition: FtcaAttrition;
  allUgRetention: {
    priorUg: number;
    graduates: number;
    pool: number;
    enrolledThisFall: number;
    notRetained: number;
    retentionRate: number;
  };
  historicalFtcaRetention: { label: string; rate: number }[];
  historicalAllUgRetention: { label: string; rate: number }[];
};

export function fteFromStatus(fullPart: string | null | undefined): number {
  switch ((fullPart || "").trim().toUpperCase()) {
    case "FULL":
      return 1;
    case "THRE":
      return 0.75;
    case "HALF":
      return 0.5;
    case "LESS":
      return 0.25;
    default:
      return 0;
  }
}

export function isDegreeSeekingUg(row: {
  Program?: string | null;
  College_Attend?: string | null;
  Degree?: string | null;
}): boolean {
  if (row.Program !== "UNDERG") return false;
  const college = row.College_Attend || "";
  const degree = row.Degree || "";
  if (college === "DUAL" || college === "EACO" || college === "ND") return false;
  if (degree === "HSDE" || degree === "PENRIC" || degree === "NONDEG") return false;
  return true;
}

export function historicalSeries(
  historical: CensusSnapshot["historical"],
  key: string,
): HistoricalSeries {
  const v = historical[key];
  if (v && typeof v === "object" && !Array.isArray(v)) return v as HistoricalSeries;
  return {};
}

export function fullTimeUg(data: CensusSnapshot): number {
  return data.ug.classLevel.reduce((s, r) => s + (r.fullTime ?? 0), 0);
}

export const HOUSING_PENDING =
  "Housing / residency (Ireland tagged Study Abroad only)";
