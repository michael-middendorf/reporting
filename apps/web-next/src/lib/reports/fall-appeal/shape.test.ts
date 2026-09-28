import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDaysIso, formatMdDate, goalProgress, usd, type EmailPerformance } from "./shape";
import { APPEAL_CAMPAIGNS } from "../appeals/config";

describe("fall appeal shape", () => {
  it("returns null goal progress without a usable goal", () => {
    assert.equal(goalProgress(1000, undefined), null);
    assert.equal(goalProgress(1000, null), null);
    assert.equal(goalProgress(1000, 0), null);
    assert.equal(goalProgress(1000, Number.NaN), null);
  });

  it("computes goal progress", () => {
    assert.deepEqual(goalProgress(0, 70000), { goal: 70000, raised: 0, pctOfGoal: 0, remaining: 70000, exceeded: false });
    assert.deepEqual(goalProgress(18951, 70000), { goal: 70000, raised: 18951, pctOfGoal: 27.1, remaining: 51049, exceeded: false });
    assert.deepEqual(goalProgress(80000, 70000), { goal: 70000, raised: 80000, pctOfGoal: 114.3, remaining: 0, exceeded: true });
    assert.equal(goalProgress(-500, 70000)?.pctOfGoal, 0);
  });

  it("sets the gross goal only on the Fall 2026 appeal", () => {
    assert.equal(APPEAL_CAMPAIGNS.find((c) => c.slug === "fall-2026")?.goalGross, 70000);
    assert.equal(APPEAL_CAMPAIGNS.find((c) => c.slug === "spring-2026")?.goalGross, undefined);
  });

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
