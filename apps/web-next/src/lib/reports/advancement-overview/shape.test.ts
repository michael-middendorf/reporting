import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  barFill,
  count,
  formatEastern,
  isOverviewReady,
  pct,
  usd,
  type AdvancementOverviewSnapshot,
} from "./shape";

function snapshot(): AdvancementOverviewSnapshot {
  return {
    generated_at: "2026-08-31T15:14:38Z",
    source: "virtuous",
    currentFiscalYear: 2027,
    fiscalYearLabel: "FY 2026-27",
    asOf: "2026-08-31",
    received: {
      endowed: 27780.26,
      temporaryRestricted: 1046092.41,
      unrestricted: 501971.6,
      unassigned: 9682.63,
      total: 1585526.9,
      unassignedFunds: [{ fundId: "6278", description: "New Fund", amount: 9682.63 }],
      method: "designation-allocated",
    },
    conflictingFunds: [
      {
        fundId: "6404",
        description: "Library",
        statuses: ["Temporary Restricted", "Unrestricted"],
        used: "Temporary Restricted",
      },
    ],
    released: { fy26: null, other: null, total: 0, note: "Actuals Updated 7/1/2026" },
    pledges: {
      multiYear: 3,
      multiYearGoal: 30,
      realizedEstate: 3,
      realizedEstateGoal: 25,
      plannedEstate: 0,
    },
    ytd: {
      currentLabel: "FY2027",
      priorLabel: "FY2026",
      overall: { current: 1585526.9, prior: 552113.79, difference: 1033413.11, pct: 187 },
      mgoTeam: { current: 1433214.03, prior: 483653.33, difference: 949560.7, pct: 196 },
      activeDonors: { current: 809, prior: 1015, difference: -206, pct: -20.3 },
    },
    officers: [
      { name: "Totals", amount: 1433214.03, isTotal: true },
      { name: "Sanford", amount: 188088.17 },
    ],
    pipeline: {
      rows: [{ status: "Pending Installment  / Annual Gift (MGO)", amount: 143500, count: 8 }],
      totalAmount: 11397500,
      totalCount: 88,
    },
  };
}

describe("advancement overview shape", () => {
  it("formats money, counts, and percents like the Qlik sheet did", () => {
    assert.equal(usd(1585526.9), "$1,585,527");
    assert.equal(usd(501971.6), "$501,972");
    assert.equal(usd(-206), "-$206");
    assert.equal(usd(null), "--");
    assert.equal(count(1015), "1,015");
    assert.equal(count(null), "--");
    assert.equal(pct(187), "187%");
    assert.equal(pct(196), "196%");
    assert.equal(pct(-20.3), "-20.3%");
    assert.equal(pct(null), "--");
  });

  it("formats snapshot times in Eastern", () => {
    assert.equal(formatEastern("2026-08-31T15:57:00Z"), "Aug 31, 2026, 11:57 AM ET");
    assert.equal(formatEastern(null), "");
  });

  it("clamps bar fill to 0-100", () => {
    assert.equal(barFill(10), 10);
    assert.equal(barFill(169), 100);
    assert.equal(barFill(-4), 0);
    assert.equal(barFill(null), 0);
  });

  it("accepts only Virtuous snapshots, rejects Qlik and the old shape", () => {
    assert.equal(isOverviewReady(snapshot()), true);
    assert.equal(isOverviewReady({ ...snapshot(), source: "qlik" }), false);
    assert.equal(isOverviewReady({ ...snapshot(), source: "other" }), false);
    assert.equal(isOverviewReady({ source: "virtuous" } as AdvancementOverviewSnapshot), false);
    assert.equal(isOverviewReady({ source: "qlik" } as AdvancementOverviewSnapshot), false);
    assert.equal(isOverviewReady(null), false);
  });

  it("class buckets add up to the total", () => {
    const r = snapshot().received;
    const sum =
      (r.endowed ?? 0) + (r.temporaryRestricted ?? 0) + (r.unrestricted ?? 0) + (r.unassigned ?? 0);
    assert.equal(Math.round(sum * 100), Math.round((r.total ?? 0) * 100));
    assert.equal(r.unassignedFunds?.[0]?.fundId, "6278");
  });

  it("keeps Sanford, pipeline totals, and the installment status", () => {
    const data = snapshot();
    assert.equal(data.officers.some((row) => row.name === "Sanford"), true);
    assert.equal(data.pipeline.totalCount, 88);
    assert.equal(
      data.pipeline.rows[0]?.status.includes("Pending Installment"),
      true,
    );
  });
});
