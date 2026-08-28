import { isUgDegreeSeekingRow, type CensusRawStudent } from "./lists-core";
import { DEFAULT_FILTERS, buildReport, filterStudents, projectReportStudents } from "./report";
import { fteFromStatus, type CensusSnapshot, type CensusSummary, type CountFte } from "./types";

const NON_DS_DEGREE = new Set(["HSDE", "PENRIC", "NONDEG"]);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hcFte(rows: CensusRawStudent[]): CountFte {
  return {
    headcount: rows.length,
    fte: round1(rows.reduce((s, r) => s + fteFromStatus(String(r.fullPart || "")), 0)),
  };
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
    degreeSeeking: hcFte(ugds),
    dualEnrollment: hcFte(dual),
    nonDegree: hcFte(nonDegree),
    totalUndergraduate: hcFte(ug),
    gradMa: hcFte(byDeg("MARTS")),
    gradPhd: hcFte(byDeg("PHD")),
    gradMba: hcFte(byDeg("MBA")),
    gradMedcl: hcFte(grads.filter((s) => degree(s) === "MEDCL" && !isLuxMundi(s))),
    luxMundiGrad: hcFte(luxGrad),
    totalGraduate: hcFte(grads),
    totalEnrollment: hcFte(students),
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
  const catholic = ugds.filter((s) => /cathol/i.test(s.cathGroup || s.religion)).length;
  data.kpis.allStudents = summary.totalEnrollment.headcount;
  data.kpis.ugStudents = summary.degreeSeeking.headcount;
  data.kpis.states = stateLabels.size;
  data.kpis.pctCatholic = ugds.length ? catholic / ugds.length : null;
  if (tables.countries.length) data.kpis.foreignCountries = tables.countries.length;
  const onCampus = tables.residency.find((r) => r.label === "Resident");
  if (tables.n) data.kpis.ugOnCampusPct = (onCampus?.n ?? 0) / tables.n;
  for (const key of Object.keys(summary) as (keyof CensusSummary)[]) {
    patchYear0(data, key, summary[key]);
  }
  return data;
}

export const KPI_DEFS: Record<string, string> = {
  states:
    "Distinct home State values on Fall 2026 Registration Status for UG degree-seeking students. International is not a state.",
  allStudents:
    "Every person on Fall 2026 Registration Status (Registration Status-26.xlsx). One row per PCID. Undergraduate, graduate, dual enrollment, and non-degree — no program filter.",
  ugStudents:
    "Registration Status rows with Program = UNDERG and College Attend not DUAL, EACO, or ND (B.A. and B.S.). Default Census Report view. Ireland is included.",
  ireland:
    "UG degree-seeking on Fall 2026 session 03Ireland (Registration Status with Residency). Also counted in Returning and Total Degree-Seeking.",
  foreignCountries:
    "Distinct non-US citizenships among registered students. Registration Status does not include citizenship, so this stays Needs data until that field is on the file.",
  ugOnCampus:
    "UG degree-seeking with residency Resident, including Ireland (Ciara / Malachy) counted as residential for now.",
  incomingHsGpa: "Mean high school GPA for incoming UG. Needs a Slate / HS GPA file.",
  pctCatholic: "UG degree-seeking students whose religion is Catholic or Eastern Rite Catholic, from Registration Status Religion.",
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
    "UG degree-seeking on session 03Ireland or sport Ireland (Registration Status with Residency). Breakout only — also in Returning, Total Degree-Seeking, and all undergraduate counts.",
  "Total Degree-Seeking": "Program = UNDERG and College Attend not DUAL, EACO, or ND. Incoming + Returning.",
  "High School Dual Enrollment": "College Attend = DUAL or Degree = HSDE.",
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
