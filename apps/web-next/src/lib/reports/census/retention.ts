import {
  canonicalCensusSport,
  isInterveningGraduate,
  isSpringOrSummerAdmit,
  isTeamAthlete,
  isUgDegreeSeekingRow,
  normPcid,
  type CensusLists,
  type CensusRawStudent,
  type UnretainedStudent,
} from "./lists-core";
import { ETHNICITY_NAMES, GPA_ORDER } from "./present";
import type { AttritionRow, FtcaAttrition } from "./types";
import { applyCensusRetentionNotes, isLeaveOfAbsence, RETENTION_FORCE_RETAINED } from "./retention-overrides";

export type GraduateRecord = {
  pcid: string;
  year?: string | number;
  term?: string;
  program?: string;
};

export type FtcaRawRow = {
  pcid: string;
  first: string;
  last: string;
  retained: "Retained" | "Not Retained" | "Graduated";
  ftca: string;
  religion: string;
  cathGroup: string;
  catholicNonCatholic: string;
  fa25Sport: string;
  fa25Curriculum: string;
  fa25FullPart: string;
  fa25Credits: number | string;
  fa25Residency: string;
  fa25Gpa: number | string;
  fa26Sport: string;
  fa26Curriculum: string;
  fa26Class: string;
  fa26FullPart: string;
  fa26Credits: number | string;
  fa26Gpa: number | string;
  fa26Residency: string;
  dob: string;
  gender: string;
  ethnicity: string;
  hsGpa: number | string;
  city: string;
  state: string;
};

export type SportRetentionRow = {
  sport: string;
  roster: number;
  athletes: number;
  associated: number;
  notRetained: number;
  retained: number;
  graduated: number;
  retentionPct: number | null;
  graduatedPct: number | null;
  retainedAvgGpa: number | null;
  notRetainedAvgGpa: number | null;
  notRetained3plus: number;
};

export type CrosstabRow = {
  label: string;
  label2?: string;
  students: number;
  notRetained: number;
  graduated: number;
  retentionPct: number | null;
};

export type RetentionSlice = {
  students: number;
  enrolled: number;
  graduated: number;
  notRetained: number;
  retentionPct: number | null;
};

/**
 * Still enrolled this fall / (cohort minus intervening graduates).
 * Same formula for All UG, FTCA, sports, and every crosstab. Graduates are not leavers and not in the denominator.
 */
export function retentionPct(students: number, notRetained: number, graduated = 0): number | null {
  const pool = students - graduated;
  if (pool <= 0) return null;
  return (pool - notRetained) / pool;
}

function retentionStatus(
  id: string,
  registered: Set<string>,
  graduated: Set<string>,
): "enrolled" | "left" | "graduated" | "loa" {
  if (graduated.has(id)) return "graduated";
  if (registered.has(id)) return "enrolled";
  if (isLeaveOfAbsence(id)) return "loa";
  return "left";
}

export type FtcaExtras = {
  byAthleteGender: CrosstabRow[];
  byEthnicityAthlete: CrosstabRow[];
  byResidencyGender: CrosstabRow[];
  byAppDecision: CrosstabRow[];
  byMaleFlorida: CrosstabRow[];
  byHsGpa: AttritionRow[];
  byHsGpaAthletes: AttritionRow[];
  byHsGpaFine: AttritionRow[];
  byHsGpaFineAthletes: AttritionRow[];
  byActConverted: AttritionRow[];
  byTestScore: AttritionRow[];
  byHonors: AttritionRow[];
  byFsp: AttritionRow[];
};

/** Catholic or Eastern Rite Catholic. Does not treat "Non-Catholic" as Catholic. */
export function isCatholic(s: { cathGroup?: string; religion?: string }): boolean {
  const rel = (s.religion || "").trim();
  if (rel && rel !== "-") {
    const r = rel.toLowerCase();
    if (/non[- ]?catholic/.test(r)) return false;
    if (r === "cath" || r === "ecat" || r === "catholic" || r === "eastern rite catholic") return true;
    return /catholic/.test(r);
  }
  return /^(catholic|cath|ecat)$/i.test((s.cathGroup || "").trim());
}

