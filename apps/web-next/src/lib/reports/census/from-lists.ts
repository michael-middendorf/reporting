import { isUgDegreeSeekingRow, type CensusRawStudent } from "./lists-core";
import { DEFAULT_FILTERS, buildReport, filterStudents, projectReportStudents } from "./report";
import { isCatholic } from "./retention";
import { fteFromStudent, type CensusSnapshot, type CensusSummary, type CountFte } from "./types";

const NON_DS_DEGREE = new Set(["HSDE", "PENRIC", "NONDEG"]);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hcFte(rows: CensusRawStudent[]): CountFte {
  return {
    headcount: rows.length,
    fte: round1(rows.reduce((s, r) => s + fteFromStudent(String(r.fullPart || ""), r.credits), 0)),
  };
}

export function uniqueStudentCount(rows: CensusRawStudent[]): number {
  return uniqueStudents(rows).length;
}

export function sumCredits(rows: { credits?: number | string | null }[]): number {
  return Math.round(rows.reduce((s, r) => s + (Number(r.credits) || 0), 0) * 10) / 10;
}

function uniqueStudents(rows: CensusRawStudent[]): CensusRawStudent[] {
  const seen = new Set<string>();
  const out: CensusRawStudent[] = [];
  for (const s of rows) {
    const id = (s.pcid || "").trim().toUpperCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}

function isIncoming(s: CensusRawStudent): boolean {
  return (s.incomingReturning || "").trim().toLowerCase().startsWith("incoming");
}

function college(s: CensusRawStudent): string {
  return (s.collegeAttend || "").trim().toUpperCase();
}

function program(s: CensusRawStudent): string {
  return (s.program || "").trim().toUpperCase();
}

function degree(s: CensusRawStudent): string {
  return (s.degree || "").trim().toUpperCase();
}

function isLuxMundi(s: CensusRawStudent): boolean {
  return (s.session || "").toLowerCase().includes("luxmundi");
}

function isDual(s: CensusRawStudent): boolean {
  return college(s) === "DUAL" || degree(s) === "HSDE";
}

function isGrad(s: CensusRawStudent): boolean {
  return program(s) === "GRAD";
}

function isUgDs(s: CensusRawStudent): boolean {
  return isUgDegreeSeekingRow(s.program, s.collegeAttend) && !NON_DS_DEGREE.has(degree(s));
}

export function isIrelandStudent(s: CensusRawStudent): boolean {
  return (s.session || "").toLowerCase().includes("ireland") || (s.sport || "").trim().toLowerCase() === "ireland";
}

export function isMallaryStudent(s: CensusRawStudent): boolean {
  const sess = (s.session || "").toLowerCase().replace(/\s+/g, "");
  return sess.includes("03mm") || sess.includes("mallary") || sess.includes("montmallary");
}

export function isChesterton(s: CensusRawStudent): boolean {
  const blob = `${s.session || ""} ${s.curriculum || ""} ${s.curriculumName || ""} ${s.collegeAttend || ""}`.toLowerCase();
  return blob.includes("chesterton");
}

function isOnCampus(s: CensusRawStudent): boolean {
  if (isIrelandStudent(s) || isMallaryStudent(s)) return false;
  const r = (s.residency || "").trim().toLowerCase();
  return r === "on campus" || r === "resident";
}

export function summaryFromStudents(students: CensusRawStudent[]): CensusSummary {
  const ugds = students.filter(isUgDs);
  const incoming = ugds.filter(isIncoming);
  const returning = ugds.filter((s) => !isIncoming(s));
  const dual = students.filter(isDual);
  const grads = students.filter(isGrad);
  const luxGrad = grads.filter(isLuxMundi);
  const nonDegree = students.filter((s) => !isUgDs(s) && !isDual(s) && !isGrad(s));
  const byCollege = (code: string) => incoming.filter((s) => college(s) === code);
  const byDeg = (code: string) => grads.filter((s) => degree(s) === code && !isLuxMundi(s));
  const ug = [...ugds, ...dual, ...nonDegree];
  return {
    newStudents: hcFte(incoming),
    ftca: hcFte(byCollege("FTCA")),
    tran: hcFte(byCollege("TRAN")),
    read: hcFte(byCollege("READ")),
    secb: hcFte(byCollege("SECB")),
    luxMundiUg: hcFte(ugds.filter(isLuxMundi)),
    returning: hcFte(returning),
    ireland: hcFte(ugds.filter(isIrelandStudent)),
    onCampus: hcFte(ugds.filter(isOnCampus)),
    montMallary: hcFte(ugds.filter(isMallaryStudent)),
    degreeSeeking: hcFte(ugds),
    dualEnrollment: hcFte(dual),
    chesterton: hcFte(students.filter((s) => isChesterton(s) && !isDual(s))),
    chestertonDual: hcFte(dual.filter(isChesterton)),
    nonDegree: hcFte(nonDegree),
    totalUndergraduate: hcFte(ug),
    gradMa: hcFte(byDeg("MARTS")),
    gradPhd: hcFte(byDeg("PHD")),
    gradMba: hcFte(byDeg("MBA")),
    gradMedcl: hcFte(grads.filter((s) => degree(s) === "MEDCL" && !isLuxMundi(s))),
    luxMundiGrad: hcFte(luxGrad),
    totalGraduate: hcFte(grads),
    totalEnrollment: {
      headcount: uniqueStudentCount(students),
      fte: hcFte(students).fte,
    },
  };
}

function patchYear0(data: CensusSnapshot, key: keyof CensusSummary, c: CountFte) {
  const series = data.historical[key];
  if (!series || typeof series !== "object" || Array.isArray(series)) return;
  if (series.hc && series.hc.length) series.hc[0] = c.headcount;
  if (series.fte && series.fte.length && c.fte != null) series.fte[0] = c.fte;
}

/** Rebuild Summary, KPIs, and the current Fall column from Registration Status rows. */
export function applyRegistrationTotals(data: CensusSnapshot, students: CensusRawStudent[]): CensusSnapshot {
  if (!students.length) return data;
  const summary = summaryFromStudents(students);
  data.summary = summary;
  const tables = buildReport(filterStudents(projectReportStudents(students), DEFAULT_FILTERS));
  data.ug = {
    ...data.ug,
    n: tables.n,
    states: tables.states,
    countries: tables.countries,
    gender: tables.gender,
    classLevel: tables.classLevel,
    sports: tables.sports,
    religion: tables.religion,
    athlete: tables.athlete,
    incomingAthlete: tables.incomingAthlete,
    residency: tables.residency,
    honorsByClass: tables.honorsByClass,
    honorsN: tables.honorsN,
    athleticReligion: tables.athleticReligion,
    floridaAthlete: tables.floridaAthlete,
    floridaCatholic: tables.floridaCatholic,
    nonFloridaCatholicAthlete: tables.nonFloridaCatholicAthlete,
    genderLoad: tables.genderLoad,
    majors: tables.majors,
  };
  const ugds = students.filter(isUgDs);
  const stateLabels = new Set(tables.states.map((r) => r.label).filter((l) => l && l !== "International"));
  const catholic = ugds.filter(isCatholic).length;
  data.kpis.allStudents = summary.totalEnrollment.headcount;
  data.kpis.ugStudents = summary.degreeSeeking.headcount;
  data.kpis.states = stateLabels.size;
  data.kpis.pctCatholic = ugds.length ? catholic / ugds.length : null;
  data.kpis.ugCredits = sumCredits(ugds);
  data.kpis.totalCredits = sumCredits(students);
  if (tables.countries.length) data.kpis.foreignCountries = tables.countries.length;
  const onCampus = tables.residency.find((r) => r.label === "On Campus" || r.label === "Resident");
  if (tables.n) data.kpis.ugOnCampusPct = (onCampus?.n ?? 0) / tables.n;
  for (const key of Object.keys(summary) as (keyof CensusSummary)[]) {
    patchYear0(data, key, summary[key]);
  }
  return data;
}

export const KPI_DEFS: Record<string, string> = {
  allStudents:
    "Every person on Fall 2026 Registration Status (Registration Status-26.xlsx). One row per PCID. Undergraduate, graduate, dual enrollment, and non-degree — no program filter.",
  ugStudents:
    "Registration Status rows with Program = UNDERG and College Attend not DUAL, EACO, or ND (B.A. and B.S.). Default Census Report view. Ireland is included.",
  ireland:
    "UG degree-seeking on Fall 2026 session 03Ireland (Registration Status with Residency). Also counted in Returning and Total Degree-Seeking.",
  ugCredits:
    "Sum of Credits on Fall 2026 Registration Status for UG degree-seeking students (the Census Report default).",
  totalCredits:
    "Sum of Credits on every Fall 2026 Registration Status row (undergraduate, graduate, dual enrollment, and non-degree). A student in UG and graduate is counted on both rows.",
  ugOnCampus:
    "UG degree-seeking in campus halls (On Campus). Ireland and Mont Mallary (session 03MM) are not On Campus.",
  incomingHsGpa: "Mean high school GPA for incoming UG. Needs a Slate / HS GPA file.",
  pctCatholic:
    "UG degree-seeking students whose Religion is Catholic or Eastern Rite Catholic. Non-Catholic is not Catholic. From Registration Status Religion.",
  testScores: "Mean CLT / ACT / SAT for incoming UG. Needs a Slate scores file.",
};

export const SUMMARY_DEFS: Record<string, string> = {
  "Undergraduate, New Students Admitted":
    "UG degree-seeking who were not on the Fall 2025 census (Incoming). Includes FTCA, TRAN, READ, SECB, and Incoming with blank College Attend.",
  FTCA: "Incoming UG degree-seeking with College Attend = FTCA (first-time in college).",
  TRAN: "Incoming UG degree-seeking with College Attend = TRAN (transfer).",
  READ: "Incoming UG degree-seeking with College Attend = READ (readmit).",
  SECB: "Incoming UG degree-seeking with College Attend = SECB (second bachelor's).",
  "Lux Mundi": "UG degree-seeking with Session 01LuxMundi. Breakout; also in Incoming / Returning.",
  "Returning Students":
    "UG degree-seeking who were already on the Fall 2025 census. Ireland students are included here.",
  Ireland:
    "UG degree-seeking on session 03Ireland or sport Ireland (Registration Status with Residency). Breakout only — also in Returning and Total Degree-Seeking. Not On Campus.",
  "On Campus": "UG degree-seeking in residence halls. Residential = On Campus. Ireland and Mont Mallary are separate.",
  "Mont Mallary": "UG degree-seeking on session 03MM (Mont Mallary campus). Separate from On Campus and Ireland. Not the -0.118 SQL figure.",
  "Total Degree-Seeking": "Program = UNDERG and College Attend not DUAL, EACO, or ND. Incoming + Returning.",
  "High School Dual Enrollment":
    "College Attend = DUAL or Degree = HSDE only. About 70 this fall. Early College (EACO) and Chesterton students who are not DUAL are not in this line. FTE is credits/12 when Full/Part is blank.",
  Chesterton: "Chesterton students who are not dual enrollment (not College Attend DUAL / Degree HSDE).",
  "Chesterton DE": "Chesterton students who are dual enrollment (DUAL / HSDE).",
  "Non-Degree-Seeking / Personal Enrichment":
    "Everyone who is not UG degree-seeking, not dual enrollment, and not Program = GRAD (ND / PENRIC / NONDEG / EACO).",
  "Lux Mundi Non-Degree-Seeking / Personal Enrichment": "Non-degree rows with Session 01LuxMundi.",
  "TOTAL UNDERGRADUATE ENROLLMENT": "UG degree-seeking + dual enrollment + non-degree.",
  "Graduate MA Students": "Program = GRAD, Degree = MARTS, excluding Lux Mundi session.",
  "Graduate PhD Students": "Program = GRAD, Degree = PHD.",
  "Graduate MBA Students": "Program = GRAD, Degree = MBA.",
  "Graduate MEdCl": "Program = GRAD, Degree = MEdCL.",
  "Graduate MA Theo (Online) - Lux Mundi": "Program = GRAD and Session 01LuxMundi. Counted in Total Graduate, not in MA above.",
  "TOTAL GRADUATE ENROLLMENT": "Program = GRAD (MA + PhD + MBA + MEdCl + Lux Mundi).",
  "Graduate & Undergraduate Enrollment":
    "All Registration Status rows for Fall 2026. Same number as the All students box.",
};
