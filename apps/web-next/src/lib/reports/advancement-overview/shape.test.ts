import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  barFill,
  gaugeCopy,
  hasFiscalYears,
  pct,
  pickYear,
  usd,
  type AdvancementOverviewSnapshot,
  type AdvancementYearSnapshot,
} from "./shape";

describe("advancement overview shape", () => {
  it("formats money and percents", () => {
    assert.equal(usd(20180242), "$20,180,242");
    assert.equal(usd(-13297404), "-$13,297,404");
    assert.equal(usd(null), "—");
    assert.equal(pct(126, 0), "126%");
    assert.equal(pct(-46.8), "-46.8%");
  });

  it("clamps bar fill to 0–100", () => {
    assert.equal(barFill(36), 36);
    assert.equal(barFill(169), 100);
    assert.equal(barFill(-4), 0);
    assert.equal(barFill(null), 0);
  });
});

function year(fy: number, amount: number): AdvancementYearSnapshot {
  return {
    fiscalYear: fy,
    fiscalYearLabel: fy === 2027 ? "FY 2026-27" : "FY 2025-26",
    gaugeLabel: fy === 2027 ? "of 26/27 FY" : "of 25/26 FY",
    asOf: fy === 2027 ? "2026-08-21" : "2026-06-30",
    kpis: {
      totalFundraising: { label: "Total Fundraising", amount, goal: 16_000_000, pctOfGoal: 1 },
      unrestricted: { label: "Unrestricted Gifts", amount: 0, goal: 10_000_000, pctOfGoal: 0 },
      multiYearPledges: { label: "New Multi-Year Pledges", count: 0, goal: 30 },
      estateGifts: { label: "Estate Gifts", count: 0, goal: 25 },
    },
    ytd: {
      overall: { current: amount, prior: 0, difference: amount, pct: null },
      mgoTeam: { current: 0, prior: 0, difference: 0, pct: null },
      currentYear: fy - 1,
      priorYear: fy - 2,
    },
    officers: [],
    pipeline: { rows: [], totalAmount: 0, totalCount: 0 },
  };
}

function snapshot(): AdvancementOverviewSnapshot {
  const current = year(2027, 1500);
  return {
    generated_at: "2026-08-21T00:00:00Z",
    source: "virtuous",
    currentFiscalYear: 2027,
    fiscalYearLabel: current.fiscalYearLabel,
    gaugeLabel: current.gaugeLabel,
    asOf: current.asOf,
    kpis: current.kpis,
    ytd: current.ytd,
    officers: current.officers,
    pipeline: current.pipeline,
    fiscalYears: [current, year(2026, 5000)],
  };
}

describe("advancement overview year pick", () => {
  it("defaults to the current fiscal year", () => {
    const picked = pickYear(snapshot(), null);
    assert.equal(picked?.fiscalYear, 2027);
    assert.equal(picked?.kpis.totalFundraising.amount, 1500);
  });

  it("selects last year when requested", () => {
    const picked = pickYear(snapshot(), 2026);
    assert.equal(picked?.fiscalYear, 2026);
    assert.equal(picked?.kpis.totalFundraising.amount, 5000);
    assert.equal(picked?.asOf, "2026-06-30");
  });

  it("ignores unknown fy values", () => {
    const picked = pickYear(snapshot(), 2010);
    assert.equal(picked?.fiscalYear, 2027);
  });

  it("falls back to top-level KPIs without fiscalYears", () => {
    const data = snapshot();
    delete data.fiscalYears;
    assert.equal(hasFiscalYears(data), false);
    const picked = pickYear(data, 2026);
    assert.equal(picked?.kpis.totalFundraising.amount, 1500);
  });

  it("builds gauge copy from the FY label", () => {
    assert.equal(gaugeCopy({ fiscalYearLabel: "FY 2026-27" }), "of 26/27 FY");
    assert.equal(gaugeCopy({ fiscalYearLabel: "FY 2025-26", gaugeLabel: "of 25/26 FY" }), "of 25/26 FY");
  });
});