export function catholicOf(s: { cathGroup?: string; religion?: string }): "Catholic" | "Non-Catholic" {
  return isCatholic(s) ? "Catholic" : "Non-Catholic";
}

export function athleteOf(s: { athlete?: string; sport?: string }): "Athlete" | "Non-Athlete" {
  if ((s.athlete || "").trim() === "Athlete") return "Athlete";
  if ((s.athlete || "").trim() === "Non-Athlete") return "Non-Athlete";
  return sportOf(s).trim() ? "Athlete" : "Non-Athlete";
}

export function whiteOf(s: { ethnicity?: string }): "White" | "Non-White" {
  const e = (s.ethnicity || "").trim().toUpperCase();
  return e === "WHITE" ? "White" : "Non-White";
}

export function ethnicityLabel(raw: string): string {
  const t = (raw || "").trim();
  if (!t || t === "-") return "No Response";
  return ETHNICITY_NAMES[t.toUpperCase()] || t;
}

export function gpaBucket(gpa: number | string | null | undefined): string {
  const n = Number(gpa);
  if (!Number.isFinite(n)) return "No AMU GPA";
  if (n < 1) return "<1.0";
  if (n < 2) return "1.0 - 1.9";
  if (n < 2.5) return "2.0 - 2.49";
  if (n < 3) return "2.5 - 2.99";
  if (n < 3.5) return "3.0 - 3.49";
  return "3.5 - 4.0";
}

const HS_GPA_ORDER = ["<2.0", "2.0 - 2.49", "2.5 - 2.99", "3.0 - 3.49", "3.5 - 4.0", "No HS GPA"];
const HS_GPA_FINE_ORDER = ["2.9- 2.99", "3.0 - 3.09", "3.1 - 3.19", "3.2 - 3.29", "3.3 - 3.39", "3.4 - 3.49"];
const ACT_CONVERTED_ORDER = ["<18", "18-21", "22-24", "25-27", "28-30", "31-36", "No ACT converted"];
const TEST_SCORE_ORDER = ["Has test score", "No test score"];
const HONORS_ORDER = ["Honors", "No honors"];
const FSP_ORDER = ["FSP", "No FSP"];

/** College Board 2018 SAT total → ACT concordance. SAT below 400 is missing. */
const SAT_TO_ACT: [number, number][] = [
  [1570, 36],
  [1530, 35],
  [1490, 34],
  [1450, 33],
  [1420, 32],
  [1390, 31],
  [1360, 30],
  [1330, 29],
  [1300, 28],
  [1260, 27],
  [1230, 26],
  [1200, 25],
  [1160, 24],
  [1130, 23],
  [1100, 22],
  [1060, 21],
  [1030, 20],
  [990, 19],
  [960, 18],
  [920, 17],
  [880, 16],
  [830, 15],
  [780, 14],
  [730, 13],
  [690, 12],
  [650, 11],
  [620, 10],
  [590, 9],
];

export function satToAct(sat: number | string | null | undefined): number | null {
  const n = Number(sat);
  if (!Number.isFinite(n) || n < 400) return null;
  for (const [min, act] of SAT_TO_ACT) {
    if (n >= min) return act;
  }
  return 9;
}

function scorePositive(v: number | string | null | undefined, floor = 0): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= floor) return null;
  return n;
}

/** Higher of verified ACT and SAT converted to ACT. CLT-only is not an ACT converted score. */
export function actConverted(s: { act?: number | string; sat?: number | string }): number | null {
  const act = scorePositive(s.act);
  const fromSat = satToAct(s.sat);
  const scores = [act, fromSat].filter((n): n is number => n != null);
  return scores.length ? Math.max(...scores) : null;
}

export function hasTestScore(s: { act?: number | string; sat?: number | string; clt?: number | string }): boolean {
  return scorePositive(s.act) != null || satToAct(s.sat) != null || scorePositive(s.clt) != null;
}

export function actConvertedBucket(s: { act?: number | string; sat?: number | string }): string {
  const n = actConverted(s);
  if (n == null) return "No ACT converted";
  if (n < 18) return "<18";
  if (n < 22) return "18-21";
  if (n < 25) return "22-24";
  if (n < 28) return "25-27";
  if (n < 31) return "28-30";
  return "31-36";
}

