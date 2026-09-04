import {
  ATHLETIC_TYPE_ORDER,
  canonicalCensusSport,
  censusAppDecision,
  censusAthleticTypeCategory,
  censusStateLabel,
  isBachelorDegree,
  isTeamAthlete,
  isUgDegreeSeekingRow,
  type CensusRawStudent,
  type LoaWithStatus,
  type UnretainedStudent,
} from "./lists-core";
import { CENSUS_RESIDENCY_ORDER, displayCensusResidency } from "./residency";
import { CLASS_ORDER, COUNTRY_NAMES } from "./present";
import { isCatholic } from "./retention";
import type { CensusSnapshot, LabeledCount } from "./types";

export type ReportStudent = {
  pcid: string;
  gender: string;
  athlete: string;
  sport: string;
  major: string;
  declaredMajors?: string[];
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
  appDecision: string;
  athleticType: string;
  rosterStatus: string;
  institute: string;
};

export type ReportFilters = {
  gender: "all" | "Female" | "Male";
  athlete: "all" | "Athlete" | "Non-Athlete";
  includedSports: string[];
  excludedSports: string[];
  majors: string[];
  religions: string[];
  degree: "ug" | "all" | "BA" | "BS" | "grad" | "dual";
  /** Census Report universe. Unretained = FA25 census, not registered FA26, not 2025–26 graduates. */
  retention: "enrolled" | "unretained";
};

export const DEFAULT_FILTERS: ReportFilters = {
  gender: "all",
  athlete: "all",
  includedSports: [],
  excludedSports: [],
  majors: [],
  religions: [],
  degree: "ug",
  retention: "enrolled",
};

export const LIST_EXPORT_KINDS = ["filtered", "raw", "unretained", "sports", "ftca", "verify", "loa"] as const;
export type ListExportKind = (typeof LIST_EXPORT_KINDS)[number];

export function isListExportKind(v: unknown): v is ListExportKind {
  return typeof v === "string" && (LIST_EXPORT_KINDS as readonly string[]).includes(v);
}

/** Census Raw is the registration spine (UG, graduate, dual, non-degree). Other filters still apply. */
export function filtersForCensusRaw(f: ReportFilters): ReportFilters {
  return { ...f, degree: "all" };
}

export const DEGREE_OPTIONS: { id: ReportFilters["degree"]; label: string }[] = [
  { id: "ug", label: "UG degree-seeking" },
  { id: "BA", label: "B.A." },
  { id: "BS", label: "B.S." },
  { id: "grad", label: "Graduate" },
  { id: "dual", label: "Dual enrollment" },
  { id: "all", label: "All students" },
];

const CURRICULUM_LABELS: Record<string, string> = {
  CTHSTD: "Catholic Studies",
};

export function censusMajorLabel(name?: string, code?: string): string {
  const raw = (name || code || "").trim() || "Undeclared";
  return CURRICULUM_LABELS[raw.toUpperCase()] || CURRICULUM_LABELS[(code || "").trim().toUpperCase()] || raw;
}

export function projectReportStudents(rows: CensusRawStudent[]): ReportStudent[] {
  return rows.map((r) => ({
    pcid: (r.pcid || "").trim(),
    gender: (r.gender || "").trim(),
    athlete: canonicalCensusSport(r.sport) ? "Athlete" : "Non-Athlete",
    sport: canonicalCensusSport(r.sport),
    major: censusMajorLabel(r.curriculumName, r.curriculum),
    declaredMajors: (r.declaredMajors || []).map((m) => censusMajorLabel(m, m)),
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
    residency: displayCensusResidency(r.residency),
    honors: Boolean((r.honors || "").trim()) && (r.honors || "").trim() !== "-",
    citizenship: (r.citizenship || "").trim().toUpperCase(),
    visa: (r.visa || "").trim().toUpperCase(),
    appDecision: (r.appDecision || "").trim() || "Not listed",
    athleticType: (r.athleticType || "").trim(),
    rosterStatus: (r.rosterStatus || "").trim(),
    institute: (r.institute || "").trim(),
  }));
}

