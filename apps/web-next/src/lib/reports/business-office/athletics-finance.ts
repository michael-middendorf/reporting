/**
 * Athletics finance (DST-2983): unrestricted Great Plains revenue, expense,
 * and net by athletic team, fiscal year to date.
 *
 * The Great Plains worker publishes sources/athletics-finance/balances/ (one
 * row per department + account + fiscal year + period) and
 * sources/athletics-finance/meta.json (period calendar). This module turns
 * those rows into per-scope summaries. The department map JSON next to this
 * file is the single source of truth for which department codes belong to
 * which team; the worker image reads the same file.
 */
import departmentMapJson from "./athletics-departments.json";
import { SPORTS, sportByKey } from "../athletics-coaching/sports";
import type { FinanceScope } from "./access";

export const ATHLETICS_FINANCE_SOURCE = "athletics-finance";
export const ATHLETICS_FINANCE_DATASET = "balances";
export const ATHLETICS_FINANCE_META_KEY = "sources/athletics-finance/meta.json";

export type FinanceGroup = "team" | "department_wide" | "unassigned";
export type FinanceCategory = "revenue" | "expense";

/** One published row. Money fields are decimal strings (or numbers). */
export type FinanceRow = {
  group: FinanceGroup;
  sport_key: string | null;
  dept: string;
  dept_desc: string;
  account: string;
  account_desc: string;
  category: FinanceCategory;
  fiscal_year: number;
  period: number;
  period_end: string | null;
  debit: string | number;
  credit: string | number;
  amount: string | number;
};

export type FinancePeriod = { fiscal_year: number; period: number; start: string; end: string };

export type FinanceMeta = {
  as_of: string | null;
  as_of_date: string;
  current_fy: number;
  prior_fy: number;
  current_period: number;
  periods: FinancePeriod[];
};

export type FinanceSummary = {
  revenue: number;
  expense: number;
  net: number;
  priorRevenue: number;
  priorExpense: number;
  priorNet: number;
  /** Phase 2 (Adaptive/Ramp). Always null for now. */
  budget: number | null;
};

export type TeamFinance = FinanceSummary & { sportKey: string; label: string };

export type AccountLine = {
  account: string;
  accountDesc: string;
  dept: string;
  deptDesc: string;
  category: FinanceCategory;
  /** Index i is current FY period i + 1, through currentPeriod. */
  byPeriod: number[];
  total: number;
};

export type SportDetail = {
  sportKey: string;
  label: string;
  periods: { period: number; end: string }[];
  revenue: AccountLine[];
  expense: AccountLine[];
  revenueByPeriod: number[];
  expenseByPeriod: number[];
  netByPeriod: number[];
};

export type AthleticsBalancesResponse = {
  asOf: string | null;
  asOfDate: string;
  currentFy: number;
  priorFy: number;
  currentPeriod: number;
  /** Last day of the current period (YTD runs through this period). */
  throughDate: string | null;
  teams: TeamFinance[];
  /** All-scope users only. */
  departmentWide: FinanceSummary | null;
  /** Business Office list and hub admins only. */
  unassigned: FinanceSummary | null;
  sport: SportDetail | null;
};

type RawMap = {
  version: number;
  teams: Record<string, string[]>;
  department_wide: string[];
  unassigned: string[];
};

export type DeptAssignment = { group: FinanceGroup; sportKey: string | null };