function roundGpa(gpa: number | string | null | undefined): number | null {
  const n = Number(gpa);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Coarse HS GPA bands from the FA25 FTCA attrition sheet. */
export function hsGpaBucket(gpa: number | string | null | undefined): string {
  const n = roundGpa(gpa);
  if (n == null) return "No HS GPA";
  if (n < 2) return "<2.0";
  if (n < 2.5) return "2.0 - 2.49";
  if (n < 3) return "2.5 - 2.99";
  if (n < 3.5) return "3.0 - 3.49";
  return "3.5 - 4.0";
}

/** 2.9–3.49 tenth-point bands from the FA25 FTCA attrition sheet. Null if outside that range. */
export function hsGpaFineBucket(gpa: number | string | null | undefined): string | null {
  const n = roundGpa(gpa);
  if (n == null || n < 2.9 || n >= 3.5) return null;
  if (n < 3) return "2.9- 2.99";
  if (n < 3.1) return "3.0 - 3.09";
  if (n < 3.2) return "3.1 - 3.19";
  if (n < 3.3) return "3.2 - 3.29";
  if (n < 3.4) return "3.3 - 3.39";
  return "3.4 - 3.49";
}

function sortHsGpa(rows: AttritionRow[], order: string[]): AttritionRow[] {
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.label);
    const bi = order.indexOf(b.label);
    return (ai === -1 ? 50 : ai) - (bi === -1 ? 50 : bi);
  });
}

/** Prefer EOT / unretained GPA, then current, then prior census GPA. */
export function collectGpa(lists: CensusLists): Map<string, number> {
  const m = new Map<string, number>();
  const take = (pcid: string, gpa: number | string | null | undefined, overwrite: boolean) => {
    const n = Number(gpa);
    if (!Number.isFinite(n)) return;
    const id = normPcid(pcid);
    if (!id) return;
    if (overwrite || !m.has(id)) m.set(id, n);
  };
  for (const s of lists.prior) take(s.pcid, s.gpa, false);
  for (const s of lists.students) take(s.pcid, s.gpa, false);
  for (const s of lists.unretained) take(s.pcid, s.gpa, true);
  return m;
}

/**
 * FA25 Summary FTCA line: Incoming AND College Attend = FTCA (392 on the gold census).
 * Class level does not matter. Spring/summer admits are out.
 */
export function isFtcaIncoming(s: {
  collegeAttend?: string;
  incomingReturning?: string;
  classLevel?: string;
  admitTerm?: string;
}): boolean {
  if ((s.collegeAttend || "").trim().toUpperCase() !== "FTCA") return false;
  if (!(s.incomingReturning || "").trim().toLowerCase().startsWith("incoming")) return false;
  if (isSpringOrSummerAdmit(s.admitTerm)) return false;
  return true;
}

export type RetentionHistoryRow = { label: string; rate: number };

/** Fall-to-fall label for the year ending `endYear` (2026 → F25–F26). */
export function fallToFallLabel(endYear: number): string {
  return `F${String(endYear - 1).slice(-2)}–F${String(endYear).slice(-2)}`;
}

function yearFromRetentionLabel(label: string): number {
  const m = /F(\d{2})\s*[–-]\s*F(\d{2})/i.exec(label);
  if (!m) return 0;
  const end = Number(m[2]);
  return end >= 50 ? 1900 + end : 2000 + end;
}

/** Put the live current-year rate on the historical series. Prior years stay as published. */
export function withLiveCurrentYearRate(
  series: RetentionHistoryRow[],
  endYear: number,
  rate: number | null | undefined,
): RetentionHistoryRow[] {
  const next = series.filter((r) => yearFromRetentionLabel(r.label) !== endYear);
  if (rate != null && Number.isFinite(rate)) next.push({ label: fallToFallLabel(endYear), rate });
  return next.sort((a, b) => yearFromRetentionLabel(a.label) - yearFromRetentionLabel(b.label));
}

export function applyLiveRetentionHistory<
  T extends {
    historical?: { years?: number[] };
    historicalFtcaRetention: RetentionHistoryRow[];
    historicalAllUgRetention: RetentionHistoryRow[];
  },
