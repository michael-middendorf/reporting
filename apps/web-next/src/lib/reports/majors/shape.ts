/**
 * DST-3015: Majors and Minors (Academic Affairs).
 *
 * Ports two legacy SSRS reports onto the nightly PowerCampus publish
 * (sources/powercampus/...):
 *   1. "Accepted Applicants by Major" (view VWU_AppByMajor), the Incoming tab.
 *   2. "Undergraduate Majors and Minors - Includes Active Registered and Active
 *      Deposited", the Current Students tab.
 *
 * Everything here is a pure function over row arrays. The payload is aggregate
 * counts only: person keys are used to join and dedupe, and never leave this
 * module (FERPA). Code columns may be padded, so every comparison trims.
 */

export type SourceRow = Record<string, unknown>;

export type MajorsSources = {
  academic: SourceRow[] | null;
  codeCurriculum: SourceRow[] | null;
  codeDegree: SourceRow[] | null;
  codeAppDecision: SourceRow[] | null;
  codeEnrollment: SourceRow[] | null;
  codeClassLevel: SourceRow[] | null;
  codeCollegeAttend: SourceRow[] | null;
  academicCalendar: SourceRow[] | null;
  /** Latest pulled_at among the loaded datasets (ISO), when known. */
  pulledAt?: string | null;
};

export const WAITING_MESSAGE = "Waiting for the next nightly PowerCampus refresh";

/** Legacy VWU_AppByMajor: the undergraduate admissions organization. */
export const INCOMING_ORG_CODE_ID = "O000000113";
const INCOMING_PROGRAMS = new Set(["UNDERG", "NDEG"]);
const INCOMING_ATTEND = new Set(["FTCA", "TRAN", "SECB"]);
const TRANSFER_ATTEND = new Set(["TRAN", "SECB"]);
const CURRENT_TERMS = new Set(["FALL", "SPRING"]);
const SESSION = "01";
const CLASS_LEVELS = ["FRES", "SOPH", "JR", "SR"] as const;

