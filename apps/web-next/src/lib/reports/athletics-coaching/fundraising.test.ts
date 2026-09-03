import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORBIDDEN_PROJECT_CODES,
  sportFundraisingFromCache,
  type FundraisingCache,
  type FundraisingSportRow,
} from "./fundraising";

function row(partial: Partial<FundraisingSportRow> & Pick<FundraisingSportRow, "key">): FundraisingSportRow {
  return {
    projectCode: "6552FB",
    mapped: true,
    fytdAmount: 80,
    fytdGiftCount: 2,
    allTimeAmount: 500,
    allTimeGiftCount: 9,
    asOf: "2026-09-03T12:00:00Z",
    ...partial,
  };
}

function cache(sports: Record<string, FundraisingSportRow>): FundraisingCache {
  return {
    generated_at: "2026-09-03T12:00:00Z",
    source: "virtuous",
    fiscalYear: 2027,
    fiscalYearLabel: "FY 2026-27",
    fyStart: "2026-07-01",
    fyEnd: "2027-06-30",
    sports,
  };
}

describe("athletics coaching fundraising cache shape", () => {
  it("returns mapped football totals without gift rows", () => {
    const payload = sportFundraisingFromCache(
      cache({ football: row({ key: "football" }) }),
      "football",
    );
    assert.equal(payload.sport, "football");
    assert.equal(payload.sportLabel, "Football");
    assert.equal(payload.fiscalYear, 2027);
    assert.equal(payload.fiscalYearLabel, "FY 2026-27");
    assert.equal(payload.mapped, true);
    assert.equal(payload.fytdAmount, 80);
    assert.equal(payload.fytdGiftCount, 2);
    assert.equal(payload.allTimeAmount, 500);
    assert.equal(payload.allTimeGiftCount, 9);
    assert.equal(payload.asOf, "2026-09-03T12:00:00Z");
    assert.equal("gifts" in payload, false);
  });

  it("treats a null project code as unmapped not zeros", () => {
    const payload = sportFundraisingFromCache(
      cache({
        "womens-golf": row({
          key: "womens-golf",
          projectCode: null,
          mapped: false,
          fytdAmount: 0,
          fytdGiftCount: 0,
          allTimeAmount: 0,
          allTimeGiftCount: 0,
          asOf: null,
          reason: "unmapped",
        }),
      }),
      "womens-golf",
    );
    assert.equal(payload.mapped, false);
    assert.equal(payload.reason, "unmapped");
    assert.equal(payload.fytdAmount, null);
    assert.equal(payload.fytdGiftCount, null);
    assert.equal(payload.allTimeAmount, null);
    assert.equal(payload.allTimeGiftCount, null);
    assert.equal(payload.asOf, null);
    assert.equal(payload.projectCode, null);
  });

  it("never surfaces 6117AthGEN or 6644 even if they appear in cache", () => {
    const payload = sportFundraisingFromCache(
      cache({
        football: row({ key: "football", projectCode: "6117AthGEN", fytdAmount: 1 }),
      }),
      "football",
    );
    assert.equal(payload.mapped, false);
    assert.equal(payload.projectCode, null);
    assert.equal(payload.fytdAmount, null);
    assert.equal(FORBIDDEN_PROJECT_CODES.has("6117AthGEN"), true);
    assert.equal(FORBIDDEN_PROJECT_CODES.has("6644"), true);

    const booster = sportFundraisingFromCache(
      cache({
        football: row({ key: "football", projectCode: "6644", fytdAmount: 99 }),
      }),
      "football",
    );
    assert.equal(booster.projectCode, null);
    assert.equal(booster.fytdAmount, null);
  });

  it("returns unavailable without inventing zeros", () => {
    const payload = sportFundraisingFromCache(
      cache({
        football: row({
          key: "football",
          fytdAmount: 0,
          fytdGiftCount: 0,
          allTimeAmount: 0,
          allTimeGiftCount: 0,
          reason: "unavailable",
        }),
      }),
      "football",
    );
    assert.equal(payload.reason, "unavailable");
    assert.equal(payload.fytdAmount, null);
    assert.equal(payload.allTimeAmount, null);
  });
});