>(data: T, ftcaRate: number | null | undefined, ugRate: number | null | undefined): T {
  const endYear = data.historical?.years?.[0] ?? 2026;
  data.historicalFtcaRetention = withLiveCurrentYearRate(data.historicalFtcaRetention, endYear, ftcaRate);
  data.historicalAllUgRetention = withLiveCurrentYearRate(data.historicalAllUgRetention, endYear, ugRate);
  return data;
}

function blank(v: string | number | null | undefined): string {
  const t = v == null ? "" : String(v).trim();
  return !t || t === "-" ? "" : t;
}

function sportOf(s: { sport?: string }): string {
  return canonicalCensusSport(blank(s.sport));
}

export function ayGraduatePcids(grads: GraduateRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const g of grads) {
    if (isInterveningGraduate(g.year, g.term)) ids.add(normPcid(g.pcid));
  }
  return ids;
}

export function deriveFtcaRaw(
  prior: CensusRawStudent[],
  current: CensusRawStudent[],
  grads: GraduateRecord[],
): FtcaRawRow[] {
  const notes = withNotes(prior, current.map((s) => s.pcid), grads);
  const registered = new Map(current.map((s) => [normPcid(s.pcid), s]));
  const graduated = notes.graduated;
  return notes.rows
    .filter(isFtcaIncoming)
    .map((s) => {
      const id = normPcid(s.pcid);
      const now = registered.get(id);
      const retained: FtcaRawRow["retained"] = graduated.has(id)
        ? "Graduated"
        : now || RETENTION_FORCE_RETAINED.has(id)
          ? "Retained"
          : "Not Retained";
      return {
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        retained,
        ftca: s.collegeAttend || "FTCA",
        religion: s.religion || "",
        cathGroup: s.cathGroup || s.religion || "",
        catholicNonCatholic: catholicOf(s),
        fa25Sport: s.sport || "",
        fa25Curriculum: s.curriculumName || s.curriculum || "",
        fa25FullPart: s.fullPart || "",
        fa25Credits: s.credits,
        fa25Residency: s.residency || "",
        fa25Gpa: s.gpa,
        fa26Sport: now?.sport || "",
        fa26Curriculum: now?.curriculumName || now?.curriculum || "",
        fa26Class: now?.classLevel || "",
        fa26FullPart: now?.fullPart || "",
        fa26Credits: now?.credits ?? "",
        fa26Gpa: now?.gpa ?? "",
        fa26Residency: now?.residency || "",
        dob: s.dob || "",
        gender: s.gender || "",
        ethnicity: s.ethnicity || "",
        hsGpa: s.hsGpa ?? "",
        city: s.city || "",
        state: s.state || "",
      };
    })
    .sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}

