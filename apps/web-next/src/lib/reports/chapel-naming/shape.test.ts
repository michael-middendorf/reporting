import { describe, expect, it } from "vitest";
import { fundingStatus, pct, usd, type ChapelNamingItem } from "./shape";

function item(partial: Partial<ChapelNamingItem>): ChapelNamingItem {
  return {
    item: "Altar",
    chapelObject: "ALTAR",
    quantity: 1,
    itemAmount: 125000,
    fundingRequest: 125000,
    type: null,
    setNote: null,
    fromCatalog: true,
    amountReceived: 0,
    pctReceived: 0,
    giftCount: 0,
    donorCount: 0,
    gifts: [],
    ...partial,
  };
}

describe("chapel naming shape", () => {
  it("formats money and percents", () => {
    expect(usd(125000)).toBe("$125,000");
    expect(usd(null)).toBe("—");
    expect(pct(33.3)).toBe("33.3%");
  });

  it("classifies funding status", () => {
    expect(fundingStatus(item({ amountReceived: 0 }))).toBe("unfunded");
    expect(fundingStatus(item({ amountReceived: 50000, pctReceived: 40 }))).toBe("partial");
    expect(fundingStatus(item({ amountReceived: 125000, pctReceived: 100 }))).toBe("funded");
  });
});
