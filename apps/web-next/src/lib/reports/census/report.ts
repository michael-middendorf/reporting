import type { CensusRawStudent } from "./lists";
import { CLASS_ORDER, COUNTRY_NAMES } from "./present";
import type { LabeledCount } from "./types";

export type ReportStudent = {
  gender: string;
  athlete: string;
  sport: string;
  major: string;
  degree: string;
  program: string;
  collegeAttend: string;
  classLevel: string;
  fullPart: string;
  incomingReturning: string;
  state: string;
  religion: string;
  cathGroup: string;
  ethnicity: string;
  residency: string;
  honors: boolean;
  citizenship: string;
  visa: string;
};

export type ReportFilters = {
  gender: "all" | "Female" | "Male";
  athlete: "all" | "Athlete" | "Non-Athlete";
  excludedSports: string[];
  majors: string[];
  degree: "ug" | "all" | "BA" | "BS" | "grad" | "dual";
};

export const DEFAULT_FILTERS: ReportFilters = {
  gender: "all",
  athlete: "all",
  excludedSports: [],
  majors: [],
  degree: "ug",
};

export const DEGREE_OPTIONS: { id: ReportFilters["degree"]; label: string }[] = [
  { id: "ug", label: "UG degree-seeking" },
  { id: "BA", label: "B.A." },
  { id: "BS", label: "B.S." },
  { id: "grad", label: "Graduate" },
  { id: "dual", label: "Dual enrollment" },
  { id: "all", label: "All students" },
];

const NON_DS = new Set(["DUAL", "EACO", "ND"]);

export function projectReportStudents(rows: CensusRawStudent[]): ReportStudent[] {
  return rows.map((r) => ({
    gender: (r.gender || "").trim(),
    athlete: (r.athlete || "").trim() || (r.sport ? "Athlete" : "Non-Athlete"),
    sport: (r.sport || "").trim(),
    major: (r.curriculumName || r.curriculum || "").trim() || "Undeclared",
    degree: (r.degree || "").trim().toUpperCase(),
    program: (r.program || "").trim().toUpperCase(),
    collegeAttend: (r.collegeAttend || "").trim().toUpperCase(),
    classLevel: (r.classLevel || "").trim(),
    fullPart: (r.fullPart || "").trim().toUpperCase(),
    incomingReturning: (r.incomingReturning || "").trim(),
    state: (r.state || "").trim().toUpperCase(),
    religion: (r.religion || "").trim(),
    cathGroup: (r.cathGroup || "").trim() || (r.religion || "").trim(),
    ethnicity: (r.ethnicity || "").trim(),
    residency: (r.residency || "").trim(),
    honors: Boolean((r.honors || "").trim()) && (r.honors || "").trim() !== "-",
    citizenship: (r.citizenship || "").trim().toUpperCase(),
    visa: (r.visa || "").trim().toUpperCase(),
  }));
}

export function isUgDegreeSeeking(s: ReportStudent): boolean {
  return s.program === "UNDERG" && !NON_DS.has(s.collegeAttend);
}

export function matchesDegree(s: ReportStudent, degree: ReportFilters["degree"]): boolean {
  switch (degree) {
    case "all":
      return true;
    case "ug":
      return isUgDegreeSeeking(s);
    case "BA":
      return isUgDegreeSeeking(s) && s.degree === "BARTS";
    case "BS":
      return isUgDegreeSeeking(s) && s.degree === "BSCIEN";
    case "grad":
      return s.program === "GRAD";
    case "dual":
      return s.collegeAttend === "DUAL" || s.degree === "HSDE";
    default:
      return true;
  }
}

export function filterStudents(rows: ReportStudent[], f: ReportFilters): ReportStudent[] {
  const excluded = new Set(f.excludedSports.map((s) => s.toLowerCase()));
  const majors = new Set(f.majors);
  return rows.filter((s) => {
    if (!matchesDegree(s, f.degree)) return false;
    if (f.gender !== "all" && s.gender !== f.gender) return false;
    if (f.athlete !== "all" && s.athlete !== f.athlete) return false;
    if (excluded.size && s.sport && excluded.has(s.sport.toLowerCase())) return false;
    if (majors.size && !majors.has(s.major)) return false;
    return true;
  });
}

