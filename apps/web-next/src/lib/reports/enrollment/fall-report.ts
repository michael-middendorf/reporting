/**
 * Fall Admissions Report aggregator.
 * Builds every table from the PDF field spec using live Slate admission rows.
 * GOAL / FINAL / aid-goal cells come from fall-report-config.ts.
 */

import {
  _avg,
  _isDepositAsOf,
  _isNetDeposit,
  _isWithdrawnAsOf,
  _parseNum,
  _withdrawalCutoff,
} from "./process.js";
import {
  AID_GOAL,
  CONDITIONAL_CODES,
  EXTRA_ACCEPT_CODES,
  NAIA_SPORTS,
  REMOVED_FROM_ATHLETE_FA26,
  STUDENT_TYPE_LABELS,
  TUITION,
  YEAR_FINAL,
  YEAR_GOAL,
  type StudentTypeLabel,
} from "./fall-report-config";

export type AdmRow = Record<string, unknown>;

export type CountPct = { n: number; pct: number | null };

export type FunnelSlice = {
  apps: CountPct;
  accepted: CountPct;
  deposits: CountPct;
};

export type StudentTypeRow = {
  label: StudentTypeLabel;
  apps: Record<number, number>;
  accepted: Record<number, number>;
  deposits: Record<number, number>;
};

export type YearMetricRow = {
  apps: Record<number, number | null>;
  accepted: Record<number, number | null>;
  deposits: Record<number, number | null>;
};

export type ScoreCell = { avg: number | null; n: number };

export type ScoreRow = {
  n: number;
  act: ScoreCell;
  sat: ScoreCell;
  clt: ScoreCell;
  gpaAvg: number | null;
  honorsN: number | null;
  honorsGpaAvg: number | null;
};

export type FallReport = {
  reportYear: number;
  years: number[];
  aidYears: number[];
  residentYears: number[];
  hasResidencyField: boolean;
  hasHonorsField: boolean;
  byStudentType: {
    rows: StudentTypeRow[];
    composite: YearMetricRow;
    goal: YearMetricRow;
    final: YearMetricRow;
  };
  status: {
    total: number;
    denied: number;
    withdrawnDeposit: number;
    conditionalAccepted: number;
    interviewed: number;
  };
  naiaDeposits: {
    total: number;
    athletes: number;
    nonAthletes: number;
    athletePct: number | null;
    nonAthletePct: number | null;
  };
  residentCommuter: Record<
    number,
    { resident: CountPct; commuter: CountPct }
  >;
  religion: {
    overall: { catholic: FunnelSlice; other: FunnelSlice };
    naia: { catholic: FunnelSlice; other: FunnelSlice };
    others: { catholic: FunnelSlice; other: FunnelSlice };
  };
  gender: {
    overall: { male: FunnelSlice; female: FunnelSlice };
    naia: { male: FunnelSlice; female: FunnelSlice };
    others: { male: FunnelSlice; female: FunnelSlice };
  };
  aid: {
    accepted: Record<number, { aid: number | null; dr: number | null }>;
    deposited: Record<number, { aid: number | null; dr: number | null }>;
    goal: Record<number, { aid: number | null; dr: number | null }>;
  };
  scores: {
    acceptedNotDep: ScoreRow;
    activeDeposited: ScoreRow;
    priorClass: ScoreRow;
    priorClassLabel: string;
  };
};

const ACCEPT_CODES = new Set<string>([
  "AT",
  "CA",
  "ADMI",
  "CMRV",
  "CTA",
  ...EXTRA_ACCEPT_CODES,
]);

const CONDITIONAL = new Set<string>(CONDITIONAL_CODES);

