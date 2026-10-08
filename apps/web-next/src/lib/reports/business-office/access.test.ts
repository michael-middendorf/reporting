import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessReport,
  canLogin,
  isBusinessOfficeUser,
  needsMfaAtSignIn,
  reportsForEmail,
} from "../../access";
import { canUseFerpaTotp } from "../../aspiredu-auth";
import { SPORTS } from "../athletics-coaching/sports";
import { financeScope, financeScopeAllowsSport } from "./access";
import departmentMapJson from "./athletics-departments.json";
import {
  buildAthleticsBalances,
  departmentMap,
  mappedSportKeys,
  priorThroughPeriod,
  rowsForScope,
  validateDepartmentMap,
  type FinanceMeta,
  type FinanceRow,
} from "./athletics-finance";

const BO = "Steve.Logan@avemaria.edu";
const BO2 = "luke.fier@avemaria.edu";
const LEADER = "Eric.VanHeusen@avemaria.edu";
const COACH = "robert.cooper@avemaria.edu"; // hardcoded head coach: mens-baseball
const ADMIN = "michael.t.middendorf@avemaria.edu";
const OTHER = "annie.esposito@avemaria.edu";

describe("Business Office access (DST-2983)", () => {
  it("gives the Business Office list every team plus unassigned", () => {
    for (const email of [BO, BO2]) {
      assert.deepEqual(financeScope(email), { all: true, showUnassigned: true }, email);
      assert.equal(canAccessReport(email, "business-office"), true, email);
      assert.equal(isBusinessOfficeUser(email), true, email);
      assert.equal(canLogin(email), true, email);
      assert.equal(needsMfaAtSignIn(email), true, email);
      assert.equal(reportsForEmail(email).includes("business-office"), true, email);
      assert.equal(canAccessReport(email, "athletics-coaching"), false, email);
    }
  });

  it("lets everyone who must do MFA at sign-in enroll and verify TOTP", () => {
    // Regression: needsMfaAtSignIn sent the Business Office to mfa_pending, but the
    // TOTP routes rejected them, so they could not sign in at all.
    for (const email of [BO, BO2, LEADER, COACH, ADMIN]) {
      assert.equal(needsMfaAtSignIn(email), canUseFerpaTotp(email), email);
    }
    assert.equal(canUseFerpaTotp(BO), true);
    assert.equal(canUseFerpaTotp(OTHER), false);
  });

  it("gives hub admins every team plus unassigned", () => {
    assert.deepEqual(financeScope(ADMIN), { all: true, showUnassigned: true });
  });

  it("gives coaching leadership every team, not unassigned", () => {
    assert.deepEqual(financeScope(LEADER), { all: true, showUnassigned: false });
    assert.equal(canAccessReport(LEADER, "business-office"), true);
    assert.equal(isBusinessOfficeUser(LEADER), false);
    assert.equal(financeScopeAllowsSport(financeScope(LEADER)!, "football"), true);
  });

  it("gives a head coach only their own sport", () => {
    const scope = financeScope(COACH);
    assert.deepEqual(scope, { all: false, sports: ["mens-baseball"] });
    assert.equal(financeScopeAllowsSport(scope!, "mens-baseball"), true);
    assert.equal(financeScopeAllowsSport(scope!, "football"), false);
    assert.equal(canAccessReport(COACH, "business-office"), false);
    assert.equal(reportsForEmail(COACH).includes("business-office"), false);
  });

  it("denies everyone else", () => {
    assert.equal(financeScope(OTHER), null);
    assert.equal(financeScope(""), null);
    assert.equal(financeScope(null), null);
    assert.equal(canAccessReport(OTHER, "business-office"), false);
  });

  it("merges BUSINESS_OFFICE_ALLOWED_EMAILS additively when set", () => {
    const prev = process.env.BUSINESS_OFFICE_ALLOWED_EMAILS;
    process.env.BUSINESS_OFFICE_ALLOWED_EMAILS = "new.person@avemaria.edu";
    try {
      assert.deepEqual(financeScope("new.person@avemaria.edu"), { all: true, showUnassigned: true });
      assert.deepEqual(financeScope(BO), { all: true, showUnassigned: true });
    } finally {
      if (prev === undefined) delete process.env.BUSINESS_OFFICE_ALLOWED_EMAILS;
      else process.env.BUSINESS_OFFICE_ALLOWED_EMAILS = prev;
    }
  });
});

