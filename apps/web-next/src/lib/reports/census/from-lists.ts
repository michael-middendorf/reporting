import {
  canonicalCensusSport,
  isBachelorDegree,
  isUgDegreeSeekingRow,
  normPcid,
  type CensusRawStudent,
} from "./lists-core";
import { DEFAULT_FILTERS, buildReport, filterStudents, projectReportStudents } from "./report";
import { isCatholic } from "./retention";
import { fteFromStudent, fullTimeUg, historicalSeries, type CensusSnapshot, type CensusSummary, type CountFte } from "./types";

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

/** Mean of numeric values. 0 / blank are missing. SAT uses floor 400. Null if fewer than `min` scores. */
export function meanPositive(
  rows: { [k: string]: unknown }[],
  pick: (s: { [k: string]: unknown }) => unknown,
  digits = 1,
  min = 5,
  floor = 0,
): number | null {
  const xs: number[] = [];
  for (const row of rows) {
    const n = Number(pick(row));
    if (!Number.isFinite(n)) continue;
    if (floor > 0 ? n < floor : n <= 0) continue;
    xs.push(n);
  }
  if (xs.length < min) return null;
  const f = 10 ** digits;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * f) / f;
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
  if (isChesterton(s)) return false;
  return college(s) === "DUAL" || degree(s) === "HSDE";
}

function isGrad(s: CensusRawStudent): boolean {
  return program(s) === "GRAD" && !isBachelorDegree(degree(s));
}

function curriculumCode(s: CensusRawStudent): string {
  return (s.curriculum || "").trim().toUpperCase();
}

function isMaPhil(s: CensusRawStudent): boolean {
  return curriculumCode(s) === "MAPHIL" || /philosoph/i.test(s.curriculumName || "");
}

function isMaCrw(s: CensusRawStudent): boolean {
  const blob = `${s.curriculum || ""} ${s.curriculumName || ""}`;
  return curriculumCode(s) === "MACOMM" || /creative\s*writ|\bcrw\b/i.test(blob);
}

function isUgDs(s: CensusRawStudent): boolean {
  return isUgDegreeSeekingRow(s.program, s.collegeAttend, degree(s)) && !NON_DS_DEGREE.has(degree(s));
}

export function isIrelandStudent(s: CensusRawStudent): boolean {
  const sess = (s.session || "").toLowerCase();
  const res = (s.residency || "").trim();
  return sess.includes("ireland") || res === "Ireland" || res === "Mount Melleray Abbey";
}

export function isMallaryStudent(s: CensusRawStudent): boolean {
  const sess = (s.session || "").toLowerCase().replace(/\s+/g, "");
  return sess.includes("03mm") || sess.includes("mallary") || sess.includes("montmallary");
}

export function isEarlyCollege(s: CensusRawStudent): boolean {
  const coll = college(s);
  const prog = program(s);
  return coll === "EACO" || prog === "EACO" || prog === "EACOL";
}

export function isChesterton(s: CensusRawStudent): boolean {
  if (isEarlyCollege(s)) return true;
  return (s.deType || "").trim().toLowerCase().includes("chesterton");
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
  const chestertonRows = students.filter(isChesterton);
  const nonDegree = students.filter((s) => !isUgDs(s) && !isDual(s) && !isGrad(s) && !isChesterton(s));
  const byCollege = (code: string) => incoming.filter((s) => college(s) === code);
  const byDeg = (code: string) => grads.filter((s) => degree(s) === code && !isLuxMundi(s));
  const campusMa = byDeg("MARTS");
  const maPhil = campusMa.filter(isMaPhil);
  const maCrw = campusMa.filter(isMaCrw);
  const maTheo = campusMa.filter((s) => !isMaPhil(s) && !isMaCrw(s));
  const ug = [...ugds, ...dual, ...nonDegree, ...chestertonRows];
  return {
    newStudents: hcFte(incoming),
    ftca: hcFte(byCollege("FTCA")),
    tran: hcFte(byCollege("TRAN")),
    read: hcFte(byCollege("READ")),
    secb: hcFte(byCollege("SECB")),
    newOther: hcFte(incoming.filter((s) => !["FTCA", "TRAN", "READ", "SECB"].includes(college(s)))),
    luxMundiUg: hcFte(ugds.filter(isLuxMundi)),
    returning: hcFte(returning),
    ireland: hcFte(ugds.filter(isIrelandStudent)),
    onCampus: hcFte(ugds.filter(isOnCampus)),
    montMallary: hcFte(ugds.filter(isMallaryStudent)),
    degreeSeeking: hcFte(ugds),
    dualEnrollment: hcFte(dual),
    chesterton: hcFte(chestertonRows),
    chestertonDual: hcFte(chestertonRows),
    nonDegree: hcFte(nonDegree),
    luxMundiNonDegree: hcFte(nonDegree.filter(isLuxMundi)),
    totalUndergraduate: hcFte(ug),
    gradMaPhil: hcFte(maPhil),
    gradMa: hcFte(maTheo),
    gradPhd: hcFte(byDeg("PHD")),
    gradMba: hcFte(byDeg("MBA")),
    gradMedcl: hcFte(grads.filter((s) => degree(s) === "MEDCL" && !isLuxMundi(s))),
    gradMaCrw: hcFte(maCrw),
    luxMundiGrad: hcFte(luxGrad),
    totalGraduate: hcFte(grads),
    totalEnrollment: {
      headcount: uniqueStudentCount(students),
      fte: hcFte(students).fte,
    },
  };
}