/** Validate the department map. Throws on any problem. */
export function validateDepartmentMap(
  raw: unknown,
  sportKeys: ReadonlySet<string> = new Set(SPORTS.map((sport) => sport.key)),
): Map<string, DeptAssignment> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("department map must be an object");
  }
  const map = raw as Partial<RawMap>;
  if (map.version !== 1) throw new Error("department map version must be 1");
  if (!map.teams || typeof map.teams !== "object" || !Object.keys(map.teams).length) {
    throw new Error("department map teams must be a non-empty object");
  }
  const out = new Map<string, DeptAssignment>();
  const add = (dept: unknown, group: FinanceGroup, sportKey: string | null) => {
    if (typeof dept !== "string" || !/^[0-9]{4}$/.test(dept)) {
      throw new Error(`department ${String(dept)} must be a 4-digit string`);
    }
    if (out.has(dept)) throw new Error(`department ${dept} appears more than once`);
    out.set(dept, { group, sportKey });
  };
  for (const [key, depts] of Object.entries(map.teams)) {
    if (!sportKeys.has(key)) throw new Error(`team key ${key} is not a known sport`);
    if (!Array.isArray(depts) || !depts.length) throw new Error(`team ${key} has no departments`);
    for (const dept of depts) add(dept, "team", key);
  }
  for (const group of ["department_wide", "unassigned"] as const) {
    const depts = map[group];
    if (!Array.isArray(depts)) throw new Error(`${group} must be a list`);
    for (const dept of depts) add(dept, group, null);
  }
  return out;
}

let cachedMap: Map<string, DeptAssignment> | null = null;

/** The validated department map (validated once per process). */
export function departmentMap(): Map<string, DeptAssignment> {
  if (!cachedMap) cachedMap = validateDepartmentMap(departmentMapJson);
  return cachedMap;
}

/** Sport keys that have at least one mapped department. */
export function mappedSportKeys(): string[] {
  const keys = new Set<string>();
  for (const assignment of departmentMap().values()) {
    if (assignment.sportKey) keys.add(assignment.sportKey);
  }
  return SPORTS.map((sport) => sport.key).filter((key) => keys.has(key));
}