describe("athletics department map", () => {
  it("is valid and every team key is a sport", () => {
    const map = departmentMap();
    assert.deepEqual(map.get("6552"), { group: "team", sportKey: "football" });
    assert.deepEqual(map.get("6117"), { group: "department_wide", sportKey: null });
    assert.deepEqual(map.get("8214"), { group: "unassigned", sportKey: null });
    const sportKeys = new Set(SPORTS.map((sport) => sport.key));
    for (const key of Object.keys(departmentMapJson.teams)) assert.equal(sportKeys.has(key), true, key);
    assert.deepEqual(mappedSportKeys().length, Object.keys(departmentMapJson.teams).length);
  });

  it("rejects duplicates, unknown sports, and bad codes", () => {
    const base = { version: 1, department_wide: [], unassigned: [] };
    assert.throws(
      () => validateDepartmentMap({ ...base, teams: { football: ["6552"] }, unassigned: ["6552"] }),
      /more than once/,
    );
    assert.throws(() => validateDepartmentMap({ ...base, teams: { curling: ["1234"] } }), /not a known sport/);
    assert.throws(() => validateDepartmentMap({ ...base, teams: { football: ["655"] } }), /4-digit/);
    assert.throws(() => validateDepartmentMap({ ...base, version: 2, teams: { football: ["6552"] } }), /version/);
  });
});

const SAMPLE_META: FinanceMeta = {
  as_of: "2026-10-08T08:15:00+00:00",
  as_of_date: "2026-10-08",
  current_fy: 2027,
  prior_fy: 2026,
  current_period: 2,
  periods: [
    { fiscal_year: 2026, period: 1, start: "2025-07-01", end: "2025-07-31" },
    { fiscal_year: 2026, period: 2, start: "2025-08-01", end: "2025-08-31" },
    { fiscal_year: 2026, period: 3, start: "2025-09-01", end: "2025-09-30" },
    { fiscal_year: 2027, period: 1, start: "2026-07-01", end: "2026-07-31" },
    { fiscal_year: 2027, period: 2, start: "2026-08-01", end: "2026-08-31" },
    { fiscal_year: 2027, period: 3, start: "2026-09-01", end: "2026-09-30" },
  ],
};

function row(
  dept: string,
  category: "revenue" | "expense",
  fiscalYear: number,
  period: number,
  amount: string,
  account = `900-${dept}-${category === "revenue" ? "4100" : "6100"}-00-00`,
): FinanceRow {
  return {
    group: "team",
    sport_key: null,
    dept,
    dept_desc: `Dept ${dept}`,
    account,
    account_desc: category === "revenue" ? "Revenue" : "Supplies",
    category,
    fiscal_year: fiscalYear,
    period,
    period_end: null,
    debit: "0.00",
    credit: "0.00",
    amount,
  };
}

const SAMPLE_ROWS: FinanceRow[] = [
  row("6552", "revenue", 2027, 1, "1000.00"), // football
  row("6552", "expense", 2027, 2, "400.50"), // football
  row("6552", "expense", 2027, 3, "999.00"), // football, after current period: not YTD
  row("6552", "revenue", 2026, 1, "800.00"), // football prior FY, completed month: compared
  row("6552", "expense", 2026, 2, "300.00"), // prior FY period matching the partial current month: excluded
  row("6552", "revenue", 2026, 3, "5000.00"), // prior FY, outside same periods
  row("6543", "expense", 2027, 1, "250.00"), // mens-baseball
  row("6117", "expense", 2027, 1, "75.00"), // department-wide
  row("8214", "revenue", 2027, 2, "60.00"), // unassigned
  row("1234", "revenue", 2027, 1, "1.00"), // not mapped: never shown
];