export function uniqueSorted(rows: ReportStudent[], pick: (s: ReportStudent) => string): string[] {
  return [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function counts(rows: ReportStudent[], pick: (s: ReportStudent) => string, blank = ""): LabeledCount[] {
  const map = new Map<string, number>();
  for (const s of rows) {
    const label = pick(s) || blank;
    if (!label) continue;
    map.set(label, (map.get(label) || 0) + 1);
  }
  const total = rows.length;
  return [...map.entries()]
    .map(([label, n]) => ({ label, n, pct: total ? n / total : 0 }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

function alphaStates(rows: LabeledCount[]): LabeledCount[] {
  return [...rows].sort((a, b) => {
    const aLast = a.label === "International" ? 1 : 0;
    const bLast = b.label === "International" ? 1 : 0;
    if (aLast !== bLast) return aLast - bLast;
    return a.label.localeCompare(b.label);
  });
}

function countryName(code: string): string {
  return COUNTRY_NAMES[code] || code;
}

function classRank(label: string): number {
  const i = CLASS_ORDER.indexOf(label);
  return i === -1 ? 99 : i;
}

function loadBucket(fullPart: string): "full" | "half" | "less" | "other" {
  if (fullPart === "FULL") return "full";
  if (fullPart === "HALF") return "half";
  if (fullPart === "LESS") return "less";
  return "other";
}

export type ReportTables = {
  n: number;
  universe: number;
  states: LabeledCount[];
  countries: LabeledCount[];
  gender: LabeledCount[];
  religion: LabeledCount[];
  athlete: LabeledCount[];
  incomingAthlete: LabeledCount[];
  classLevel: LabeledCount[];
  sports: LabeledCount[];
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

export function buildReport(rows: ReportStudent[]): ReportTables {
  const n = rows.length;
  const athletes = rows.filter((s) => s.athlete === "Athlete");
  const incoming = rows.filter((s) => s.incomingReturning === "Incoming");
  const florida = rows.filter((s) => s.state === "FL");
  const nonFlCath = rows.filter((s) => s.state !== "FL" && /cathol/i.test(s.cathGroup || s.religion));
  const honors = rows.filter((s) => s.honors);

  const states = alphaStates(
    counts(rows, (s) => {
      if (!s.state || s.citizenship) {
        if (s.citizenship && s.citizenship !== "US" && s.citizenship !== "USA") return "International";
      }
      return s.state || "International";
    }),
  );

  const countries = counts(rows, (s) => {
    if (!s.citizenship || s.citizenship === "US" || s.citizenship === "USA") return "";
    return countryName(s.citizenship);
  }).sort((a, b) => a.label.localeCompare(b.label));

  const classLevel = counts(rows, (s) => s.classLevel || "—")
    .map((r) => ({
      ...r,
      fullTime: rows.filter((s) => (s.classLevel || "—") === r.label && s.fullPart === "FULL").length,
    }))
    .sort((a, b) => classRank(a.label) - classRank(b.label));

  const sports = counts(athletes, (s) => s.sport)
    .filter((r) => r.label)
    .map((r) => ({
      ...r,
      pctOfAthletes: athletes.length ? r.n / athletes.length : 0,
      pctOfAll: n ? r.n / n : 0,
    }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

  const loadMap = new Map<string, { gender: string; incomingReturning: string; full: number; half: number; less: number; other: number; total: number }>();
  for (const s of rows) {
    const g = s.gender || "—";
    const ir = s.incomingReturning || "—";
    const key = `${g}|${ir}`;
    const row = loadMap.get(key) || { gender: g, incomingReturning: ir, full: 0, half: 0, less: 0, other: 0, total: 0 };
    row[loadBucket(s.fullPart)] += 1;
    row.total += 1;
    loadMap.set(key, row);
  }

  const majorMap = new Map<string, { label: string; freshman: number; sophomore: number; junior: number; senior: number; total: number }>();
  for (const s of rows) {
    const label = s.major || "Undeclared";
    const row = majorMap.get(label) || { label, freshman: 0, sophomore: 0, junior: 0, senior: 0, total: 0 };
    if (s.classLevel === "Freshman") row.freshman += 1;
    else if (s.classLevel === "Sophomore") row.sophomore += 1;
    else if (s.classLevel === "Junior") row.junior += 1;
    else if (s.classLevel === "Senior") row.senior += 1;
    row.total += 1;
    majorMap.set(label, row);
  }

  return {
    n,
    universe: n,
    states,
    countries,
    gender: counts(rows, (s) => s.gender || "—").sort((a, b) => a.label.localeCompare(b.label)),
    religion: counts(rows, (s) => s.cathGroup || s.religion || "Other"),
    athlete: counts(rows, (s) => s.athlete || "Non-Athlete"),
    incomingAthlete: counts(incoming, (s) => s.athlete || "Non-Athlete"),
    classLevel,
    sports,
    residency: counts(rows, (s) => s.residency || "Unassigned").sort((a, b) => a.label.localeCompare(b.label)),
    honorsByClass: counts(honors, (s) => s.classLevel || "—").sort((a, b) => classRank(a.label) - classRank(b.label)),
    honorsN: honors.length,
    athleticReligion: counts(athletes, (s) => s.cathGroup || s.religion || "Other"),
    floridaAthlete: counts(florida, (s) => s.athlete || "Non-Athlete"),
    floridaCatholic: counts(florida, (s) => (/cathol/i.test(s.cathGroup || s.religion) ? "Catholic" : "Non-Catholic")),
    nonFloridaCatholicAthlete: counts(nonFlCath, (s) => s.athlete || "Non-Athlete"),
    genderLoad: [...loadMap.values()].sort((a, b) => a.gender.localeCompare(b.gender) || a.incomingReturning.localeCompare(b.incomingReturning)),
    majors: [...majorMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export function filtersActive(f: ReportFilters): boolean {
  return (
    f.gender !== "all" ||
    f.athlete !== "all" ||
    f.excludedSports.length > 0 ||
    f.majors.length > 0 ||
    f.degree !== "ug"
  );
}
