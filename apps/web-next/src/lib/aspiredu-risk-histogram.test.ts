import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { riskHistogramBuckets, riskHistogramPercent } from "./aspiredu-risk-histogram";

const EMPTY_BINS = [
  { label: "0", min: 0, max: 0, count: 0 },
  { label: "1–9", min: 1, max: 9, count: 0 },
  { label: "10–19", min: 10, max: 19, count: 0 },
  { label: "20–29", min: 20, max: 29, count: 0 },
  { label: "30–39", min: 30, max: 39, count: 0 },
  { label: "40–49", min: 40, max: 49, count: 0 },
  { label: "50–59", min: 50, max: 59, count: 0 },
  { label: "60–69", min: 60, max: 69, count: 0 },
  { label: "70–79", min: 70, max: 79, count: 0 },
  { label: "80–89", min: 80, max: 89, count: 0 },
  { label: "90–99", min: 90, max: 99, count: 0 },
  { label: "100", min: 100, max: 100, count: 0 },
];

describe("riskHistogramBuckets", () => {
  it("bins 0, 1–9, a decade, and 100, leaving other decades at 0", () => {
    const histogram = riskHistogramBuckets({ "0": 10, "2": 3, "15": 1, "100": 2 });
    assert.deepEqual(histogram.bins, [
      { label: "0", min: 0, max: 0, count: 10 },
      { label: "1–9", min: 1, max: 9, count: 3 },
      { label: "10–19", min: 10, max: 19, count: 1 },
      { label: "20–29", min: 20, max: 29, count: 0 },
      { label: "30–39", min: 30, max: 39, count: 0 },
      { label: "40–49", min: 40, max: 49, count: 0 },
      { label: "50–59", min: 50, max: 59, count: 0 },
      { label: "60–69", min: 60, max: 69, count: 0 },
      { label: "70–79", min: 70, max: 79, count: 0 },
      { label: "80–89", min: 80, max: 89, count: 0 },
      { label: "90–99", min: 90, max: 99, count: 0 },
      { label: "100", min: 100, max: 100, count: 2 },
    ]);
    assert.equal(histogram.atZero, 10);
    assert.equal(histogram.aboveZero, 6);
    assert.equal(histogram.total, 16);
  });

  it("returns all-zero bins and totals for empty or null input", () => {
    assert.deepEqual(riskHistogramBuckets({}), {
      bins: EMPTY_BINS,
      atZero: 0,
      aboveZero: 0,
      total: 0,
    });
    assert.deepEqual(riskHistogramBuckets(undefined), {
      bins: EMPTY_BINS,
      atZero: 0,
      aboveZero: 0,
      total: 0,
    });
    assert.deepEqual(riskHistogramBuckets(null), {
      bins: EMPTY_BINS,
      atZero: 0,
      aboveZero: 0,
      total: 0,
    });
  });

  it("sorts string keys numerically, not lexicographically", () => {
    const histogram = riskHistogramBuckets({ "10": 1, "2": 4 });
    assert.equal(histogram.bins.find((bin) => bin.label === "1–9")?.count, 4);
    assert.equal(histogram.bins.find((bin) => bin.label === "10–19")?.count, 1);
    assert.equal(histogram.total, 5);
  });

  it("ignores scores outside 0–100", () => {
    const histogram = riskHistogramBuckets({ "101": 9, "-1": 4, "0": 2 });
    assert.equal(histogram.atZero, 2);
    assert.equal(histogram.aboveZero, 0);
    assert.equal(histogram.total, 2);
    assert.equal(histogram.bins.every((bin) => bin.max <= 100), true);
  });
});

describe("riskHistogramPercent", () => {
  it("rounds part of total (10/15 = 67%)", () => {
    assert.equal(riskHistogramPercent(10, 15), 67);
    assert.equal(riskHistogramPercent(5, 15), 33);
  });

  it("returns 0 when total is 0", () => {
    assert.equal(riskHistogramPercent(10, 0), 0);
    assert.equal(riskHistogramPercent(0, 0), 0);
  });
});
