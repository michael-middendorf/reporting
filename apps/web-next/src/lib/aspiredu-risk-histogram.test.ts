import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { riskHistogramBuckets, riskHistogramNonZeroSummary } from "./aspiredu-risk-histogram";

describe("riskHistogramBuckets", () => {
  it("fills missing integers from 0 through max", () => {
    assert.deepEqual(riskHistogramBuckets({ "0": 10, "2": 3 }), [
      { score: 0, count: 10 },
      { score: 1, count: 0 },
      { score: 2, count: 3 },
    ]);
  });

  it("returns an empty array for empty input", () => {
    assert.deepEqual(riskHistogramBuckets({}), []);
    assert.deepEqual(riskHistogramBuckets(undefined), []);
    assert.deepEqual(riskHistogramBuckets(null), []);
  });

  it("sorts string keys numerically and fills zeros through the max", () => {
    assert.deepEqual(riskHistogramBuckets({ "10": 1, "2": 4 }), [
      { score: 0, count: 0 },
      { score: 1, count: 0 },
      { score: 2, count: 4 },
      { score: 3, count: 0 },
      { score: 4, count: 0 },
      { score: 5, count: 0 },
      { score: 6, count: 0 },
      { score: 7, count: 0 },
      { score: 8, count: 0 },
      { score: 9, count: 0 },
      { score: 10, count: 1 },
    ]);
  });
});

describe("riskHistogramNonZeroSummary", () => {
  it("omits zero buckets and formats counts with grouping", () => {
    assert.equal(
      riskHistogramNonZeroSummary([
        { score: 0, count: 4264 },
        { score: 1, count: 373 },
        { score: 2, count: 66 },
        { score: 3, count: 0 },
        { score: 4, count: 12 },
      ]),
      "0: 4,264 · 1: 373 · 2: 66 · 4: 12",
    );
  });

  it("returns an empty string when every bucket is zero", () => {
    assert.equal(
      riskHistogramNonZeroSummary([
        { score: 0, count: 0 },
        { score: 1, count: 0 },
      ]),
      "",
    );
  });
});
