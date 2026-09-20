import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDaysIso, formatMdDate, usd, type EmailPerformance } from "./shape";

describe("fall appeal shape", () => {
  it("formats money", () => {
    assert.equal(usd(67104), "$67,104");
    assert.equal(usd(0), "$0");
    assert.equal(usd(null), "—");
    assert.equal(usd(-100), "-$100");
  });

  it("formats campaign dates", () => {
    assert.equal(formatMdDate("2026-08-16"), "Aug 16, 2026");
    assert.equal(formatMdDate("2027-02-28"), "Feb 28, 2027");
    assert.equal(formatMdDate(null), "—");
  });

  it("offsets ISO dates for YoY hover", () => {
    assert.equal(addDaysIso("2026-08-16", 8), "2026-08-24");
    assert.equal(addDaysIso("2025-11-01", 8), "2025-11-09");
    assert.equal(addDaysIso(null, 3), null);
  });

  it("permits unavailable email engagement rather than treating it as zero", () => {
    const email: EmailPerformance = {
      status: "unavailable",
      generatedAt: null,
      sourceSyncedAt: null,
      segments: [],
    };
    assert.equal(email.status, "unavailable");
    assert.equal(email.segments.length, 0);
  });
});