/** Fall 2025 sport on the prior census. Leavers count against that sport. */
export function buildSportRetention(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  excludedSports: string[] = [],
  gpaByPcid: Map<string, number> = new Map(),
): SportRetentionRow[] {
  const notes = withNotes(prior, currentPcids, grads);
  prior = notes.rows;
  const registered = notes.registered;
  const graduated = notes.graduated;
  const excluded = new Set(excludedSports.map((s) => s.toLowerCase()));
  const map = new Map<
    string,
    SportRetentionRow & { retainedGpas: number[]; leftGpas: number[] }
  >();

  for (const s of prior) {
    if (!isUgDegreeSeekingRow(s.program, s.collegeAttend)) continue;
    const sport = sportOf(s);
    if (!sport) continue;
    if (excluded.has(sport.toLowerCase())) continue;
    const row = map.get(sport) || {
      sport,
      roster: 0,
      athletes: 0,
      associated: 0,
      notRetained: 0,
      retained: 0,
      graduated: 0,
      retentionPct: null,
      graduatedPct: null,
      retainedAvgGpa: null,
      notRetainedAvgGpa: null,
      notRetained3plus: 0,
      retainedGpas: [],
      leftGpas: [],
    };
    row.roster += 1;
    row.associated += 1;
    if (isTeamAthlete(s)) row.athletes += 1;
    const id = normPcid(s.pcid);
    const gpa = gpaByPcid.get(id) ?? Number(s.gpa);
    if (graduated.has(id)) row.graduated += 1;
    else if (registered.has(id)) {
      row.retained += 1;
      if (Number.isFinite(gpa)) row.retainedGpas.push(gpa);
    } else if (!isLeaveOfAbsence(id)) {
      row.notRetained += 1;
      if (Number.isFinite(gpa)) {
        row.leftGpas.push(gpa);
        if (gpa >= 3) row.notRetained3plus += 1;
      }
    }
    map.set(sport, row);
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return [...map.values()]
    .map((r) => {
      return {
        sport: r.sport,
        roster: r.roster,
        athletes: r.athletes,
        associated: r.associated,
        notRetained: r.notRetained,
        retained: r.retained,
        graduated: r.graduated,
        retentionPct: retentionPct(r.roster, r.notRetained, r.graduated),
        graduatedPct: r.roster > 0 ? r.graduated / r.roster : null,
        retainedAvgGpa: avg(r.retainedGpas),
        notRetainedAvgGpa: avg(r.leftGpas),
        notRetained3plus: r.notRetained3plus,
      };
    })
    .sort((a, b) => a.sport.localeCompare(b.sport));
}

function leftWithoutGrad(id: string, registered: Set<string>, graduated: Set<string>): boolean {
  return !registered.has(id) && !graduated.has(id) && !isLeaveOfAbsence(id);
}

function withNotes(
  rows: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
) {
  const notes = applyCensusRetentionNotes(rows, currentPcids, grads);
  return {
    rows: notes.prior,
    registered: new Set(notes.currentIds),
    graduated: ayGraduatePcids(notes.graduates),
    graduates: notes.graduates,
    currentIds: notes.currentIds,
  };
}

export function buildCrosstabOn(
  rows: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  pick: (s: CensusRawStudent) => string,
): CrosstabRow[] {
  const notes = withNotes(rows, currentPcids, grads);
  const registered = notes.registered;
  const graduated = notes.graduated;
  const map = new Map<string, CrosstabRow>();
  for (const s of notes.rows) {
    const label = (pick(s) || "Not listed").trim() || "Not listed";
    const row = map.get(label) || { label, students: 0, notRetained: 0, graduated: 0, retentionPct: null };
    row.students += 1;
    const id = normPcid(s.pcid);
    if (graduated.has(id)) row.graduated += 1;
    else if (leftWithoutGrad(id, registered, graduated)) row.notRetained += 1;
    map.set(label, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, retentionPct: retentionPct(r.students, r.notRetained, r.graduated) }))
    .sort((a, b) => b.students - a.students || a.label.localeCompare(b.label));
}

export function buildCrosstab(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  pick: (s: CensusRawStudent) => string,
): CrosstabRow[] {
  return buildCrosstabOn(
    prior.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend)),
    currentPcids,
    grads,
    pick,
  );
}

/** Committee admits (COMM) and admin overrides (ADM): FTCA, overall, gender, athlete. */
export function buildAdmitOverrideRetention(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
): CrosstabRow[] {
  const notes = withNotes(prior, currentPcids, grads);
  const ug = notes.rows.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend));
  const registered = notes.registered;
  const graduated = notes.graduated;
  const decision = (s: CensusRawStudent) => {
    const t = (s.appDecision || "").trim().toUpperCase();
    if (t === "ADM" || t === "ADMI") return "Admin override (ADM)";
    if (t === "COMM" || t === "CMRV") return "Committee admit (COMM)";
    return "";
  };
  const universes: { label2: string; keep: (s: CensusRawStudent) => boolean }[] = [
    { label2: "Overall", keep: () => true },
    { label2: "FTCA", keep: (s) => isFtcaIncoming(s) },
    { label2: "Male", keep: (s) => s.gender === "Male" },
    { label2: "Female", keep: (s) => s.gender === "Female" },
    { label2: "Athlete", keep: (s) => athleteOf(s) === "Athlete" },
    { label2: "Non-Athlete", keep: (s) => athleteOf(s) !== "Athlete" },
  ];
  const out: CrosstabRow[] = [];
  for (const admit of ["Admin override (ADM)", "Committee admit (COMM)"]) {
    const pool = ug.filter((s) => decision(s) === admit);
    for (const u of universes) {
      const rows = pool.filter(u.keep);
      if (!rows.length) continue;
      let notRetained = 0;
      let graduatedN = 0;
      for (const s of rows) {
        const id = normPcid(s.pcid);
        if (graduated.has(id)) graduatedN += 1;
        else if (leftWithoutGrad(id, registered, graduated)) notRetained += 1;
      }
      out.push({
        label: admit,
        label2: u.label2,
        students: rows.length,
        notRetained,
        graduated: graduatedN,
        retentionPct: retentionPct(rows.length, notRetained, graduatedN),
      });
    }
  }
  return out;
}