describe("athletics balances summaries", () => {
  it("adds up YTD and prior FY through the last completed month for Business Office", () => {
    const scope = { all: true as const, showUnassigned: true };
    const out = buildAthleticsBalances(rowsForScope(SAMPLE_ROWS, scope), SAMPLE_META, scope, null);
    const football = out.teams.find((t) => t.sportKey === "football")!;
    assert.equal(football.revenue, 1000);
    assert.equal(football.expense, 400.5);
    assert.equal(football.net, 599.5);
    assert.equal(football.priorRevenue, 800);
    assert.equal(football.priorExpense, 0);
    assert.equal(football.priorNet, 800);
    assert.equal(football.budget, null);
    assert.equal(out.teams.length, Object.keys(departmentMapJson.teams).length);
    assert.equal(out.departmentWide?.expense, 75);
    assert.equal(out.unassigned?.revenue, 60);
    assert.equal(out.throughDate, "2026-08-31");
    assert.equal(out.priorThroughPeriod, 1);
    assert.equal(out.priorThroughDate, "2025-07-31");
    assert.equal(out.sport, null);
  });

  it("compares prior FY only through the last completed month", () => {
    assert.equal(priorThroughPeriod({ current_period: 4 }), 3);
    assert.equal(priorThroughPeriod({ current_period: 1 }), 0);
    const scope = { all: true as const, showUnassigned: true };
    const rows = [
      row("6552", "revenue", 2027, 1, "100.00"),
      row("6552", "revenue", 2027, 2, "200.00"),
      row("6552", "revenue", 2027, 3, "300.00"), // current (partial) month: in current YTD
      row("6552", "revenue", 2026, 1, "10.00"),
      row("6552", "expense", 2026, 2, "20.00"),
      row("6552", "revenue", 2026, 3, "30.00"), // prior FY match for the partial month: excluded
      row("6552", "revenue", 2026, 4, "40.00"),
    ];
    const meta = { ...SAMPLE_META, current_period: 3 };
    const out = buildAthleticsBalances(rowsForScope(rows, scope), meta, scope, null);
    const football = out.teams.find((t) => t.sportKey === "football")!;
    assert.equal(football.revenue, 600);
    assert.equal(football.net, 600);
    assert.equal(football.priorRevenue, 10);
    assert.equal(football.priorExpense, 20);
    assert.equal(football.priorNet, -10);
    assert.equal(out.currentPeriod, 3);
    assert.equal(out.throughDate, "2026-09-30");
    assert.equal(out.priorThroughPeriod, 2);
    assert.equal(out.priorThroughDate, "2025-08-31");
  });

  it("has no prior FY comparison in period 1 (July)", () => {
    const scope = { all: true as const, showUnassigned: true };
    const meta = { ...SAMPLE_META, current_period: 1 };
    const out = buildAthleticsBalances(rowsForScope(SAMPLE_ROWS, scope), meta, scope, null);
    const football = out.teams.find((t) => t.sportKey === "football")!;
    assert.equal(football.revenue, 1000);
    assert.equal(football.expense, 0);
    assert.equal(football.net, 1000);
    assert.equal(football.priorRevenue, null);
    assert.equal(football.priorExpense, null);
    assert.equal(football.priorNet, null);
    assert.equal(out.departmentWide?.priorNet, null);
    assert.equal(out.unassigned?.priorNet, null);
    assert.equal(out.priorThroughPeriod, 0);
    assert.equal(out.priorThroughDate, null);
    assert.equal(out.throughDate, "2026-07-31");
  });

  it("leaves the prior FY end date null when meta lacks that period", () => {
    const scope = { all: true as const, showUnassigned: true };
    const meta = { ...SAMPLE_META, periods: SAMPLE_META.periods.filter((p) => p.fiscal_year === 2027) };
    const out = buildAthleticsBalances(rowsForScope(SAMPLE_ROWS, scope), meta, scope, null);
    assert.equal(out.priorThroughPeriod, 1);
    assert.equal(out.priorThroughDate, null);
    assert.equal(out.teams.find((t) => t.sportKey === "football")!.priorRevenue, 800);
  });

  it("hides unassigned from leadership and everything else from coaches", () => {
    const leader = { all: true as const, showUnassigned: false };
    const leaderOut = buildAthleticsBalances(rowsForScope(SAMPLE_ROWS, leader), SAMPLE_META, leader, null);
    assert.equal(leaderOut.unassigned, null);
    assert.equal(leaderOut.departmentWide?.expense, 75);
    assert.equal(rowsForScope(SAMPLE_ROWS, leader).some((r) => r.dept === "8214"), false);

    const coach = { all: false as const, sports: ["mens-baseball"] };
    const scoped = rowsForScope(SAMPLE_ROWS, coach);
    assert.deepEqual([...new Set(scoped.map((r) => r.dept))], ["6543"]);
    const coachOut = buildAthleticsBalances(scoped, SAMPLE_META, coach, "mens-baseball");
    assert.deepEqual(coachOut.teams.map((t) => t.sportKey), ["mens-baseball"]);
    assert.equal(coachOut.departmentWide, null);
    assert.equal(coachOut.unassigned, null);
    assert.equal(coachOut.sport?.expense[0].total, 250);
  });

  it("builds account lines by month for one sport", () => {
    const scope = { all: true as const, showUnassigned: true };
    const out = buildAthleticsBalances(rowsForScope(SAMPLE_ROWS, scope), SAMPLE_META, scope, "football");
    assert.deepEqual(out.sport?.periods, [
      { period: 1, end: "2026-07-31" },
      { period: 2, end: "2026-08-31" },
    ]);
    assert.deepEqual(out.sport?.revenue[0].byPeriod, [1000, 0]);
    assert.deepEqual(out.sport?.expense[0].byPeriod, [0, 400.5]);
    assert.deepEqual(out.sport?.netByPeriod, [1000, -400.5]);
  });
});