/** Map the unretained list onto Census Report tables (states, sports, gender, class, religion). */
export function projectUnretained(rows: UnretainedStudent[]): ReportStudent[] {
  return rows.map((s) => {
    const sport = canonicalCensusSport(s.sport && s.sport !== "-" ? s.sport : "");
    return {
      pcid: (s.pcid || "").trim(),
      gender: (s.gender || "").trim(),
      athlete: sport ? "Athlete" : "Non-Athlete",
      sport,
      major: "",
      degree: "",
      program: (s.program || "").trim().toUpperCase(),
      collegeAttend: (s.collegeAttend || "").trim().toUpperCase(),
      classLevel: (s.classLevel || "").trim(),
      fullPart: "",
      incomingReturning: (s.incomingReturning || "").trim(),
      state: (s.state || "").trim().toUpperCase(),
      religion: (s.religion || "").trim(),
      cathGroup: "",
      ethnicity: "",
      residency: "",
      honors: Boolean(s.honors) && s.honors !== "-",
      citizenship: "",
      visa: "",
      appDecision: "",
      athleticType: (s.athleticType || "").trim(),
      rosterStatus: (s.rosterStatus || "").trim(),
      institute: "",
    };
  });
}

export function isUgDegreeSeeking(s: ReportStudent): boolean {
  return isUgDegreeSeekingRow(s.program, s.collegeAttend, s.degree);
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
      return s.program === "GRAD" && !isBachelorDegree(s.degree);
    case "dual":
      return s.collegeAttend === "DUAL" || s.degree === "HSDE";
    default:
      return true;
  }
}

export function filterCensusRaw(rows: CensusRawStudent[], f: ReportFilters): CensusRawStudent[] {
  const keep = new Set(filterStudents(projectReportStudents(rows), f).map((s) => s.pcid.toUpperCase()));
  return rows.filter((s) => keep.has((s.pcid || "").toUpperCase()));
}

export function filterUnretained(rows: UnretainedStudent[], f: ReportFilters): UnretainedStudent[] {
  const keep = new Set(
    filterStudents(projectUnretained(rows), { ...f, majors: [] }).map((s) => s.pcid.toUpperCase()),
  );
  return rows.filter((s) => keep.has((s.pcid || "").toUpperCase()));
}

export function filterLoa(rows: LoaWithStatus[], f: ReportFilters): LoaWithStatus[] {
  const projected: ReportStudent[] = rows.map((s) => ({
    pcid: s.pcid,
    gender: s.gender,
    athlete: canonicalCensusSport(s.sport) ? "Athlete" : "Non-Athlete",
    sport: canonicalCensusSport(s.sport),
    major: s.curriculum,
    degree: "",
    program: "UNDERG",
    collegeAttend: s.collegeAttend,
    classLevel: s.classLevel,
    fullPart: "",
    incomingReturning: s.incomingReturning,
    state: s.state,
    religion: s.religion,
    cathGroup: "",
    ethnicity: s.ethnicity,
    residency: s.residency,
    honors: Boolean(s.honors) && s.honors !== "-",
    citizenship: "",
    visa: "",
    appDecision: "",
    athleticType: "",
    rosterStatus: "",
    institute: (s.institute || "").trim(),
  }));
  const keep = new Set(filterStudents(projected, { ...f, majors: [] }).map((s) => s.pcid.toUpperCase()));
  return rows.filter((s) => {
    if (!keep.has((s.pcid || "").toUpperCase())) return false;
    if (f.retention === "unretained") return s.status !== "Returned";
    if (f.retention === "enrolled") return true;
    return true;
  });
}