function text(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function code(v: unknown): string {
  return text(v).toUpperCase();
}

function personKey(row: SourceRow): string {
  return text(row.PEOPLE_CODE_ID) || text(row.PEOPLE_ID);
}

function hasColumn(rows: SourceRow[] | null, column: string): boolean {
  if (!rows || rows.length === 0) return false;
  return rows.some((r) => Object.prototype.hasOwnProperty.call(r, column));
}

/** Code table keyed by the trimmed CODE_VALUE_KEY (the value ACADEMIC stores). */
export class CodeTable {
  private readonly byKey = new Map<string, SourceRow>();

  constructor(rows: SourceRow[] | null) {
    for (const row of rows ?? []) {
      const key = code(row.CODE_VALUE_KEY);
      if (key && !this.byKey.has(key)) this.byKey.set(key, row);
    }
  }

  has(value: unknown): boolean {
    return this.byKey.has(code(value));
  }

  get(value: unknown): SourceRow | undefined {
    return this.byKey.get(code(value));
  }

  label(value: unknown): string {
    const row = this.get(value);
    return text(row?.LONG_DESC) || text(row?.MEDIUM_DESC) || text(value);
  }
}

/**
 * Columns and datasets that only exist after the first nightly publish with the
 * DST-3015 query changes. Until then the report shows a waiting state rather
 * than numbers computed without them.
 */
export function missingInputs(src: MajorsSources): string[] {
  const missing: string[] = [];
  if (!src.academic || src.academic.length === 0) missing.push("ACADEMIC");
  else {
    if (!hasColumn(src.academic, "APP_STATUS")) missing.push("ACADEMIC.APP_STATUS");
    if (!hasColumn(src.academic, "ORG_CODE_ID")) missing.push("ACADEMIC.ORG_CODE_ID");
  }
  if (!src.codeCurriculum || src.codeCurriculum.length === 0) missing.push("CODE_CURRICULUM");
  if (!hasColumn(src.codeDegree, "DEGREE_TYPE")) missing.push("CODE_DEGREE.DEGREE_TYPE");
  if (!hasColumn(src.codeAppDecision, "ACCEPTED_DECISION")) missing.push("CODE_APPDECISION.ACCEPTED_DECISION");
  if (!src.codeEnrollment) missing.push("CODE_ENROLLMENT");
  else if (!hasColumn(src.codeEnrollment, "REQUIRE_SEPDATE")) missing.push("CODE_ENROLLMENT.REQUIRE_SEPDATE");
  return missing;
}

type Ctx = {
  academic: SourceRow[];
  curriculum: CodeTable;
  degree: CodeTable;
  appDecision: CodeTable;
  enrollment: CodeTable;
  classLevel: CodeTable;
  collegeAttend: CodeTable;
  calendar: SourceRow[];
  /** academic rows by `${year}|${term}|${session}` */
  byTerm: Map<string, SourceRow[]>;
};

function termKey(year: string, term: string, session: string): string {
  return `${year}|${term}|${session}`;
}

function context(src: MajorsSources): Ctx {
  const academic = src.academic ?? [];
  const byTerm = new Map<string, SourceRow[]>();
  for (const row of academic) {
    const key = termKey(text(row.ACADEMIC_YEAR), code(row.ACADEMIC_TERM), text(row.ACADEMIC_SESSION));
    const list = byTerm.get(key);
    if (list) list.push(row);
    else byTerm.set(key, [row]);
  }
  return {
    academic,
    curriculum: new CodeTable(src.codeCurriculum),
    degree: new CodeTable(src.codeDegree),
    appDecision: new CodeTable(src.codeAppDecision),
    enrollment: new CodeTable(src.codeEnrollment),
    classLevel: new CodeTable(src.codeClassLevel),
    collegeAttend: new CodeTable(src.codeCollegeAttend),
    calendar: src.academicCalendar ?? [],
    byTerm,
  };
}

function isAccepted(ctx: Ctx, appDecision: unknown): boolean {
  return code(ctx.appDecision.get(appDecision)?.ACCEPTED_DECISION) === "Y";
}

export function degreeLabel(degree: CodeTable, value: unknown): string {
  const c = code(value);
  if (c === "BSCIEN") return "B.S.";
  if (c === "BARTS") return "B.A.";
  const row = degree.get(value);
  return text(row?.MEDIUM_DESC) || text(row?.LONG_DESC) || text(value);
}

// ---------------------------------------------------------------------------
// Incoming: legacy "Accepted Applicants by Major"
// ---------------------------------------------------------------------------

/** One VWU_AppByMajor row, reduced to the fields the report reads. No person key. */
export type IncomingViewRow = {
  year: string;
  curriculum: string;
  degree: string;
  collegeAttend: string;
  appStatus: string;
  appDecision: string;
};

/**
 * Port of VWU_AppByMajor. The legacy view also inner-joined PEOPLETYPE = 'APP';
 * that join removed 0 rows for 2026 (verified 2026-10-09), so it is
 * intentionally omitted and PEOPLETYPE is not published.
 */
function incomingView(ctx: Ctx): IncomingViewRow[] {
  // The view LEFT JOINs the same person's PRIMARY_FLAG = 'Y' rows for the same
  // year/term/session (inner-joined to CODE_CURRICULUM). It emits one view row
  // PER primary row, each keeping the application row's DEGREE, COLLEGE_ATTEND,
  // APP_STATUS and APP_DECISION. With no such primary row it uses A.CURRICULUM.
  // Verified against FA26 legacy output 2026-10-09 (two primaries = two rows).
  const primary = new Map<string, string[]>();
  for (const row of ctx.academic) {
    if (code(row.PRIMARY_FLAG) !== "Y") continue;
    if (!ctx.curriculum.has(row.CURRICULUM)) continue;
    const pk = personKey(row);
    if (!pk) continue;
    const key = `${pk}|${termKey(text(row.ACADEMIC_YEAR), code(row.ACADEMIC_TERM), text(row.ACADEMIC_SESSION))}`;
    const list = primary.get(key);
    if (list) list.push(code(row.CURRICULUM));
    else primary.set(key, [code(row.CURRICULUM)]);
  }

  const out: IncomingViewRow[] = [];
  for (const row of ctx.academic) {
    if (!INCOMING_PROGRAMS.has(code(row.PROGRAM))) continue;
    if (code(row.APPLICATION_FLAG) !== "Y") continue;
    if (code(row.ACADEMIC_TERM) !== "FALL" || text(row.ACADEMIC_SESSION) !== SESSION) continue;
    if (code(row.ORG_CODE_ID) !== INCOMING_ORG_CODE_ID) continue;
    const decision = code(row.APP_DECISION);
    if (!ctx.appDecision.has(decision)) continue;
    if (!(isAccepted(ctx, decision) || decision === "WDEP")) continue;
    if (!ctx.curriculum.has(row.CURRICULUM)) continue;
    const pk = personKey(row);
    const year = text(row.ACADEMIC_YEAR);
    const overrides = pk ? primary.get(`${pk}|${termKey(year, "FALL", SESSION)}`) : undefined;
    for (const curriculum of overrides ?? [code(row.CURRICULUM)]) {
      out.push({
        year,
        curriculum,
        degree: code(row.DEGREE),
        collegeAttend: code(row.COLLEGE_ATTEND),
        appStatus: code(row.APP_STATUS),
        appDecision: decision,
      });
    }
  }
  return out;
}

/** The report query's filter on top of the view. */
function incomingReportRows(view: IncomingViewRow[]): IncomingViewRow[] {
  return view.filter((r) => r.degree !== "NONDEG" && INCOMING_ATTEND.has(r.collegeAttend));
}

export type IncomingRow = {
  curriculum: string;
  major: string;
  degree: string;
  degreeLabel: string;
  ftcaAccepts: number;
  ftcaDeposits: number;
  tranAccepts: number;
  tranDeposits: number;
  totalAccepts: number;
  totalDeposits: number;
  acceptsPct: number;
  depositsPct: number;
  /** Same major and degree in year - 1; null when that year is not in the data. */
  priorAccepts: number | null;
  priorDeposits: number | null;
};

export type IncomingTotals = Omit<IncomingRow, "curriculum" | "major" | "degree" | "degreeLabel">;

export type IncomingTable = {
  year: string;
  priorYear: string;
  rows: IncomingRow[];
  totals: IncomingTotals;
};

type Counts = { ftcaAccepts: number; ftcaDeposits: number; tranAccepts: number; tranDeposits: number };

function emptyCounts(): Counts {
  return { ftcaAccepts: 0, ftcaDeposits: 0, tranAccepts: 0, tranDeposits: 0 };
}

/** Counts ROWS (legacy COUNT), not distinct people. */
function countIncoming(rows: IncomingViewRow[], year: string): Map<string, Counts> {
  const groups = new Map<string, Counts>();
  for (const r of rows) {
    if (r.year !== year) continue;
    const key = `${r.curriculum}|${r.degree}`;
    let g = groups.get(key);
    if (!g) {
      g = emptyCounts();
      groups.set(key, g);
    }
    const deposit = r.appStatus === "DEP" && r.appDecision !== "WDEP";
    if (r.collegeAttend === "FTCA") {
      g.ftcaAccepts += 1;
      if (deposit) g.ftcaDeposits += 1;
    } else if (TRANSFER_ATTEND.has(r.collegeAttend)) {
      g.tranAccepts += 1;
      if (deposit) g.tranDeposits += 1;
    }
  }
  return groups;
}

function share(n: number, total: number): number {
  return total > 0 ? n / total : 0;
}

function previousYear(year: string): string {
  const n = Number(year);
  return Number.isFinite(n) ? String(n - 1) : "";
}

export function incomingYears(rows: IncomingViewRow[]): string[] {
  return [...new Set(rows.map((r) => r.year))].filter(Boolean).sort().reverse();
}

function buildIncomingTable(ctx: Ctx, rows: IncomingViewRow[], year: string): IncomingTable {
  const priorYear = previousYear(year);
  const hasPrior = rows.some((r) => r.year === priorYear);
  const current = countIncoming(rows, year);
  const prior = countIncoming(rows, priorYear);

  const out: IncomingRow[] = [];
  for (const [key, c] of current) {
    const [curriculum, degree] = key.split("|") as [string, string];
    const p = prior.get(key);
    out.push({
      curriculum,
      major: ctx.curriculum.label(curriculum),
      degree,
      degreeLabel: degreeLabel(ctx.degree, degree),
      ...c,
      totalAccepts: c.ftcaAccepts + c.tranAccepts,
      totalDeposits: c.ftcaDeposits + c.tranDeposits,
      acceptsPct: 0,
      depositsPct: 0,
      priorAccepts: hasPrior ? (p ? p.ftcaAccepts + p.tranAccepts : 0) : null,
      priorDeposits: hasPrior ? (p ? p.ftcaDeposits + p.tranDeposits : 0) : null,
    });
  }

  const sum = (f: (r: IncomingRow) => number) => out.reduce((n, r) => n + f(r), 0);
  const totalAccepts = sum((r) => r.totalAccepts);
  const totalDeposits = sum((r) => r.totalDeposits);
  for (const r of out) {
    r.acceptsPct = share(r.totalAccepts, totalAccepts);
    r.depositsPct = share(r.totalDeposits, totalDeposits);
  }
  out.sort(
    (a, b) =>
      b.totalAccepts - a.totalAccepts ||
      a.major.localeCompare(b.major) ||
      a.degreeLabel.localeCompare(b.degreeLabel),
  );

  // Prior-year total covers every major in year - 1, including ones with no accepts this year.
  let priorAccepts: number | null = null;
  let priorDeposits: number | null = null;
  if (hasPrior) {
    priorAccepts = 0;
    priorDeposits = 0;
    for (const p of prior.values()) {
      priorAccepts += p.ftcaAccepts + p.tranAccepts;
      priorDeposits += p.ftcaDeposits + p.tranDeposits;
    }
  }

  return {
    year,
    priorYear,
    rows: out,
    totals: {
      ftcaAccepts: sum((r) => r.ftcaAccepts),
      ftcaDeposits: sum((r) => r.ftcaDeposits),
      tranAccepts: sum((r) => r.tranAccepts),
      tranDeposits: sum((r) => r.tranDeposits),
      totalAccepts,
      totalDeposits,
      acceptsPct: totalAccepts > 0 ? 1 : 0,
      depositsPct: totalDeposits > 0 ? 1 : 0,
      priorAccepts,
      priorDeposits,
    },
  };
}

// ---------------------------------------------------------------------------
// Current: legacy "Undergraduate Majors and Minors"
// ---------------------------------------------------------------------------

/** Pool row after the RANK() dedup. The person key never leaves this module. */
type CurrentRecord = {
  person: string;
  curriculum: string;
  degree: string;
  classLevel: string | null;
};

type RankKey = 1 | 2 | null;

/** null sorts first in SQL Server, so it is the smallest key. */
function rankLess(a: RankKey, b: RankKey): boolean {
  if (a === b) return false;
  if (a === null) return true;
  if (b === null) return false;
  return a < b;
}

function currentPool(ctx: Ctx, year: string, term: string): CurrentRecord[] {
  const rows = ctx.byTerm.get(termKey(year, term, SESSION)) ?? [];

  // People with any row this term whose separation code requires a separation date.
  const separated = new Set<string>();
  for (const row of rows) {
    if (code(ctx.enrollment.get(row.ENROLL_SEPARATION)?.REQUIRE_SEPDATE) === "Y") {
      const pk = personKey(row);
      if (pk) separated.add(pk);
    }
  }

  const candidates: { rec: CurrentRecord; k: RankKey }[] = [];
  for (const row of rows) {
    if (code(row.PROGRAM) !== "UNDERG") continue;
    if (code(row.STATUS) !== "A") continue;
    if (!ctx.degree.has(row.DEGREE)) continue;
    if (!ctx.curriculum.has(row.CURRICULUM)) continue;
    const deposited =
      code(row.APPLICATION_FLAG) === "Y" &&
      isAccepted(ctx, row.APP_DECISION) &&
      code(row.APP_STATUS) === "DEP";
    const sep = code(row.ENROLL_SEPARATION);
    if (!(deposited || sep === "ENRL" || sep === "GRAD")) continue;
    const pk = personKey(row);
    if (!pk || separated.has(pk)) continue;
    const k: RankKey =
      code(row.PRIMARY_FLAG) === "Y" ? 1 : code(row.APPLICATION_FLAG) === "Y" ? 2 : null;
    candidates.push({
      rec: {
        person: pk,
        curriculum: code(row.CURRICULUM),
        degree: code(row.DEGREE),
        classLevel: row.CLASS_LEVEL == null ? null : code(row.CLASS_LEVEL),
      },
      k,
    });
  }

  // RANK() OVER (PARTITION BY person, curriculum ORDER BY k) = 1: every row
  // tied at the minimum key survives.
  const minKey = new Map<string, RankKey>();
  for (const c of candidates) {
    const key = `${c.rec.person}|${c.rec.curriculum}`;
    if (!minKey.has(key) || rankLess(c.k, minKey.get(key) as RankKey)) minKey.set(key, c.k);
  }
  return candidates
    .filter((c) => minKey.get(`${c.rec.person}|${c.rec.curriculum}`) === c.k)
    .map((c) => c.rec);
}

export type CurrentRow = {
  label: string;
  fres: number;
  soph: number;
  jr: number;
  sr: number;
  /** Rows with a non-null CLASS_LEVEL (legacy COUNT(CLASS_LEVEL)). */
  total: number;
  pct: number;
  rank: number;
};

export type CurrentTable = {
  rows: CurrentRow[];
  totals: Omit<CurrentRow, "label" | "rank">;
};

export type CurrentTables = {
  year: string;
  term: string;
  majors: CurrentTable;
  majorsWithUndeclared: CurrentTable;
  minors: CurrentTable;
};

type Def = "majors" | "majorsWithUndeclared" | "minors";

function inDefinition(ctx: Ctx, r: CurrentRecord, def: Def): boolean {
  if (def === "minors") return r.degree === "MINOR";
  const type = code(ctx.degree.get(r.degree)?.DEGREE_TYPE);
  if (type === "O" || type === "N") return false;
  if (def === "majors" && r.curriculum === "UNDECI") return false;
  return true;
}

function buildCurrentTable(ctx: Ctx, pool: CurrentRecord[], def: Def): CurrentTable {
  const groups = new Map<string, CurrentRow>();
  for (const r of pool) {
    if (!inDefinition(ctx, r, def)) continue;
    // Legacy groups by curriculum LONG_DESC.
    const label = ctx.curriculum.label(r.curriculum);
    let g = groups.get(label);
    if (!g) {
      g = { label, fres: 0, soph: 0, jr: 0, sr: 0, total: 0, pct: 0, rank: 0 };
      groups.set(label, g);
    }
    if (r.classLevel === "FRES") g.fres += 1;
    else if (r.classLevel === "SOPH") g.soph += 1;
    else if (r.classLevel === "JR") g.jr += 1;
    else if (r.classLevel === "SR") g.sr += 1;
    if (r.classLevel !== null) g.total += 1;
  }
  const rows = [...groups.values()];
  const grand = rows.reduce((n, r) => n + r.total, 0);
  for (const r of rows) {
    r.pct = share(r.total, grand);
    r.rank = 1 + rows.filter((o) => o.total > r.total).length;
  }
  rows.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  const sum = (f: (r: CurrentRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  return {
    rows,
    totals: {
      fres: sum((r) => r.fres),
      soph: sum((r) => r.soph),
      jr: sum((r) => r.jr),
      sr: sum((r) => r.sr),
      total: grand,
      pct: grand > 0 ? 1 : 0,
    },
  };
}

function buildCurrentTables(ctx: Ctx, year: string, term: string): CurrentTables {
  const pool = currentPool(ctx, year, term);
  return {
    year,
    term,
    majors: buildCurrentTable(ctx, pool, "majors"),
    majorsWithUndeclared: buildCurrentTable(ctx, pool, "majorsWithUndeclared"),
    minors: buildCurrentTable(ctx, pool, "minors"),
  };
}

export type TermOption = { year: string; term: string; label: string };

function termLabel(year: string, term: string): string {
  return `${term === "FALL" ? "Fall" : term === "SPRING" ? "Spring" : term} ${year}`;
}

function dateOnly(v: unknown): string {
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

function calendarStart(ctx: Ctx, year: string, term: string): string {
  for (const row of ctx.calendar) {
    if (text(row.ACADEMIC_YEAR) !== year) continue;
    if (code(row.ACADEMIC_TERM) !== term) continue;
    if (text(row.ACADEMIC_SESSION) !== SESSION) continue;
    const start = dateOnly(row.START_DATE);
    if (start) return start;
  }
  return "";
}

/** FALL/SPRING session 01 terms with a non-empty pool, newest first. */
function currentTerms(ctx: Ctx): TermOption[] {
  const out: TermOption[] = [];
  for (const key of ctx.byTerm.keys()) {
    const [year, term, session] = key.split("|") as [string, string, string];
    if (session !== SESSION || !CURRENT_TERMS.has(term) || !year) continue;
    if (currentPool(ctx, year, term).length === 0) continue;
    out.push({ year, term, label: termLabel(year, term) });
  }
  // Same ACADEMIC_YEAR: FALL comes after SPRING.
  const order = (t: TermOption) => `${t.year}|${t.term === "FALL" ? "2" : "1"}`;
  return out.sort((a, b) => order(b).localeCompare(order(a)));
}

/**
 * The current or most recent term: the latest term whose academic_calendar
 * START_DATE is on or before today. Without calendar dates, the newest term in
 * the data.
 */
function defaultTerm(ctx: Ctx, terms: TermOption[], today: string): TermOption | null {
  let best: { t: TermOption; start: string } | null = null;
  for (const t of terms) {
    const start = calendarStart(ctx, t.year, t.term);
    if (!start || start > today) continue;
    if (!best || start > best.start) best = { t, start };
  }
  return best?.t ?? terms[0] ?? null;
}

function termStarted(ctx: Ctx, year: string, term: string, today: string): boolean {
  const start = calendarStart(ctx, year, term);
  return !start || start <= today;
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export type TrendRow = {
  label: string;
  counts: number[];
  /** Latest fall minus the fall before it. */
  changePrior: number | null;
  /** Latest fall minus the fall five years earlier (when that fall is in the data). */
  change5: number | null;
};

export type TrendTable = {
  years: string[];
  /** The fall compared against in change5 (latest - 5). */
  compareYear: string | null;
  rows: TrendRow[];
  totals: TrendRow;
};

export type IncomingTrendRow = {
  label: string;
  accepts: number[];
  deposits: number[];
  acceptsChangePrior: number | null;
  depositsChangePrior: number | null;
};

export type IncomingTrend = {
  years: string[];
  /** Fall years whose term has not started yet (counts still moving). */
  inProgress: string[];
  rows: IncomingTrendRow[];
  totals: IncomingTrendRow;
};

export type Trends = {
  majorsWithUndeclared: TrendTable;
  minors: TrendTable;
  incoming: IncomingTrend;
};

function trendTable(ctx: Ctx, fallYears: string[], def: Def, allFalls: Set<string>): TrendTable {
  const byYear = new Map<string, CurrentTable>();
  const compareYear = fallYears.length ? previousYearBy(fallYears[fallYears.length - 1]!, 5) : null;
  const years = compareYear && allFalls.has(compareYear) ? [compareYear, ...fallYears] : fallYears;
  for (const y of years) byYear.set(y, buildCurrentTable(ctx, currentPool(ctx, y, "FALL"), def));

  const labels = new Set<string>();
  for (const y of fallYears) for (const r of byYear.get(y)!.rows) labels.add(r.label);

  const countOf = (y: string, label: string) =>
    byYear.get(y)?.rows.find((r) => r.label === label)?.total ?? 0;
  const totalOf = (y: string) => byYear.get(y)?.totals.total ?? 0;

  const latest = fallYears[fallYears.length - 1];
  const prev = fallYears[fallYears.length - 2];
  const hasCompare = Boolean(compareYear && allFalls.has(compareYear));
  const row = (label: string, get: (y: string) => number): TrendRow => ({
    label,
    counts: fallYears.map(get),
    changePrior: latest && prev ? get(latest) - get(prev) : null,
    change5: latest && hasCompare ? get(latest) - get(compareYear!) : null,
  });

  const rows = [...labels].map((label) => row(label, (y) => countOf(y, label)));
  rows.sort((a, b) => (b.counts[b.counts.length - 1] ?? 0) - (a.counts[a.counts.length - 1] ?? 0) || a.label.localeCompare(b.label));
  return {
    years: fallYears,
    compareYear: hasCompare ? compareYear : null,
    rows,
    totals: row("Total", totalOf),
  };
}

function previousYearBy(year: string, n: number): string {
  const v = Number(year);
  return Number.isFinite(v) ? String(v - n) : "";
}

function incomingTrend(ctx: Ctx, rows: IncomingViewRow[], years: string[], today: string): IncomingTrend {
  const fiveYears = [...years].sort().slice(-5);
  const byYear = new Map(fiveYears.map((y) => [y, countIncoming(rows, y)]));
  const perMajor = new Map<string, { accepts: number[]; deposits: number[] }>();
  fiveYears.forEach((y, i) => {
    for (const [key, c] of byYear.get(y)!) {
      const curriculum = key.split("|")[0]!;
      let m = perMajor.get(curriculum);
      if (!m) {
        m = { accepts: fiveYears.map(() => 0), deposits: fiveYears.map(() => 0) };
        perMajor.set(curriculum, m);
      }
      m.accepts[i]! += c.ftcaAccepts + c.tranAccepts;
      m.deposits[i]! += c.ftcaDeposits + c.tranDeposits;
    }
  });
  const change = (xs: number[]) => (xs.length >= 2 ? xs[xs.length - 1]! - xs[xs.length - 2]! : null);
  const out: IncomingTrendRow[] = [...perMajor.entries()].map(([curriculum, m]) => ({
    label: ctx.curriculum.label(curriculum),
    accepts: m.accepts,
    deposits: m.deposits,
    acceptsChangePrior: change(m.accepts),
    depositsChangePrior: change(m.deposits),
  }));
  out.sort(
    (a, b) =>
      (b.accepts[b.accepts.length - 1] ?? 0) - (a.accepts[a.accepts.length - 1] ?? 0) ||
      a.label.localeCompare(b.label),
  );
  const accepts = fiveYears.map((_, i) => out.reduce((n, r) => n + r.accepts[i]!, 0));
  const deposits = fiveYears.map((_, i) => out.reduce((n, r) => n + r.deposits[i]!, 0));
  return {
    years: fiveYears,
    inProgress: fiveYears.filter((y) => !termStarted(ctx, y, "FALL", today)),
    rows: out,
    totals: {
      label: "Total",
      accepts,
      deposits,
      acceptsChangePrior: change(accepts),
      depositsChangePrior: change(deposits),
    },
  };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export type MajorsParams = {
  incomingYear?: string | null;
  year?: string | null;
  term?: string | null;
};

export type CodeNote = { code: string; label: string };

export type MajorsReady = {
  status: "ready";
  generatedAt: string | null;
  incoming: IncomingTable & { years: string[] };
  current: CurrentTables & { terms: TermOption[]; label: string };
  trends: Trends;
  definitions: { collegeAttend: CodeNote[]; classLevels: CodeNote[] };
};

export type MajorsWaiting = {
  status: "waiting";
  generatedAt: string | null;
  message: string;
  missing: string[];
};

export type MajorsPayload = MajorsReady | MajorsWaiting;

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const EMPTY_INCOMING_TOTALS: IncomingTotals = {
  ftcaAccepts: 0,
  ftcaDeposits: 0,
  tranAccepts: 0,
  tranDeposits: 0,
  totalAccepts: 0,
  totalDeposits: 0,
  acceptsPct: 0,
  depositsPct: 0,
  priorAccepts: null,
  priorDeposits: null,
};

export function buildMajorsPayload(
  src: MajorsSources,
  params: MajorsParams = {},
  now: Date = new Date(),
): MajorsPayload {
  const generatedAt = src.pulledAt ?? null;
  const missing = missingInputs(src);
  if (missing.length) return { status: "waiting", generatedAt, message: WAITING_MESSAGE, missing };

  const ctx = context(src);
  const today = todayIso(now);

  const view = incomingReportRows(incomingView(ctx));
  const years = incomingYears(view);
  const incomingYear = years.includes(text(params.incomingYear)) ? text(params.incomingYear) : (years[0] ?? "");
  const incoming = incomingYear
    ? buildIncomingTable(ctx, view, incomingYear)
    : { year: "", priorYear: "", rows: [], totals: EMPTY_INCOMING_TOTALS };

  const terms = currentTerms(ctx);
  const wantYear = text(params.year);
  const wantTerm = code(params.term);
  const chosen =
    terms.find((t) => t.year === wantYear && t.term === wantTerm) ?? defaultTerm(ctx, terms, today);
  const current = chosen
    ? buildCurrentTables(ctx, chosen.year, chosen.term)
    : buildCurrentTables(ctx, "", "");

  const allFalls = new Set(terms.filter((t) => t.term === "FALL").map((t) => t.year));
  const startedFalls = [...allFalls].filter((y) => termStarted(ctx, y, "FALL", today)).sort();
  const lastFive = startedFalls.slice(-5);

  const collegeAttend = ["FTCA", "TRAN", "SECB"].map((c) => ({ code: c, label: ctx.collegeAttend.label(c) }));
  const classLevels = CLASS_LEVELS.map((c) => ({ code: c, label: ctx.classLevel.label(c) }));

  return {
    status: "ready",
    generatedAt,
    incoming: { ...incoming, years },
    current: { ...current, terms, label: chosen ? chosen.label : "" },
    trends: {
      majorsWithUndeclared: trendTable(ctx, lastFive, "majorsWithUndeclared", allFalls),
      minors: trendTable(ctx, lastFive, "minors", allFalls),
      incoming: incomingTrend(ctx, view, years, today),
    },
    definitions: { collegeAttend, classLevels },
  };
}

/** Matches a PowerCampus PEOPLE_CODE_ID (P + digits). Used by the PII tests. */
export const PCID_PATTERN = /P\d{6,}/;
