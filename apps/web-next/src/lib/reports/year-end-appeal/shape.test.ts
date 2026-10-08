import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDaysIso,
  emptySnapshot,
  formatMdDate,
  lengthPair,
  lengthScopes,
  normalizeSnapshot,
  pctOrNa,
  usd,
  type LengthBucket,
} from "./shape";

const bucket = (scope: string, length: string, revenue: number): LengthBucket => ({
  scope, length, revenue, gifts: 1, donors: 1, avgGift: revenue, mailed: null, responseRate: null,
});

describe("year-end shape helpers", () => {
  it("formats money, rates and dates without placeholders that look like data", () => {
    assert.equal(usd(1234.6), "$1,235");
    assert.equal(usd(-5), "-$5");
    assert.equal(usd(null), "n/a");
    assert.equal(pctOrNa(1.234), "1.23%");
    assert.equal(pctOrNa(null), "n/a");
    assert.equal(formatMdDate(null), "n/a");
    assert.equal(addDaysIso("2026-11-13", 18), "2026-12-01");
  });

  it("emptySnapshot has every section the page reads", () => {
    const s = emptySnapshot();
    assert.equal(s.empty, true);
    for (const k of ["bySegment", "byLength", "byAsset", "byCode", "timeline", "giftBreakdown", "overlays"] as const) {
      assert.deepEqual(s[k], []);
    }
    assert.deepEqual(s.unmatched, { revenue: 0, gifts: 0, codes: [] });
    assert.equal(s.campaignStart, "2026-11-13");
  });

  it("normalizeSnapshot fills missing sections", () => {
    const n = normalizeSnapshot({ campaign: "X", empty: false } as never);
    assert.equal(n.campaign, "X");
    assert.deepEqual(n.byCode, []);
    assert.equal(n.unmatched.gifts, 0);
    assert.equal(n.mailedAvailable, false);
  });

  it("pairs 2P and 4P by scope and orders scopes", () => {
    const rows = [bucket("A", "2P", 1), bucket("total", "4P", 9), bucket("total", "2P", 5), bucket("A", "4P", 2)];
    assert.deepEqual(lengthScopes(rows), ["total", "A"]);
    const p = lengthPair(rows, "total");
    assert.equal(p.twoPage?.revenue, 5);
    assert.equal(p.fourPage?.revenue, 9);
    assert.equal(lengthPair(rows, "LP12").twoPage, null);
  });
});
