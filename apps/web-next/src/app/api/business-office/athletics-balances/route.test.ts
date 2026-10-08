import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionToken } from "../../../../lib/auth";
import type { FinanceMeta, FinanceRow } from "../../../../lib/reports/business-office/athletics-finance";
import { GET, athleticsFinanceData } from "./route";

const SECRET = "athletics-balances-route-test-secret";
const BO = "steve.logan@avemaria.edu";
const LEADER = "eric.vanheusen@avemaria.edu";
const COACH = "robert.cooper@avemaria.edu"; // hardcoded head coach: mens-baseball
const OTHER = "annie.esposito@avemaria.edu";

const META: FinanceMeta = {
  as_of: "2026-10-08T08:15:00+00:00",
  as_of_date: "2026-10-08",
  current_fy: 2027,
  prior_fy: 2026,
  current_period: 3,
  periods: [
    { fiscal_year: 2027, period: 1, start: "2026-07-01", end: "2026-07-31" },
    { fiscal_year: 2027, period: 2, start: "2026-08-01", end: "2026-08-31" },
    { fiscal_year: 2027, period: 3, start: "2026-09-01", end: "2026-09-30" },
  ],
};

function row(dept: string, category: "revenue" | "expense", amount: string): FinanceRow {
  return {
    group: "team",
    sport_key: null,
    dept,
    dept_desc: `Dept ${dept}`,
    account: `900-${dept}-${category === "revenue" ? "4100" : "6100"}-00-00`,
    account_desc: "Account",
    category,
    fiscal_year: 2027,
    period: 1,
    period_end: "2026-07-31",
    debit: "0.00",
    credit: "0.00",
    amount,
  };
}

const ROWS: FinanceRow[] = [
  row("6552", "revenue", "1000.00"), // football
  row("6543", "expense", "250.00"), // mens-baseball
  row("6117", "expense", "75.00"), // department-wide
  row("8214", "revenue", "60.00"), // unassigned
];

function request(email: string | null, sport: string | null) {
  process.env.AUTH_SECRET = SECRET;
  const url = new URL("https://reporting.avemaria.edu/api/business-office/athletics-balances");
  if (sport !== null) url.searchParams.set("sport", sport);
  const headers = new Headers();
  if (email) headers.set("Authorization", `Bearer ${createSessionToken(email, SECRET, 1)}`);
  return new Request(url, { headers });
}

describe("GET /api/business-office/athletics-balances", () => {
  const prevSecret = process.env.AUTH_SECRET;
  const originalRead = athleticsFinanceData.read;

  async function withData<T>(fn: () => Promise<T>): Promise<T> {
    athleticsFinanceData.read = async () => ({ rows: ROWS, meta: META });
    try {
      return await fn();
    } finally {
      athleticsFinanceData.read = originalRead;
      if (prevSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prevSecret;
    }
  }

  it("returns 401 without a session and 403 for an unlisted user", async () => {
    await withData(async () => {
      assert.equal((await GET(request(null, null))).status, 401);
      assert.equal((await GET(request(OTHER, null))).status, 403);
      assert.equal((await GET(request(OTHER, "football"))).status, 403);
    });
  });

  it("gives Business Office every team, department-wide, and unassigned", async () => {
    await withData(async () => {
      const res = await GET(request(BO, null));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
      const body = await res.json();
      assert.equal(body.teams.length, 17);
      assert.equal(body.teams.find((t: { sportKey: string }) => t.sportKey === "football").revenue, 1000);
      assert.equal(body.departmentWide.expense, 75);
      assert.equal(body.unassigned.revenue, 60);
      assert.equal(body.sport, null);
    });
  });

  it("gives leadership every team without unassigned", async () => {
    await withData(async () => {
      const res = await GET(request(LEADER, null));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.teams.length, 17);
      assert.equal(body.departmentWide.expense, 75);
      assert.equal(body.unassigned, null);
      assert.equal(JSON.stringify(body).includes("8214"), false);
      const sport = await GET(request(LEADER, "football"));
      assert.equal(sport.status, 200);
      assert.equal((await sport.json()).sport.sportKey, "football");
    });
  });

  it("gives a coach only their own sport and 403 for another", async () => {
    await withData(async () => {
      const own = await GET(request(COACH, "mens-baseball"));
      assert.equal(own.status, 200);
      const body = await own.json();
      assert.deepEqual(
        body.teams.map((t: { sportKey: string }) => t.sportKey),
        ["mens-baseball"],
      );
      assert.equal(body.departmentWide, null);
      assert.equal(body.unassigned, null);
      assert.equal(body.sport.expense[0].total, 250);
      const text = JSON.stringify(body);
      for (const dept of ["6552", "6117", "8214"]) assert.equal(text.includes(dept), false, dept);

      const list = await GET(request(COACH, null));
      assert.equal(list.status, 200);
      const listBody = await list.json();
      assert.deepEqual(
        listBody.teams.map((t: { sportKey: string }) => t.sportKey),
        ["mens-baseball"],
      );

      assert.equal((await GET(request(COACH, "football"))).status, 403);
      assert.equal((await GET(request(COACH, "not-a-sport"))).status, 400);
    });
  });

  it("returns 503 when the extract is not published yet", async () => {
    await withData(async () => {
      athleticsFinanceData.read = async () => null;
      const res = await GET(request(BO, null));
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(typeof body.error, "string");
      assert.equal("teams" in body, false);
    });
  });
});