export const GRAD_PROGRAM_ORDER = [
  "MA Philosophy",
  "MA Theology on-campus",
  "PhD Theology",
  "MBA",
  "M. Education",
  "MA CRW",
  "MA Theology online",
  "Other",
] as const;

export function graduateProgramLabel(s: CensusRawStudent): string | null {
  if (program(s) !== "GRAD" || isBachelorDegree(degree(s))) return null;
  if (isLuxMundi(s)) return "MA Theology online";
  const d = degree(s);
  if (isMaPhil(s)) return "MA Philosophy";
  if (isMaCrw(s)) return "MA CRW";
  if (d === "PHD") return "PhD Theology";
  if (d === "MBA") return "MBA";
  if (d === "MEDCL" || /educ/i.test(`${s.curriculum || ""} ${s.curriculumName || ""}`)) return "M. Education";
  if (d === "MARTS") return "MA Theology on-campus";
  return "Other";
}

export type GraduateProgramStats = {
  program: string;
  n: number;
  incoming: number;
  returning: number;
  athlete: number;
  nonAthlete: number;
  alumniAdmits: number;
  externalAdmits: number;
  amuAlumni: number;
  catholic: number;
  nonCatholic: number;
};

function isGraduateAthlete(s: CensusRawStudent): boolean {
  if ((s.athlete || "").trim() === "Athlete") return true;
  return Boolean(canonicalCensusSport(s.sport || ""));
}

function programStats(program: string, rows: CensusRawStudent[], alumniIds: Set<string>): GraduateProgramStats {
  const n = rows.length;
  const incoming = rows.filter(isIncoming);
  const athlete = rows.filter(isGraduateAthlete).length;
  const catholic = rows.filter(isCatholic).length;
  const amuAlumni = rows.filter((s) => alumniIds.has(normPcid(s.pcid))).length;
  const alumniAdmits = incoming.filter((s) => alumniIds.has(normPcid(s.pcid))).length;
  return {
    program,
    n,
    incoming: incoming.length,
    returning: n - incoming.length,
    athlete,
    nonAthlete: n - athlete,
    alumniAdmits,
    externalAdmits: incoming.length - alumniAdmits,
    amuAlumni,
    catholic,
    nonCatholic: n - catholic,
  };
}

function isAmuUndergraduateAlum(g: { program?: string; degree?: string }): boolean {
  const prog = (g.program || "").trim().toUpperCase();
  if (prog === "UNDERG") return true;
  const deg = (g.degree || "").trim().toUpperCase();
  return deg.startsWith("B");
}

/** PCIDs with an AMU bachelor's on Graduated All, or UG on last fall's census. */
export function amuUndergraduateAlumniIds(
  prior: CensusRawStudent[] = [],
  graduates: { pcid: string; program?: string; degree?: string }[] = [],
): Set<string> {
  return new Set([
    ...prior.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend, s.degree)).map((s) => normPcid(s.pcid)),
    ...graduates.filter(isAmuUndergraduateAlum).map((g) => normPcid(g.pcid)),
  ]);
}

