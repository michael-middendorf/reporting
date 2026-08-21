import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fundingStatus, pct, usd, type StainedGlassWindow } from "./shape";

function window(partial: Partial<StainedGlassWindow>): StainedGlassWindow {
  return {
    id: "x",
    group: "nave",
    groupLabel: "Nave windows",
    item: "St. Joseph",
    chapelObject: "NAVE WINDOW - ST. JOSEPH",
    quantity: 1,
    itemAmount: 35000,
    fundingRequest: 35000,
    fromInventory: true,
    amountReceived: 0,
    remaining: 35000,
    pctReceived: 0,
    giftCount: 0,
    donorCount: 0,
    gifts: [],
    ...partial,
  };
}

describe("stained glass shape", () => {
  it("formats money and percents", () => {
    assert.equal(usd(1335000), "$1,335,000");
    assert.equal(usd(0), "$0");
    assert.equal(usd(null), "—");
    assert.equal(pct(92.4), "92.4%");
    assert.equal(pct(null), "—");
  });

  it("classifies funding status", () => {
    assert.equal(fundingStatus(window({ amountReceived: 0 })), "unfunded");
    assert.equal(fundingStatus(window({ amountReceived: 10000, remaining: 25000, pctReceived: 28.6 })), "partial");
    assert.equal(fundingStatus(window({ amountReceived: 35000, remaining: 0, pctReceived: 100 })), "funded");
    assert.equal(
      fundingStatus(window({ fundingRequest: null, amountReceived: 10000, remaining: null, pctReceived: null })),
      "partial",
    );
  });
});