function num(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Keep only rows the scope may see. Group and sport come from the department
 * map (not the row), so a stale or unexpected row cannot widen access.
 */
export function rowsForScope(
  rows: readonly FinanceRow[],
  scope: FinanceScope,
  deptMap: Map<string, DeptAssignment> = departmentMap(),
): (FinanceRow & { group: FinanceGroup; sport_key: string | null })[] {
  const sports = scope.all ? null : new Set(scope.sports);
  const out: (FinanceRow & { group: FinanceGroup; sport_key: string | null })[] = [];
  for (const row of rows) {
    const assignment = deptMap.get(String(row.dept ?? "").trim());
    if (!assignment) continue;
    if (assignment.group === "unassigned" && !(scope.all && scope.showUnassigned)) continue;
    if (assignment.group === "department_wide" && !scope.all) continue;
    if (assignment.group === "team" && sports && !sports.has(assignment.sportKey || "")) continue;
    out.push({ ...row, group: assignment.group, sport_key: assignment.sportKey });
  }
  return out;
}

function emptySummary(): FinanceSummary {
  return { revenue: 0, expense: 0, net: 0, priorRevenue: 0, priorExpense: 0, priorNet: 0, budget: null };
}

function addToSummary(summary: FinanceSummary, row: FinanceRow, meta: FinanceMeta) {
  if (row.period < 1 || row.period > meta.current_period) return;
  const amount = num(row.amount);
  if (row.fiscal_year === meta.current_fy) {
    if (row.category === "revenue") summary.revenue += amount;
    else summary.expense += amount;
  } else if (row.fiscal_year === meta.prior_fy) {
    if (row.category === "revenue") summary.priorRevenue += amount;
    else summary.priorExpense += amount;
  }
}

function finish(summary: FinanceSummary): FinanceSummary {
  const revenue = cents(summary.revenue);
  const expense = cents(summary.expense);
  const priorRevenue = cents(summary.priorRevenue);
  const priorExpense = cents(summary.priorExpense);
  return {
    revenue,
    expense,
    net: cents(revenue - expense),
    priorRevenue,
    priorExpense,
    priorNet: cents(priorRevenue - priorExpense),
    budget: null,
  };
}

function sportDetail(
  sportKey: string,
  rows: readonly FinanceRow[],
  meta: FinanceMeta,
): SportDetail {
  const count = Math.max(0, meta.current_period);
  const periods = Array.from({ length: count }, (_, i) => {
    const found = meta.periods.find((p) => p.fiscal_year === meta.current_fy && p.period === i + 1);
    return { period: i + 1, end: found?.end ?? "" };
  });
  const lines = new Map<string, AccountLine>();
  for (const row of rows) {
    if (row.sport_key !== sportKey || row.fiscal_year !== meta.current_fy) continue;
    if (row.period < 1 || row.period > count) continue;
    const id = `${row.category}|${row.account}`;
    let line = lines.get(id);
    if (!line) {
      line = {
        account: row.account,
        accountDesc: row.account_desc,
        dept: row.dept,
        deptDesc: row.dept_desc,
        category: row.category,
        byPeriod: Array.from({ length: count }, () => 0),
        total: 0,
      };
      lines.set(id, line);
    }
    line.byPeriod[row.period - 1] += num(row.amount);
  }
  const revenueByPeriod = Array.from({ length: count }, () => 0);
  const expenseByPeriod = Array.from({ length: count }, () => 0);
  for (const line of lines.values()) {
    line.byPeriod = line.byPeriod.map(cents);
    line.total = cents(line.byPeriod.reduce((sum, value) => sum + value, 0));
    const target = line.category === "revenue" ? revenueByPeriod : expenseByPeriod;
    line.byPeriod.forEach((value, i) => {
      target[i] += value;
    });
  }
  const sorted = [...lines.values()].sort((a, b) => a.account.localeCompare(b.account));
  return {
    sportKey,
    label: sportByKey[sportKey]?.label ?? sportKey,
    periods,
    revenue: sorted.filter((line) => line.category === "revenue"),
    expense: sorted.filter((line) => line.category === "expense"),
    revenueByPeriod: revenueByPeriod.map(cents),
    expenseByPeriod: expenseByPeriod.map(cents),
    netByPeriod: revenueByPeriod.map((value, i) => cents(value - expenseByPeriod[i])),
  };
}

/**
 * Build the API payload for one scope. rows must already be scoped with
 * rowsForScope; this function only adds up what it is given.
 */
export function buildAthleticsBalances(
  scopedRows: readonly FinanceRow[],
  meta: FinanceMeta,
  scope: FinanceScope,
  sportKey: string | null,
): AthleticsBalancesResponse {
  const teamKeys = scope.all ? mappedSportKeys() : scope.sports.filter((key) => sportByKey[key]);
  const teamSummaries = new Map<string, FinanceSummary>(teamKeys.map((key) => [key, emptySummary()]));
  const departmentWide = emptySummary();
  const unassigned = emptySummary();
  for (const row of scopedRows) {
    if (row.group === "team" && row.sport_key) {
      const summary = teamSummaries.get(row.sport_key);
      if (summary) addToSummary(summary, row, meta);
    } else if (row.group === "department_wide") {
      addToSummary(departmentWide, row, meta);
    } else if (row.group === "unassigned") {
      addToSummary(unassigned, row, meta);
    }
  }
  const through = meta.periods.find(
    (p) => p.fiscal_year === meta.current_fy && p.period === meta.current_period,
  );
  return {
    asOf: meta.as_of,
    asOfDate: meta.as_of_date,
    currentFy: meta.current_fy,
    priorFy: meta.prior_fy,
    currentPeriod: meta.current_period,
    throughDate: through?.end ?? null,
    teams: teamKeys.map((key) => ({
      sportKey: key,
      label: sportByKey[key]?.label ?? key,
      ...finish(teamSummaries.get(key) ?? emptySummary()),
    })),
    departmentWide: scope.all ? finish(departmentWide) : null,
    unassigned: scope.all && scope.showUnassigned ? finish(unassigned) : null,
    sport: sportKey ? sportDetail(sportKey, scopedRows, meta) : null,
  };
}