/** Overall graduate enrollment plus each Summary program. Alumni = AMU bachelor's on Graduated All, or UG on last census. */
export function buildGraduateEnrollment(
  students: CensusRawStudent[],
  prior: CensusRawStudent[] = [],
  graduates: { pcid: string; program?: string; degree?: string }[] = [],
): GraduateProgramStats[] {
  const grads = students.filter(isGrad);
  const alumniIds = amuUndergraduateAlumniIds(prior, graduates);
  const byProgram = new Map<string, CensusRawStudent[]>();
  for (const s of grads) {
    const label = graduateProgramLabel(s) || "Other";
    const list = byProgram.get(label) || [];
    list.push(s);
    byProgram.set(label, list);
  }
  const blocks: GraduateProgramStats[] = [programStats("Overall", grads, alumniIds)];
  for (const label of GRAD_PROGRAM_ORDER) {
    const rows = byProgram.get(label);
    if (!rows?.length) continue;
    blocks.push(programStats(label, rows, alumniIds));
  }
  return blocks;
}

const SUMMER_DEGREE_ORDER = ["B.A.", "B.S.", ...GRAD_PROGRAM_ORDER];

/** Every Summer 2026 degree on Graduated All — UG bachelor's and graduate programs. */
export function summerGraduateDegreeLabel(g: { program?: string; degree?: string }): string | null {
  const prog = (g.program || "").trim().toUpperCase();
  const d = (g.degree || "").trim().toUpperCase();
  if (prog === "UNDERG") {
    if (d === "BSCIEN") return "B.S.";
    if (d === "BARTS") return "B.A.";
    return d || "Undergraduate";
  }
  if (prog !== "GRAD") return d || prog || null;
  if (d === "PHD") return "PhD Theology";
  if (d === "MBA") return "MBA";
  if (d === "MEDCL") return "M. Education";
  if (d === "MARTS") return "MA Theology on-campus";
  if (d === "MAPHIL") return "MA Philosophy";
  return d || "Other";
}

export function summerGraduateCounts(
  graduates: { year?: string | number; term?: string; program?: string; degree?: string }[],
): { program: string; n: number }[] {
  const map = new Map<string, number>();
  for (const g of graduates) {
    if (String(g.year ?? "").trim() !== "2026") continue;
    if (String(g.term ?? "").trim().toUpperCase() !== "SUMMER") continue;
    const label = summerGraduateDegreeLabel(g);
    if (!label) continue;
    map.set(label, (map.get(label) || 0) + 1);
  }
  const rows: { program: string; n: number }[] = [];
  const seen = new Set<string>();
  for (const label of SUMMER_DEGREE_ORDER) {
    const n = map.get(label);
    if (n) {
      rows.push({ program: label, n });
      seen.add(label);
    }
  }
  for (const [label, n] of map) {
    if (!seen.has(label)) rows.push({ program: label, n });
  }
  return rows;
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
    athleticTypes: tables.athleticTypes,
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
  const incoming = ugds.filter(isIncoming);
  data.kpis.incomingHsGpa = meanPositive(incoming, (s) => s.hsGpa, 2);
  data.kpis.avgAct = meanPositive(incoming, (s) => s.act, 1);
  data.kpis.avgSat = meanPositive(incoming, (s) => s.sat, 0, 5, 400);
  data.kpis.avgClt = meanPositive(incoming, (s) => s.clt, 1);
  if (data.kpis.incomingHsGpa != null || data.kpis.avgAct != null || data.kpis.avgSat != null || data.kpis.avgClt != null) {
    data.pending = data.pending.filter((p) => !/Incoming SAT \/ ACT \/ CLT \/ HS GPA/i.test(p));
  }
  if (tables.countries.length) data.kpis.foreignCountries = tables.countries.length;
  const onCampus = tables.residency.find((r) => r.label === "On Campus" || r.label === "Resident");
  if (tables.n) data.kpis.ugOnCampusPct = (onCampus?.n ?? 0) / tables.n;
  for (const key of Object.keys(summary) as (keyof CensusSummary)[]) {
    const c = summary[key];
    if (!c) continue;
    patchYear0(data, key, c);
  }
  const ds = historicalSeries(data.historical, "degreeSeeking");
  if (!ds.fullTime) ds.fullTime = Array.from({ length: data.historical.years.length }, () => null);
  ds.fullTime[0] = fullTimeUg(data);
  data.historical.degreeSeeking = ds;
  return data;
}

