import {
  isDroppedCensusSport,
  isInterveningGraduate,
  isUgDegreeSeekingRow,
  normPcid,
  type CensusLists,
  type CensusRawStudent,
  type UnretainedStudent,
} from "./lists-core";
import { ETHNICITY_NAMES, GPA_ORDER } from "./present";
import type { AttritionRow, FtcaAttrition } from "./types";

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

export type FtcaExtras = {
  byAthleteGender: CrosstabRow[];
  byEthnicityAthlete: CrosstabRow[];
  byResidencyGender: CrosstabRow[];
  byAppDecision: CrosstabRow[];
  byMaleFlorida: CrosstabRow[];
};

export function catholicOf(s: { cathGroup?: string; religion?: string }): "Catholic" | "Non-Catholic" {
  return /cathol/i.test(s.cathGroup || s.religion || "") ? "Catholic" : "Non-Catholic";
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

export function isFtcaIncoming(s: { collegeAttend?: string; incomingReturning?: string }): boolean {
  return (
    (s.collegeAttend || "").trim().toUpperCase() === "FTCA" &&
    (s.incomingReturning || "").trim().toLowerCase().startsWith("incoming")
  );
}

function blank(v: string | number | null | undefined): string {
  const t = v == null ? "" : String(v).trim();
  return !t || t === "-" ? "" : t;
}

function sportOf(s: { sport?: string }): string {
  const t = blank(s.sport);
  if (isDroppedCensusSport(t)) return "";
  return t;
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
  const registered = new Map(current.map((s) => [normPcid(s.pcid), s]));
  const graduated = ayGraduatePcids(grads);
  return prior
    .filter(isFtcaIncoming)
    .map((s) => {
      const id = normPcid(s.pcid);
      const now = registered.get(id);
      const retained: FtcaRawRow["retained"] = graduated.has(id)
        ? "Graduated"
        : now
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
  const registered = new Set([...currentPcids].map(normPcid));
  const graduated = ayGraduatePcids(grads);
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
    const id = normPcid(s.pcid);
    const gpa = gpaByPcid.get(id) ?? Number(s.gpa);
    if (graduated.has(id)) row.graduated += 1;
    else if (registered.has(id)) {
      row.retained += 1;
      if (Number.isFinite(gpa)) row.retainedGpas.push(gpa);
    } else {
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
      const pool = r.roster - r.graduated;
      return {
        sport: r.sport,
        roster: r.roster,
        notRetained: r.notRetained,
        retained: r.retained,
        graduated: r.graduated,
        retentionPct: pool > 0 ? r.retained / pool : null,
        graduatedPct: r.roster > 0 ? r.graduated / r.roster : null,
        retainedAvgGpa: avg(r.retainedGpas),
        notRetainedAvgGpa: avg(r.leftGpas),
        notRetained3plus: r.notRetained3plus,
      };
    })
    .sort((a, b) => a.sport.localeCompare(b.sport));
}

function leftWithoutGrad(id: string, registered: Set<string>, graduated: Set<string>): boolean {
  return !registered.has(id) && !graduated.has(id);
}

export function buildCrosstabOn(
  rows: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  pick: (s: CensusRawStudent) => string,
): CrosstabRow[] {
  const registered = new Set([...currentPcids].map(normPcid));
  const graduated = ayGraduatePcids(grads);
  const map = new Map<string, CrosstabRow>();
  for (const s of rows) {
    const label = (pick(s) || "Not listed").trim() || "Not listed";
    const row = map.get(label) || { label, students: 0, notRetained: 0, graduated: 0, retentionPct: null };
    row.students += 1;
    const id = normPcid(s.pcid);
    if (graduated.has(id)) row.graduated += 1;
    else if (leftWithoutGrad(id, registered, graduated)) row.notRetained += 1;
    map.set(label, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, retentionPct: r.students ? (r.students - r.notRetained) / r.students : null }))
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

export function buildCrosstab2On(
  rows: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  pick1: (s: CensusRawStudent) => string,
  pick2: (s: CensusRawStudent) => string,
): CrosstabRow[] {
  const registered = new Set([...currentPcids].map(normPcid));
  const graduated = ayGraduatePcids(grads);
  const map = new Map<string, CrosstabRow>();
  for (const s of rows) {
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
    .map((r) => ({ ...r, retentionPct: r.students ? (r.students - r.notRetained) / r.students : null }))
    .sort((a, b) => a.label.localeCompare(b.label) || (a.label2 || "").localeCompare(b.label2 || ""));
}

export function buildAssociationRetention(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
): CrosstabRow[] {
  const registered = new Set([...currentPcids].map(normPcid));
  const graduated = ayGraduatePcids(grads);
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
      const pool = subset.length - graduatedN;
      rows.push({
        label: b.label,
        label2: gender,
        students: subset.length,
        notRetained,
        graduated: graduatedN,
        retentionPct: pool > 0 ? (pool - notRetained) / pool : null,
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
    else notRetained += 1;
  }
  const pool = rows.length - grads;
  return {
    students: rows.length,
    enrolled,
    graduated: grads,
    notRetained,
    retentionPct: pool > 0 ? enrolled / pool : null,
  };
}

export function buildAllUgSplit(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
): { all: RetentionSlice; athletes: RetentionSlice; nonAthletes: RetentionSlice } {
  const ug = prior.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend));
  const registered = new Set([...currentPcids].map(normPcid));
  const graduated = ayGraduatePcids(grads);
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

function attritionFromMap(
  map: Map<string, { students: number; notRetained: number }>,
  notRetainedTotal: number,
): AttritionRow[] {
  return [...map.entries()]
    .map(([label, r]) => ({
      label,
      students: r.students,
      notRetained: r.notRetained,
      retainedPct: r.students ? (r.students - r.notRetained) / r.students : 0,
      shareOfNotRetained: notRetainedTotal ? r.notRetained / notRetainedTotal : 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function bump(map: Map<string, { students: number; notRetained: number }>, label: string, left: boolean) {
  const row = map.get(label) || { students: 0, notRetained: 0 };
  row.students += 1;
  if (left) row.notRetained += 1;
  map.set(label, row);
}

/** FA25 Incoming AND FTCA only. Headline rate is enrolled / cohort, like the workbook. */
export function buildFtcaAttritionFromPrior(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  gpaByPcid: Map<string, number> = new Map(),
): FtcaAttrition {
  const cohort = prior.filter(isFtcaIncoming);
  const registered = new Set([...currentPcids].map(normPcid));
  const graduated = ayGraduatePcids(grads);
  let enrolledThisFall = 0;
  let notRetained = 0;
  const byState = new Map<string, { students: number; notRetained: number }>();
  const byAthlete = new Map<string, { students: number; notRetained: number }>();
  const bySport = new Map<string, { students: number; notRetained: number }>();
  const byGpa = new Map<string, { students: number; notRetained: number }>();
  const byEthnicity = new Map<string, { students: number; notRetained: number }>();
  const byCatholicAthlete = new Map<string, { students: number; notRetained: number }>();

  for (const s of cohort) {
    const id = normPcid(s.pcid);
    const left = leftWithoutGrad(id, registered, graduated);
    if (registered.has(id)) enrolledThisFall += 1;
    if (left) notRetained += 1;
    bump(byState, s.state || "International", left);
    bump(byAthlete, athleteOf(s), left);
    const sport = sportOf(s) || "Non-Athlete";
    bump(bySport, sport, left);
    bump(byGpa, gpaBucket(gpaByPcid.get(id) ?? s.gpa), left);
    bump(byEthnicity, ethnicityLabel(s.ethnicity), left);
    bump(byCatholicAthlete, `${catholicOf(s)} / ${athleteOf(s)}`, left);
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
    retentionRate: cohort.length ? enrolledThisFall / cohort.length : 0,
    byState: attritionFromMap(byState, notRetained),
    byAthlete: attritionFromMap(byAthlete, notRetained),
    bySport: attritionFromMap(bySport, notRetained).filter((r) => r.label !== "Non-Athlete" || r.students > 0),
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
  const cohort = prior.filter(isFtcaIncoming);
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
