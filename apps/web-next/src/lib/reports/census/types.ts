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
  athletes?: number;
  associated?: number;
};

export type CensusSummary = {
  newStudents: CountFte;
  ftca: CountFte;
  tran: CountFte;
  read: CountFte;
  secb: CountFte;
  newOther: CountFte;
  luxMundiUg: CountFte;
  returning: CountFte;
  ireland: CountFte;
  onCampus: CountFte;
  rome: CountFte;
  commuter: CountFte;
  montMallary: CountFte;
  degreeSeeking: CountFte;
  dualEnrollment: CountFte;
  chesterton: CountFte;
  chestertonDual: CountFte;
  nonDegree: CountFte;
  totalUndergraduate: CountFte;
  gradMaPhil: CountFte;
  gradMa: CountFte;
  gradPhd: CountFte;
  gradMba: CountFte;
  gradMedcl: CountFte;
  gradMaCrw: CountFte;
  luxMundiGrad: CountFte;
  luxMundiNonDegree: CountFte;
  totalGraduate: CountFte;
  totalEnrollment: CountFte;
};

/** Historical row list. Same dual / Mount Melleray Abbey lines as Summary; prior years may be blank. */
export const HISTORICAL_ROWS: {
  label: string;
  key?: keyof CensusSummary;
  indent?: boolean;
  total?: boolean;
  bold?: boolean;
}[] = [
  { label: "Degree-Seeking" },
  { label: "Undergraduate, New Students Admitted", key: "newStudents", bold: true },
  { label: "FTCA", key: "ftca", indent: true },
  { label: "TRAN", key: "tran", indent: true },
  { label: "READ", key: "read", indent: true },
  { label: "SECB", key: "secb", indent: true },
  { label: "Lux Mundi", key: "luxMundiUg", indent: true },
  { label: "Returning Students", key: "returning", bold: true },
  { label: "Residency" },
  { label: "On Campus", key: "onCampus", indent: true },
  { label: "Mount Melleray Abbey", key: "ireland", indent: true },
  { label: "Rome", key: "rome", indent: true },
  { label: "Commuter", key: "commuter", indent: true },
  { label: "Total Degree-Seeking", key: "degreeSeeking", total: true, bold: true },
  { label: "" },
  { label: "On-campus dual enrollment", key: "dualEnrollment", bold: true },
  { label: "Online dual enrollment", key: "chestertonDual" },
  { label: "Non-Degree-Seeking / Personal Enrichment", key: "nonDegree", bold: true },
  { label: "Lux Mundi Non-Degree-Seeking / Personal Enrichment", key: "luxMundiNonDegree" },
  { label: "" },
  { label: "TOTAL UNDERGRADUATE ENROLLMENT", key: "totalUndergraduate", total: true, bold: true },
  { label: "" },
  { label: "Graduate Phil", key: "gradMaPhil" },
  { label: "MA Theology on-campus", key: "gradMa" },
  { label: "Graduate PhD Students:", key: "gradPhd" },
  { label: "MA Theology online", key: "luxMundiGrad" },
  { label: "Graduate MBA Students:", key: "gradMba" },
  { label: "Graduate MEdCl", key: "gradMedcl" },
  { label: "Graduate MA Comm", key: "gradMaCrw" },
  { label: "TOTAL GRADUATE ENROLLMENT", key: "totalGraduate", total: true, bold: true },
  { label: "" },
  { label: "Graduate & Undergraduate Enrollment", key: "totalEnrollment", total: true, bold: true },
];

/** FA25 Historical prints Total Degree-Seeking as "1343 (1334 Full Time)". */
export function degreeSeekingHcLabel(hc: number | null | undefined, fullTime: number | null | undefined): string | number | "" {
  if (hc == null) return "";
  if (fullTime == null) return hc;
  return `${hc} (${fullTime} Full Time)`;
}

export type FtcaAttrition = {
  cohort: number;
  enrolledThisFall: number;
  notRetained: number;
  graduated: number;
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
  graduated?: number;
  retainedPct: number;
  shareOfNotRetained: number;
};

export type HistoricalSeries = {
  hc?: (number | null)[];
  fte?: (number | null)[];
  /** UG degree-seeking full-time headcount; Historical prints "N (X Full Time)". */
  fullTime?: (number | null)[];
};

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
    ugCredits?: number | null;
    totalCredits?: number | null;
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
    athleticTypes?: LabeledCount[];
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

/** When Full/Part is blank (typical for dual enrollment), FTE is credits / 12, capped at 1. */
export function fteFromStudent(fullPart: string | null | undefined, credits?: number | string | null): number {
  const fromStatus = fteFromStatus(fullPart);
  if (fromStatus) return fromStatus;
  const cr = Number(credits);
  if (Number.isFinite(cr) && cr > 0) return Math.min(cr / 12, 1);
  return 0;
}

export function isDegreeSeekingUg(row: {
  Program?: string | null;
  College_Attend?: string | null;
  Degree?: string | null;
}): boolean {
  const college = row.College_Attend || "";
  const degree = row.Degree || "";
  if (college === "DUAL" || college === "EACO" || college === "ND") return false;
  if (degree === "HSDE" || degree === "PENRIC" || degree === "NONDEG") return false;
  if (row.Program === "UNDERG") return true;
  return row.Program === "GRAD" && degree.startsWith("B") && degree !== "B";
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