export function filterStudents(rows: ReportStudent[], f: ReportFilters): ReportStudent[] {
  const included = new Set(f.includedSports.map((s) => s.toLowerCase()));
  const excluded = new Set(f.excludedSports.map((s) => s.toLowerCase()));
  const majors = new Set(f.majors);
  const religions = new Set(f.religions);
  return rows.filter((s) => {
    if (!matchesDegree(s, f.degree)) return false;
    if (f.gender !== "all" && s.gender !== f.gender) return false;
    if (f.athlete !== "all" && s.athlete !== f.athlete) return false;
    const sport = (s.sport || "").toLowerCase();
    if (included.size && (!sport || !included.has(sport))) return false;
    if (excluded.size && sport && excluded.has(sport)) return false;
    const studentMajors = [s.major, ...(s.declaredMajors || [])];
    if (majors.size && !studentMajors.some((m) => majors.has(m))) return false;
    if (religions.size && !religions.has(s.religion)) return false;
    return true;
  });
}

export function uniqueSorted(rows: ReportStudent[], pick: (s: ReportStudent) => string): string[] {
  return [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

const RELIGION_ORDER = ["Catholic", "Christian", "Eastern Rite Catholic", "Other"];

function religionLabel(s: ReportStudent): string {
  const raw = (s.religion || "").trim();
  const u = raw.toUpperCase().replace(/\s+/g, " ");
  if (!raw || raw === "-" || u === "NONE") return "Other";
  if (u === "CATH" || u === "CATHOLIC") return "Catholic";
  if (u === "CHRI" || u === "CHRISTIAN") return "Christian";
  if (u === "ECAT" || u === "EASTERN RITE CATHOLIC") return "Eastern Rite Catholic";
  if (u === "OTH" || u === "OTHER") return "Other";
  if (/non[- ]?catholic/i.test(raw)) return "Other";
  return raw;
}

/** FA25 Census Report order. Always include Catholic, Christian, Eastern Rite, Other. */
function religionBreakdown(rows: ReportStudent[]): LabeledCount[] {
  const n = rows.length;
  const map = new Map<string, number>();
  for (const s of rows) {
    const label = religionLabel(s);
    map.set(label, (map.get(label) || 0) + 1);
  }
  const known = RELIGION_ORDER.map((label) => {
    const c = map.get(label) || 0;
    return { label, n: c, pct: n ? c / n : 0 };
  });
  const extras = [...map.entries()]
    .filter(([label]) => !RELIGION_ORDER.includes(label))
    .map(([label, c]) => ({ label, n: c, pct: n ? c / n : 0 }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  return [...known, ...extras].filter((r) => r.n > 0);
}

const APP_DECISION_ORDER = ["ACCT", "ADM", "COMM", "COND", "Not listed"];

function appDecisionLabel(s: ReportStudent): string {
  return censusAppDecision(s.appDecision);
}

function counts(rows: ReportStudent[], pick: (s: ReportStudent) => string, blank = ""): LabeledCount[] {
  const map = new Map<string, number>();
  for (const s of rows) {
    const label = pick(s) || blank;
    if (!label) continue;
    map.set(label, (map.get(label) || 0) + 1);
  }
  const total = [...map.values()].reduce((s, n) => s + n, 0);
  return [...map.entries()]
    .map(([label, n]) => ({ label, n, pct: total ? n / total : 0 }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/** Always emit both rows so Non-Catholic cannot disappear into a 100% Catholic table. */
function catholicSplit(rows: ReportStudent[]): LabeledCount[] {
  const n = rows.length;
  const catholic = rows.filter(isCatholic).length;
  const other = n - catholic;
  return [
    { label: "Catholic", n: catholic, pct: n ? catholic / n : 0 },
    { label: "Non-Catholic", n: other, pct: n ? other / n : 0 },
  ];
}

function namedOrder(rows: LabeledCount[], order: string[]): LabeledCount[] {
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.label);
    const bi = order.indexOf(b.label);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
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
  const t = (code || "").trim().toUpperCase();
  return COUNTRY_NAMES[t] || COUNTRY_NAMES[code] || code;
}

/** Non-US citizenship. If Visa is present it must be F1 (gold: countries of F1 visa holders). */
function isF1International(s: ReportStudent): boolean {
  const cit = (s.citizenship || "").trim().toUpperCase();
  if (!cit || cit === "US" || cit === "USA") return false;
  const visa = (s.visa || "").trim().toUpperCase().replace("-", "");
  if (visa && visa !== "F1") return false;
  return true;
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
  athleticTypes: LabeledCount[];
  classLevel: LabeledCount[];
  sports: LabeledCount[];
  residency: LabeledCount[];
  appDecisions: LabeledCount[];
  honorsByClass: LabeledCount[];
  honorsN: number;
  instituteByClass: LabeledCount[];
  instituteN: number;
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
  const nonFlCath = rows.filter((s) => s.state !== "FL" && isCatholic(s));
  const honors = rows.filter((s) => s.honors);
  const institute = rows.filter((s) => s.institute && s.institute !== "-");

  const states = alphaStates(
    counts(rows, (s) => {
      if (isF1International(s)) return "International";
      return censusStateLabel(s.state);
    }),
  );

  const countries = counts(rows, (s) => {
    if (!isF1International(s)) return "";
    return countryName(s.citizenship);
  }).sort((a, b) => a.label.localeCompare(b.label));

  const classLevel = counts(rows, (s) => s.classLevel || "—")
    .map((r) => ({
      ...r,
      fullTime: rows.filter((s) => (s.classLevel || "—") === r.label && s.fullPart === "FULL").length,
      incoming: rows.filter((s) => (s.classLevel || "—") === r.label && s.incomingReturning === "Incoming").length,
      pct: n ? r.n / n : 0,
    }))
    .sort((a, b) => classRank(a.label) - classRank(b.label));

  const sports = counts(athletes, (s) => canonicalCensusSport(s.sport))
    .filter((r) => r.label)
    .map((r) => {
      const subset = athletes.filter((s) => s.sport === r.label);
      const team = subset.filter(isTeamAthlete).length;
      return {
        ...r,
        n: subset.length,
        athletes: team,
        associated: subset.length,
        pctOfAthletes: athletes.length ? subset.length / athletes.length : 0,
        pctOfAll: n ? subset.length / n : 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const residency: LabeledCount[] = CENSUS_RESIDENCY_ORDER
    .map((label) => {
      const subset = rows.filter((s) => (displayCensusResidency(s.residency) || "Unassigned") === label);
      return {
        label,
        n: subset.length,
        pct: n ? subset.length / n : 0,
        male: subset.filter((s) => s.gender === "Male").length,
        female: subset.filter((s) => s.gender === "Female").length,
      };
    })
    .filter((r) => r.n > 0);

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
    const labels = s.declaredMajors?.length ? s.declaredMajors : [s.major || "Undeclared"];
    for (const raw of labels) {
      const label = censusMajorLabel(raw, raw) || "Undeclared";
      const row = majorMap.get(label) || { label, freshman: 0, sophomore: 0, junior: 0, senior: 0, total: 0 };
      if (s.classLevel === "Freshman") row.freshman += 1;
      else if (s.classLevel === "Sophomore") row.sophomore += 1;
      else if (s.classLevel === "Junior") row.junior += 1;
      else if (s.classLevel === "Senior") row.senior += 1;
      row.total += 1;
      majorMap.set(label, row);
    }
  }

  return {
    n,
    universe: n,
    states,
    countries,
    gender: namedOrder(counts(rows, (s) => s.gender || "—"), ["Female", "Male"]),
    religion: religionBreakdown(rows),
    athlete: namedOrder(counts(rows, (s) => s.athlete || "Non-Athlete"), ["Athlete", "Non-Athlete"]),
    incomingAthlete: namedOrder(counts(incoming, (s) => s.athlete || "Non-Athlete"), ["Athlete", "Non-Athlete"]),
    athleticTypes: namedOrder(counts(rows, (s) => censusAthleticTypeCategory(s), "None"), ATHLETIC_TYPE_ORDER),
    classLevel,
    sports,
    residency,
    appDecisions: namedOrder(counts(rows, appDecisionLabel, "Not listed"), APP_DECISION_ORDER),
    honorsByClass: counts(honors, (s) => s.classLevel || "—").sort((a, b) => classRank(a.label) - classRank(b.label)),
    honorsN: honors.length,
    instituteByClass: counts(institute, (s) => s.classLevel || "—").sort((a, b) => classRank(a.label) - classRank(b.label)),
    instituteN: institute.length,
    athleticReligion: religionBreakdown(athletes),
    floridaAthlete: namedOrder(counts(florida, (s) => s.athlete || "Non-Athlete"), ["Athlete", "Non-Athlete"]),
    floridaCatholic: catholicSplit(florida),
    nonFloridaCatholicAthlete: namedOrder(
      counts(nonFlCath, (s) => s.athlete || "Non-Athlete"),
      ["Athlete", "Non-Athlete"],
    ),
    genderLoad: [...loadMap.values()].sort((a, b) => a.gender.localeCompare(b.gender) || a.incomingReturning.localeCompare(b.incomingReturning)),
    majors: [...majorMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export function filtersActive(f: ReportFilters): boolean {
  return (
    f.gender !== "all" ||
    f.athlete !== "all" ||
    f.includedSports.length > 0 ||
    f.excludedSports.length > 0 ||
    f.majors.length > 0 ||
    f.religions.length > 0 ||
    f.degree !== "ug" ||
    f.retention !== "enrolled"
  );
}

export function describeFilters(f: ReportFilters): string {
  const parts: string[] = [];
  parts.push(f.retention === "unretained" ? "Unretained (FA25 not back)" : "Enrolled Fall 2026");
  const degree = DEGREE_OPTIONS.find((o) => o.id === f.degree);
  if (degree) parts.push(degree.label);
  if (f.gender !== "all") parts.push(f.gender);
  if (f.athlete !== "all") parts.push(f.athlete);
  if (f.includedSports.length) parts.push(`Sports: ${f.includedSports.join(", ")}`);
  if (f.excludedSports.length) parts.push(`Hide: ${f.excludedSports.join(", ")}`);
  if (f.religions.length) parts.push(`Religion: ${f.religions.join(", ")}`);
  if (f.majors.length) parts.push(`Majors: ${f.majors.join(", ")}`);
  return parts.join(" · ");
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

/** Accept a POST body from the census Export menu. Unknown fields fall back to defaults. */
export function parseReportFilters(raw: unknown): ReportFilters {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const gender = o.gender === "Female" || o.gender === "Male" ? o.gender : "all";
  const athlete = o.athlete === "Athlete" || o.athlete === "Non-Athlete" ? o.athlete : "all";
  const degreeIds = new Set(DEGREE_OPTIONS.map((d) => d.id));
  const degree = typeof o.degree === "string" && degreeIds.has(o.degree as ReportFilters["degree"])
    ? (o.degree as ReportFilters["degree"])
    : "ug";
  const retention = o.retention === "unretained" ? "unretained" : "enrolled";
  return {
    gender,
    athlete,
    includedSports: asStringArray(o.includedSports),
    excludedSports: asStringArray(o.excludedSports),
    majors: asStringArray(o.majors),
    religions: asStringArray(o.religions),
    degree,
    retention,
  };
}

/** Snapshot tables in the same shape the Census Report page uses. */
export function tablesFromSnapshot(data: CensusSnapshot): ReportTables {
  return {
    n: data.ug.n,
    universe: data.ug.n,
    states: data.ug.states,
    countries: data.ug.countries,
    gender: data.ug.gender,
    religion: data.ug.religion,
    athlete: data.ug.athlete,
    incomingAthlete: data.ug.incomingAthlete,
    athleticTypes: data.ug.athleticTypes ?? [],
    classLevel: data.ug.classLevel,
    sports: data.ug.sports,
    residency: data.ug.residency,
    appDecisions: [],
    honorsByClass: data.ug.honorsByClass,
    honorsN: data.ug.honorsN,
    instituteByClass: [],
    instituteN: 0,
    athleticReligion: data.ug.athleticReligion,
    floridaAthlete: data.ug.floridaAthlete,
    floridaCatholic: data.ug.floridaCatholic,
    nonFloridaCatholicAthlete: data.ug.nonFloridaCatholicAthlete,
    genderLoad: data.ug.genderLoad,
    majors: data.ug.majors,
  };
}