function pick(r: AdmRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  const norm: Record<string, unknown> = {};
  for (const k of Object.keys(r)) {
    norm[k.toLowerCase().replace(/[^a-z0-9]/g, "")] = r[k];
  }
  for (const k of keys) {
    const nk = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    const v = norm[nk];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function fallYear(term: unknown): number | null {
  const s = String(term || "");
  let m = s.match(/Fall\s+(\d{4})/i);
  if (m) return +m[1];
  m = s.match(/\bFA(\d{2})\b/i);
  if (m) return 2000 + +m[1];
  m = s.match(/(\d{4})\s*FALL/i);
  if (m) return +m[1];
  return null;
}

export function mapStudentType(raw: unknown): StudentTypeLabel | null {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!s) return null;
  if (/transfer/.test(s)) return "Transfer";
  if (/re ?admit/.test(s) || /readmission/.test(s) || /re admission/.test(s)) {
    return "Re-Admit";
  }
  if (/second/.test(s) && (/degree/.test(s) || /bachelor/.test(s))) {
    return "Second Bachelor's";
  }
  if (
    /fresh/.test(s) ||
    (/first/.test(s) && (/year/.test(s) || /time/.test(s)))
  ) {
    return "First-Time Freshmen";
  }
  return null;
}

function splitCodes(raw: string): string[] {
  return raw
    .split(/[,;|/ ]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

export function decisionCodes(r: AdmRow): Set<string> {
  const parts = [
    pick(r, "AcceptCode"),
    pick(r, "DecisionCode"),
    pick(r, "FullAcceptCode"),
    pick(r, "AllDecisionCodes"),
  ].flatMap(splitCodes);
  return new Set(parts);
}

export function isAccepted(r: AdmRow): boolean {
  if (pick(r, "AcceptCode")) return true;
  const codes = decisionCodes(r);
  for (const c of codes) if (ACCEPT_CODES.has(c)) return true;
  return false;
}

export function isConditionalAccepted(r: AdmRow): boolean {
  const codes = decisionCodes(r);
  for (const c of codes) if (CONDITIONAL.has(c)) return true;
  return false;
}

export function isDenied(r: AdmRow): boolean {
  return !!pick(r, "DeniedCode");
}

export function isInterviewed(r: AdmRow): boolean {
  return pick(r, "InterviewStatus").toLowerCase() === "interviewed";
}

export function isCatholic(r: AdmRow): boolean {
  return pick(r, "Religion").toLowerCase() === "catholic";
}

export function genderOf(r: AdmRow): "M" | "F" | null {
  const g = pick(r, "Gender").toLowerCase();
  if (g === "m" || g === "male") return "M";
  if (g === "f" || g === "female") return "F";
  return null;
}

export function canonicalSport(raw: unknown): string {
  const original = String(raw || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!original) return "";
  const hasWomen = /(^|[\s-])(women'?s|womens|women|woman|female)(?=[\s-]|$)/.test(original);
  const hasMen =
    !hasWomen && /(^|[\s-])(men'?s|mens|men|man|male)(?=[\s-]|$)/.test(original);
  let sport = original
    .replace(
      /(^|[\s-])(women'?s|womens|women|woman|female|men'?s|mens|men|man|male)(?=[\s-]|$)/g,
      " ",
    )
    .replace(/[-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sport === "bb" || sport === "bkb") sport = "basketball";
  if (sport === "xc" || sport === "crosscountry") sport = "cross country";
  if (sport.includes("cross") && sport.includes("country")) sport = "cross country";
  if (sport.includes("color") && sport.includes("guard")) sport = "color guard-dance";
  if (sport.includes("dance") && (sport.includes("competitive") || sport.includes("color"))) {
    sport = sport.includes("color") ? "color guard-dance" : "competitive dance";
  }
  if (sport === "swim") sport = "swimming";
  if (/track/.test(sport)) sport = "track";
  if (sport.includes("ultimate")) sport = "ultimate frisbee";
  const gender = hasWomen ? "women" : hasMen ? "men" : "";
  return gender ? `${sport}-${gender}` : sport;
}

const NAIA_CANON = new Set(NAIA_SPORTS.map((s) => canonicalSport(s)));
const REMOVED_CANON = new Set(REMOVED_FROM_ATHLETE_FA26.map((s) => canonicalSport(s)));

export function isNaiaSport(raw: unknown, termYear: number): boolean {
  const key = canonicalSport(raw);
  if (!key) return false;
  if (termYear >= 2026 && REMOVED_CANON.has(key)) return false;
  if (NAIA_CANON.has(key)) return true;
  // Genderless allowlist entries (baseball, football, softball, volleyball, lacrosse, competitive dance)
  if (NAIA_CANON.has(key.replace(/-(men|women)$/, ""))) return true;
  return false;
}

export function residencyOf(r: AdmRow): "resident" | "commuter" | null {
  const raw = pick(
    r,
    "ResidencyPreference",
    "residency_preference",
    "AMUResidencyStatus",
    "CommuterCriteria",
  ).toLowerCase();
  if (!raw) return null;
  if (/commut|off[- ]campus/.test(raw)) return "commuter";
  if (/resident|on[- ]campus|hous/.test(raw)) return "resident";
  return null;
}

export function isHonors(r: AdmRow): boolean {
  const raw = pick(r, "HonorsDecision", "honors_decision").toLowerCase();
  if (!raw) return false;
  return /award|accept|yes|honor/.test(raw) && !/den/.test(raw);
}

function pct(n: number, d: number): number | null {
  if (!d) return null;
  return (n / d) * 100;
}

function emptyYearMap(years: number[], fill: number | null = 0): Record<number, number | null> {
  const o: Record<number, number | null> = {};
  for (const y of years) o[y] = fill;
  return o;
}

function sliceOf(
  rows: AdmRow[],
  pred: (r: AdmRow) => boolean,
  cutoffByYear: Map<number, Date>,
): FunnelSlice {
  const apps = rows.filter(pred);
  const accepted = apps.filter(isAccepted);
  const deposits = apps.filter((r) => {
    const y = fallYear(pick(r, "ApplicationTerm"));
    const cutoff = y ? cutoffByYear.get(y) : undefined;
    return cutoff ? _isNetDeposit(r, cutoff) : false;
  });
  const aN = apps.length;
  const cN = accepted.length;
  const dN = deposits.length;
  return {
    apps: { n: aN, pct: pct(aN, rows.length) },
    accepted: { n: cN, pct: pct(cN, rows.filter(isAccepted).length) },
    deposits: {
      n: dN,
      pct: pct(
        dN,
        rows.filter((r) => {
          const y = fallYear(pick(r, "ApplicationTerm"));
          const cutoff = y ? cutoffByYear.get(y) : undefined;
          return cutoff ? _isNetDeposit(r, cutoff) : false;
        }).length,
      ),
    },
  };
}

function aidAvg(rows: AdmRow[]): { aid: number | null; dr: number | null } {
  const vals = rows
    .map((r) => _parseNum(pick(r, "UnfundedAid")))
    .filter((v): v is number => v !== null && v > 0);
  const aid = _avg(vals);
  return {
    aid,
    dr: aid != null ? (aid / TUITION) * 100 : null,
  };
}

function scoreRow(rows: AdmRow[], includeHonors: boolean): ScoreRow {
  const acts = rows
    .map((r) => _parseNum(pick(r, "ACT")))
    .filter((v): v is number => v !== null && v > 0);
  const sats = rows
    .map((r) => _parseNum(pick(r, "SAT")))
    .filter((v): v is number => v !== null && v > 0);
  const clts = rows
    .map((r) => _parseNum(pick(r, "CLT")))
    .filter((v): v is number => v !== null && v > 0);
  const gpas = rows
    .map((r) => _parseNum(pick(r, "Self-ReportedHSGPA", "SelfReportedHSGPA")))
    .filter((v): v is number => v !== null && v > 0 && v <= 5);
  const honors = includeHonors ? rows.filter(isHonors) : [];
  const honorsGpas = honors
    .map((r) => _parseNum(pick(r, "Self-ReportedHSGPA", "SelfReportedHSGPA")))
    .filter((v): v is number => v !== null && v > 0 && v <= 5);
  return {
    n: rows.length,
    act: { avg: _avg(acts), n: acts.length },
    sat: { avg: _avg(sats), n: sats.length },
    clt: { avg: _avg(clts), n: clts.length },
    gpaAvg: _avg(gpas),
    honorsN: includeHonors ? honors.length : null,
    honorsGpaAvg: includeHonors ? _avg(honorsGpas) : null,
  };
}

function yearWindow(reportYear: number, present: number[]): number[] {
  const want = [];
  for (let y = reportYear - 6; y <= reportYear; y++) want.push(y);
  const have = new Set(present);
  // Always show the 7-year window ending at reportYear, even if some years are empty.
  if (have.size === 0) return want;
  return want;
}

export function buildFallReport(
  rows: AdmRow[],
  reportYear: number,
  asOf?: string | Date,
): FallReport {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const asOfDay = Number.isNaN(+asOfDate) ? new Date() : asOfDate;

  const presentYears = new Set<number>();
  const byYear: Record<number, AdmRow[]> = {};
  for (const r of rows) {
    const y = fallYear(pick(r, "ApplicationTerm"));
    if (!y) continue;
    presentYears.add(y);
    (byYear[y] ||= []).push(r);
  }

  const years = yearWindow(reportYear, [...presentYears]);
  const cutoffByYear = new Map<number, Date>();
  for (const y of years) cutoffByYear.set(y, _withdrawalCutoff(y, asOfDay));

  const typeRows: StudentTypeRow[] = STUDENT_TYPE_LABELS.map((label) => ({
    label,
    apps: emptyYearMap(years, 0) as Record<number, number>,
    accepted: emptyYearMap(years, 0) as Record<number, number>,
    deposits: emptyYearMap(years, 0) as Record<number, number>,
  }));
  const typeIndex = Object.fromEntries(
    STUDENT_TYPE_LABELS.map((l, i) => [l, i]),
  ) as Record<StudentTypeLabel, number>;

  const composite: YearMetricRow = {
    apps: emptyYearMap(years, 0),
    accepted: emptyYearMap(years, 0),
    deposits: emptyYearMap(years, 0),
  };

  for (const y of years) {
    for (const r of byYear[y] || []) {
      const label = mapStudentType(pick(r, "ApplicationStudentType"));
      if (!label) continue;
      const cutoff = cutoffByYear.get(y)!;
      const row = typeRows[typeIndex[label]];
      row.apps[y] += 1;
      composite.apps[y] = (composite.apps[y] || 0) + 1;
      if (isAccepted(r)) {
        row.accepted[y] += 1;
        composite.accepted[y] = (composite.accepted[y] || 0) + 1;
      }
      if (_isNetDeposit(r, cutoff)) {
        row.deposits[y] += 1;
        composite.deposits[y] = (composite.deposits[y] || 0) + 1;
      }
    }
  }

  const goal: YearMetricRow = {
    apps: emptyYearMap(years, null),
    accepted: emptyYearMap(years, null),
    deposits: emptyYearMap(years, null),
  };
  const final: YearMetricRow = {
    apps: emptyYearMap(years, null),
    accepted: emptyYearMap(years, null),
    deposits: emptyYearMap(years, null),
  };
  for (const y of years) {
    const g = YEAR_GOAL[y];
    if (g) {
      goal.apps[y] = g.apps;
      goal.accepted[y] = g.accepted;
      goal.deposits[y] = g.deposits;
    }
    if (y === reportYear) continue;
    const f = YEAR_FINAL[y];
    if (f) {
      final.apps[y] = f.apps;
      final.accepted[y] = f.accepted;
      final.deposits[y] = f.deposits;
    }
  }

  const curRows = byYear[reportYear] || [];
  const curCutoff = cutoffByYear.get(reportYear) || _withdrawalCutoff(reportYear, asOfDay);
  const status = {
    total: curRows.length,
    denied: curRows.filter(isDenied).length,
    withdrawnDeposit: curRows.filter(
      (r) => _isDepositAsOf(r, curCutoff) && _isWithdrawnAsOf(r, curCutoff),
    ).length,
    conditionalAccepted: curRows.filter(isConditionalAccepted).length,
    interviewed: curRows.filter(isInterviewed).length,
  };

  const curDeps = curRows.filter((r) => _isNetDeposit(r, curCutoff));
  const naiaDeps = curDeps.filter((r) =>
    isNaiaSport(pick(r, "Sport"), reportYear),
  );
  const naiaDeposits = {
    total: curDeps.length,
    athletes: naiaDeps.length,
    nonAthletes: curDeps.length - naiaDeps.length,
    athletePct: pct(naiaDeps.length, curDeps.length),
    nonAthletePct: pct(curDeps.length - naiaDeps.length, curDeps.length),
  };

  const hasResidencyField = rows.some((r) => residencyOf(r) != null);
  const hasHonorsField = rows.some((r) =>
    pick(r, "HonorsDecision", "honors_decision"),
  );

  const residentYears = years.filter((y) => y < reportYear);
  const residentCommuter: FallReport["residentCommuter"] = {};
  for (const y of residentYears) {
    const cutoff = cutoffByYear.get(y)!;
    const deps = (byYear[y] || []).filter((r) => _isNetDeposit(r, cutoff));
    const classified = deps
      .map(residencyOf)
      .filter((v): v is "resident" | "commuter" => v != null);
    const resN = classified.filter((v) => v === "resident").length;
    const comN = classified.filter((v) => v === "commuter").length;
    const d = resN + comN;
    residentCommuter[y] = {
      resident: { n: resN, pct: pct(resN, d) },
      commuter: { n: comN, pct: pct(comN, d) },
    };
  }

  const naiaCur = curRows.filter((r) => isNaiaSport(pick(r, "Sport"), reportYear));
  const othersCur = curRows.filter((r) => !isNaiaSport(pick(r, "Sport"), reportYear));
  const cutoffMapCur = new Map([[reportYear, curCutoff]]);

  function religionPair(set: AdmRow[]) {
    return {
      catholic: sliceOf(set, isCatholic, cutoffMapCur),
      other: sliceOf(set, (r) => !isCatholic(r), cutoffMapCur),
    };
  }
  function genderPair(set: AdmRow[]) {
    return {
      male: sliceOf(set, (r) => genderOf(r) === "M", cutoffMapCur),
      female: sliceOf(set, (r) => genderOf(r) === "F", cutoffMapCur),
    };
  }

  // Percents within a funnel stage should be of that stage's total in the slice,
  // not of the parent set. Recompute pct against the slice stage totals.
  function fixReligionPct(
    pair: ReturnType<typeof religionPair>,
  ): ReturnType<typeof religionPair> {
    const appsD = pair.catholic.apps.n + pair.other.apps.n;
    const accD = pair.catholic.accepted.n + pair.other.accepted.n;
    const depD = pair.catholic.deposits.n + pair.other.deposits.n;
    const fix = (side: FunnelSlice): FunnelSlice => ({
      apps: { n: side.apps.n, pct: pct(side.apps.n, appsD) },
      accepted: { n: side.accepted.n, pct: pct(side.accepted.n, accD) },
      deposits: { n: side.deposits.n, pct: pct(side.deposits.n, depD) },
    });
    return { catholic: fix(pair.catholic), other: fix(pair.other) };
  }
  function fixGenderPct(
    pair: ReturnType<typeof genderPair>,
  ): ReturnType<typeof genderPair> {
    const appsD = pair.male.apps.n + pair.female.apps.n;
    const accD = pair.male.accepted.n + pair.female.accepted.n;
    const depD = pair.male.deposits.n + pair.female.deposits.n;
    const fix = (side: FunnelSlice): FunnelSlice => ({
      apps: { n: side.apps.n, pct: pct(side.apps.n, appsD) },
      accepted: { n: side.accepted.n, pct: pct(side.accepted.n, accD) },
      deposits: { n: side.deposits.n, pct: pct(side.deposits.n, depD) },
    });
    return { male: fix(pair.male), female: fix(pair.female) };
  }

  const aidYears: number[] = [];
  for (let y = reportYear; y >= reportYear - 3; y--) aidYears.push(y);

  const aidAccepted: FallReport["aid"]["accepted"] = {};
  const aidDeposited: FallReport["aid"]["deposited"] = {};
  const aidGoal: FallReport["aid"]["goal"] = {};
  for (const y of aidYears) {
    const cutoff = cutoffByYear.get(y) || _withdrawalCutoff(y, asOfDay);
    const yr = byYear[y] || [];
    aidAccepted[y] = aidAvg(yr.filter(isAccepted));
    aidDeposited[y] = aidAvg(yr.filter((r) => _isNetDeposit(r, cutoff)));
    aidGoal[y] = AID_GOAL[y] || { aid: null, dr: null };
  }

  const freshmen = (set: AdmRow[]) =>
    set.filter((r) => mapStudentType(pick(r, "ApplicationStudentType")) === "First-Time Freshmen");
  const curFresh = freshmen(curRows);
  const curFreshAcc = curFresh.filter(isAccepted);
  const curFreshDep = curFresh.filter((r) => _isNetDeposit(r, curCutoff));
  const curFreshAccNotDep = curFreshAcc.filter((r) => !_isNetDeposit(r, curCutoff));
  const priorYear = reportYear - 1;
  const priorCutoff = cutoffByYear.get(priorYear) || _withdrawalCutoff(priorYear, asOfDay);
  const priorFreshDep = freshmen(byYear[priorYear] || []).filter((r) =>
    _isNetDeposit(r, priorCutoff),
  );

  return {
    reportYear,
    years,
    aidYears,
    residentYears,
    hasResidencyField,
    hasHonorsField,
    byStudentType: { rows: typeRows, composite, goal, final },
    status,
    naiaDeposits,
    residentCommuter,
    religion: {
      overall: fixReligionPct(religionPair(curRows)),
      naia: fixReligionPct(religionPair(naiaCur)),
      others: fixReligionPct(religionPair(othersCur)),
    },
    gender: {
      overall: fixGenderPct(genderPair(curRows)),
      naia: fixGenderPct(genderPair(naiaCur)),
      others: fixGenderPct(genderPair(othersCur)),
    },
    aid: { accepted: aidAccepted, deposited: aidDeposited, goal: aidGoal },
    scores: {
      acceptedNotDep: scoreRow(curFreshAccNotDep, true),
      activeDeposited: scoreRow(curFreshDep, true),
      priorClass: scoreRow(priorFreshDep, hasHonorsField),
      priorClassLabel: `Fall ${priorYear} Class`,
    },
  };
}