export function buildCrosstab2On(
  rows: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  pick1: (s: CensusRawStudent) => string,
  pick2: (s: CensusRawStudent) => string,
): CrosstabRow[] {
  const notes = withNotes(rows, currentPcids, grads);
  const registered = notes.registered;
  const graduated = notes.graduated;
  const map = new Map<string, CrosstabRow>();
  for (const s of notes.rows) {
    const label = (pick1(s) || "Not listed").trim() || "Not listed";
    const label2 = (pick2(s) || "Not listed").trim() || "Not listed";
    const key = `${label}\0${label2}`;
    const row = map.get(key) || { label, label2, students: 0, notRetained: 0, graduated: 0, retentionPct: null };
    row.students += 1;
    const id = normPcid(s.pcid);
    if (graduated.has(id)) row.graduated += 1;
    else if (leftWithoutGrad(id, registered, graduated)) row.notRetained += 1;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, retentionPct: retentionPct(r.students, r.notRetained, r.graduated) }))
    .sort((a, b) => a.label.localeCompare(b.label) || (a.label2 || "").localeCompare(b.label2 || ""));
}

export function buildAssociationRetention(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
): CrosstabRow[] {
  const notes = withNotes(prior, currentPcids, grads);
  prior = notes.rows;
  const registered = notes.registered;
  const graduated = notes.graduated;
  const buckets: { label: string; test: (s: CensusRawStudent) => boolean }[] = [
    { label: "Households", test: (s) => Boolean(blank(s.household)) },
    { label: "FSP", test: (s) => Boolean(blank(s.fsp)) },
    { label: "Mary's Marines", test: (s) => Boolean(blank(s.marines)) },
  ];
  const rows: CrosstabRow[] = [];
  for (const b of buckets) {
    const members = prior.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend) && b.test(s));
    for (const gender of ["Female", "Male"]) {
      const subset = members.filter((s) => s.gender === gender);
      const graduatedN = subset.filter((s) => graduated.has(normPcid(s.pcid))).length;
      const notRetained = subset.filter((s) => leftWithoutGrad(normPcid(s.pcid), registered, graduated)).length;
      rows.push({
        label: b.label,
        label2: gender,
        students: subset.length,
        notRetained,
        graduated: graduatedN,
        retentionPct: retentionPct(subset.length, notRetained, graduatedN),
      });
    }
  }
  return rows;
}

function sliceOf(
  rows: CensusRawStudent[],
  registered: Set<string>,
  graduated: Set<string>,
): RetentionSlice {
  let enrolled = 0;
  let grads = 0;
  let notRetained = 0;
  for (const s of rows) {
    const id = normPcid(s.pcid);
    if (graduated.has(id)) grads += 1;
    else if (registered.has(id)) enrolled += 1;
    else if (!isLeaveOfAbsence(id)) notRetained += 1;
  }
  return {
    students: rows.length,
    enrolled,
    graduated: grads,
    notRetained,
    retentionPct: retentionPct(rows.length, notRetained, grads),
  };
}

export function buildAllUgSplit(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
): { all: RetentionSlice; athletes: RetentionSlice; nonAthletes: RetentionSlice } {
  const notes = withNotes(prior, currentPcids, grads);
  const ug = notes.rows.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend));
  const registered = notes.registered;
  const graduated = notes.graduated;
  return {
    all: sliceOf(ug, registered, graduated),
    athletes: sliceOf(
      ug.filter((s) => athleteOf(s) === "Athlete"),
      registered,
      graduated,
    ),
    nonAthletes: sliceOf(
      ug.filter((s) => athleteOf(s) !== "Athlete"),
      registered,
      graduated,
    ),
  };
}