export const KPI_DEFS: Record<string, string> = {
  allStudents:
    "Every person on Fall 2026 Registration Status (Registration Status-29.xlsx). One row per PCID. Undergraduate, graduate, dual enrollment, and non-degree — no program filter.",
  ugStudents:
    "Registration Status rows with Program = UNDERG and College Attend not DUAL, EACO, or ND (B.A. and B.S.). Default Census Report view. Mount Melleray Abbey is included.",
  ireland:
    "UG degree-seeking at Mount Melleray Abbey (session 03Ireland). Also counted in Returning and Total Degree-Seeking.",
  ugOnCampus:
    "UG degree-seeking in campus halls (On Campus). Mount Melleray Abbey is not On Campus.",
  incomingHsGpa:
    "Mean HS GPA for Fall 2026 incoming UG degree-seeking students with a score. Verified incoming extract; 0 is missing.",
  pctCatholic:
    "UG degree-seeking students whose Religion is Catholic or Eastern Rite Catholic. Non-Catholic is not Catholic. From Registration Status Religion.",
  testScores:
    "Mean verified CLT / ACT / SAT superscores for Fall 2026 incoming UG degree-seeking students. 0 is missing. SAT below 400 is missing.",
};

export const SUMMARY_DEFS: Record<string, string> = {
  "Undergraduate, New Students Admitted":
    "UG degree-seeking Incoming. First-time except last year's dual enrollment who are freshman FTCA this year — those are Incoming, not Returning.",
  FTCA: "Incoming UG degree-seeking with College Attend = FTCA, any class. Spring/summer admits are Returning, not this line. Includes former dual enrollment who are FTCA this fall.",
  TRAN: "Incoming UG degree-seeking with College Attend = TRAN (transfer).",
  READ: "Incoming UG degree-seeking with College Attend = READ (readmit).",
  SECB: "Incoming UG degree-seeking with College Attend = SECB (second bachelor's).",
  Other:
    "Incoming UG degree-seeking whose College Attend is not FTCA, TRAN, READ, or SECB (blank college or dual-BA coded GRAD).",
  "Lux Mundi": "UG degree-seeking with Session 01LuxMundi. Breakout; also in Incoming / Returning.",
  "Returning Students":
    "UG degree-seeking who were already on the Fall 2025 census. Mount Melleray Abbey is included here.",
  "Mount Melleray Abbey":
    "UG degree-seeking on session 03Ireland (Mount Melleray Abbey). Breakout only — also in Returning and Total Degree-Seeking. Not On Campus.",
  "On Campus": "UG degree-seeking in residence halls. Residential = On Campus. Mount Melleray Abbey is separate.",
  "Total Degree-Seeking": "Program = UNDERG and College Attend not DUAL, EACO, or ND. Incoming + Returning.",
  "On-campus dual enrollment":
    "College Attend = DUAL or Degree = HSDE. Online dual enrollment (Chesterton / Early College) is not this line. FTE is credits/12 when Full/Part is blank.",
  "Online dual enrollment":
    "Early College (Program EACOL / College Attend EACO), plus DE Type = Chesterton. Not inside on-campus dual enrollment and not inside Non-Degree.",
  "Non-Degree-Seeking / Personal Enrichment":
    "Everyone who is not UG degree-seeking, not dual enrollment, not online dual enrollment, and not Program = GRAD (ND / PENRIC / NONDEG).",
  "Lux Mundi Non-Degree-Seeking / Personal Enrichment":
    "Non-degree rows with Session 01LuxMundi. Not UG Lux Mundi and not graduate Lux Mundi.",
  "TOTAL UNDERGRADUATE ENROLLMENT": "UG degree-seeking + on-campus dual enrollment + online dual enrollment + non-degree.",
  "MA Philosophy": "Program = GRAD, curriculum MAPHIL (M.A. in Philosophy). Excludes Lux Mundi.",
  "MA Theology on-campus":
    "Program = GRAD, curriculum MATHEO (M.A. in Theology), excluding Lux Mundi. Same series as prior-year Graduate MA Students.",
  "PhD Theology": "Program = GRAD, Degree = PHD (Ph.D. Theology).",
  MBA: "Program = GRAD, Degree = MBA.",
  "M. Education": "Program = GRAD, Degree = MEdCL (M.Ed. Catholic Educational Leadership).",
  "MA CRW": "Program = GRAD, curriculum MACOMM. Same line as FA25 Summary MA CRW / Historical Graduate MA Comm.",
  "MA Theology online": "Program = GRAD and Session 01LuxMundi. Counted in Total Graduate, not in campus MA Theology.",
  "TOTAL GRADUATE ENROLLMENT": "Program = GRAD (Philosophy + Theology + PhD + MBA + M.Ed + CRW + Lux Mundi).",
  "Graduate & Undergraduate Enrollment":
    "All Registration Status rows for Fall 2026. Same number as the All students box.",
};