type AttritionCounts = { students: number; notRetained: number; graduated: number };

function attritionFromMap(map: Map<string, AttritionCounts>, notRetainedTotal: number): AttritionRow[] {
  return [...map.entries()]
    .map(([label, r]) => ({
      label,
      students: r.students,
      notRetained: r.notRetained,
      graduated: r.graduated,
      retainedPct: retentionPct(r.students, r.notRetained, r.graduated) ?? 0,
      shareOfNotRetained: notRetainedTotal ? r.notRetained / notRetainedTotal : 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function associationFlag(v?: string): boolean {
  const t = (v || "").trim();
  return Boolean(t) && t !== "-";
}

function bump(
  map: Map<string, AttritionCounts>,
  label: string,
  status: "enrolled" | "left" | "graduated" | "loa",
) {
  const row = map.get(label) || { students: 0, notRetained: 0, graduated: 0 };
  row.students += 1;
  if (status === "left") row.notRetained += 1;
  if (status === "graduated") row.graduated += 1;
  map.set(label, row);
}

/** FA25 Incoming AND FTCA only. Rate is enrolled / (cohort minus graduates), same as All UG. */
export function buildFtcaAttritionFromPrior(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  gpaByPcid: Map<string, number> = new Map(),
): FtcaAttrition {
  const notes = withNotes(prior, currentPcids, grads);
  const cohort = notes.rows.filter(isFtcaIncoming);
  const registered = notes.registered;
  const graduated = notes.graduated;
  let enrolledThisFall = 0;
  let notRetained = 0;
  let graduatedN = 0;
  const byState = new Map<string, AttritionCounts>();
  const byAthlete = new Map<string, AttritionCounts>();
  const bySport = new Map<string, AttritionCounts>();
  const byGpa = new Map<string, AttritionCounts>();
  const byEthnicity = new Map<string, AttritionCounts>();
  const byCatholicAthlete = new Map<string, AttritionCounts>();

  for (const s of cohort) {
    const id = normPcid(s.pcid);
    const status = retentionStatus(id, registered, graduated);
    if (status === "enrolled") enrolledThisFall += 1;
    if (status === "left") notRetained += 1;
    if (status === "graduated") graduatedN += 1;
    bump(byState, s.state || "International", status);
    bump(byAthlete, athleteOf(s), status);
    const sport = sportOf(s);
    if (sport) bump(bySport, sport, status);
    bump(byGpa, gpaBucket(gpaByPcid.get(id) ?? s.gpa), status);
    bump(byEthnicity, ethnicityLabel(s.ethnicity), status);
    bump(byCatholicAthlete, `${catholicOf(s)} / ${athleteOf(s)}`, status);
  }

  const gpaSorted = attritionFromMap(byGpa, notRetained).sort((a, b) => {
    const ai = GPA_ORDER.indexOf(a.label);
    const bi = GPA_ORDER.indexOf(b.label);
    const av = ai === -1 ? (a.label.startsWith("No ") ? 100 : 50) : ai;
    const bv = bi === -1 ? (b.label.startsWith("No ") ? 100 : 50) : bi;
    return av - bv;
  });

  return {
    cohort: cohort.length,
    enrolledThisFall,
    notRetained,
    graduated: graduatedN,
    retentionRate: retentionPct(cohort.length, notRetained, graduatedN) ?? 0,
    byState: attritionFromMap(byState, notRetained),
    byAthlete: attritionFromMap(byAthlete, notRetained),
    bySport: attritionFromMap(bySport, notRetained).filter((r) => r.label && r.label !== "Non-Athlete"),
    byGpa: gpaSorted,
    byEthnicity: attritionFromMap(byEthnicity, notRetained),
    byCatholicAthlete: attritionFromMap(byCatholicAthlete, notRetained),
  };
}

export function buildFtcaExtras(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
): FtcaExtras {
  const notes = withNotes(prior, currentPcids, grads);
  const cohort = notes.rows.filter(isFtcaIncoming);
  const registered = notes.registered;
  const graduated = notes.graduated;
  const byHsGpa = new Map<string, AttritionCounts>();
  const byHsGpaAthletes = new Map<string, AttritionCounts>();
  const byHsGpaFine = new Map<string, AttritionCounts>();
  const byHsGpaFineAthletes = new Map<string, AttritionCounts>();
  const byActConverted = new Map<string, AttritionCounts>();
  const byTestScore = new Map<string, AttritionCounts>();
  const byHonors = new Map<string, AttritionCounts>();
  const byFsp = new Map<string, AttritionCounts>();
  for (const s of cohort) {
    const status = retentionStatus(normPcid(s.pcid), registered, graduated);
    bump(byHsGpa, hsGpaBucket(s.hsGpa), status);
    const fine = hsGpaFineBucket(s.hsGpa);
    if (fine) bump(byHsGpaFine, fine, status);
    if (athleteOf(s) === "Athlete") {
      bump(byHsGpaAthletes, hsGpaBucket(s.hsGpa), status);
      if (fine) bump(byHsGpaFineAthletes, fine, status);
    }
    bump(byActConverted, actConvertedBucket(s), status);
    bump(byTestScore, hasTestScore(s) ? "Has test score" : "No test score", status);
    bump(byHonors, associationFlag(s.honors) ? "Honors" : "No honors", status);
    bump(byFsp, associationFlag(s.fsp) ? "FSP" : "No FSP", status);
  }
  const notRetained = cohort.filter((s) => leftWithoutGrad(normPcid(s.pcid), registered, graduated)).length;
  return {
    byAthleteGender: buildCrosstab2On(cohort, currentPcids, grads, athleteOf, (s) => s.gender || "—"),
    byEthnicityAthlete: buildCrosstab2On(cohort, currentPcids, grads, whiteOf, athleteOf),
    byResidencyGender: buildCrosstab2On(
      cohort,
      currentPcids,
      grads,
      (s) => s.residency || "Not listed",
      (s) => s.gender || "—",
    ),
    byAppDecision: buildCrosstabOn(cohort, currentPcids, grads, (s) => s.appDecision || "Not listed"),
    byMaleFlorida: buildCrosstab2On(
      cohort.filter((s) => s.gender === "Male" && (s.state || "").toUpperCase() === "FL"),
      currentPcids,
      grads,
      catholicOf,
      athleteOf,
    ),
    byHsGpa: sortHsGpa(attritionFromMap(byHsGpa, notRetained), HS_GPA_ORDER),
    byHsGpaAthletes: sortHsGpa(attritionFromMap(byHsGpaAthletes, notRetained), HS_GPA_ORDER),
    byHsGpaFine: sortHsGpa(attritionFromMap(byHsGpaFine, notRetained), HS_GPA_FINE_ORDER),
    byHsGpaFineAthletes: sortHsGpa(attritionFromMap(byHsGpaFineAthletes, notRetained), HS_GPA_FINE_ORDER),
    byActConverted: sortHsGpa(attritionFromMap(byActConverted, notRetained), ACT_CONVERTED_ORDER),
    byTestScore: sortHsGpa(attritionFromMap(byTestScore, notRetained), TEST_SCORE_ORDER),
    byHonors: sortHsGpa(attritionFromMap(byHonors, notRetained), HONORS_ORDER),
    byFsp: sortHsGpa(attritionFromMap(byFsp, notRetained), FSP_ORDER),
  };
}

export function toUnretainedSeed(prior: CensusRawStudent[]): UnretainedStudent[] {
  return prior.map((s) => ({
    pcid: s.pcid,
    first: s.first,
    last: s.last,
    retention: "",
    gpa: s.gpa,
    fsp: s.fsp,
    household: s.household,
    marines: s.marines,
    honors: s.honors,
    sport: s.sport,
    religion: s.religion,
    state: s.state,
    gender: s.gender,
    classLevel: s.classLevel,
    collegeAttend: s.collegeAttend,
    incomingReturning: s.incomingReturning,
    program: s.program,
    credits: s.credits,
    earnedCredits: s.earnedCredits,
  }));
}
