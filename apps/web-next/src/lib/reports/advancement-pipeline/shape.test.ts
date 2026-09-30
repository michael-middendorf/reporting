import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_OFFICERS,
  UNASSIGNED_OFFICER,
  filterByOfficer,
  isPastDue,
  isPipelineReady,
  officerOptions,
  shortDate,
  sortByAmount,
  statusLabel,
  sumAmount,
  type AdvancementPipelineSnapshot,
  type PipelineAsk,
} from "./shape";

function row(askId: number, askAmount: number, assignedUser: string | null = "Pat Officer"): PipelineAsk {
  return {
    askId,
    askDate: "2026-08-01",
    donor: `Sample Donor ${askId}`,
    contactId: 1000 + askId,
    status: "Pending (MGO)",
    askAmount,
    expectedFulfillmentDate: "2026-10-01",
    assignedUser,
    reason: null,
    city: null,
    state: null,
    fund: null,
    fundClass: null,
  };
}

const SAMPLE_PIPELINE: AdvancementPipelineSnapshot = {
  generated_at: "2026-09-30T12:00:00Z",
  source: "virtuous",
  asOf: "2026-09-30",
  currentFiscalYear: 2027,
  fiscalYearLabel: "FY 2026-27",
  window: { start: "2026-07-01", end: "2027-06-30" },
  buckets: [
    { key: "to_be_asked", label: "To Be Asked", statuses: [], totalAmount: 100, count: 1, rows: [row(1, 100)] },
    { key: "asked", label: "Asked: Waiting for Response", statuses: [], totalAmount: 0, count: 0, rows: [] },
    {
      key: "accepted",
      label: "Accepted: Waiting for Check",
      statuses: [],
      totalAmount: 50,
      count: 1,
      rows: [row(2, 50, null)],
    },
  ],
};

describe("advancement pipeline shape", () => {
  it("accepts only Virtuous snapshots with buckets", () => {
    assert.equal(isPipelineReady(SAMPLE_PIPELINE), true);
    assert.equal(isPipelineReady(null), false);
    assert.equal(isPipelineReady({ ...SAMPLE_PIPELINE, source: "qlik" }), false);
    assert.equal(isPipelineReady({ ...SAMPLE_PIPELINE, buckets: [] }), false);
  });

  it("sorts by amount both ways with a stable tie break", () => {
    const rows = [row(3, 500), row(1, 500), row(2, 9000), row(4, 10)];
    assert.deepEqual(sortByAmount(rows, "desc").map((r) => r.askId), [2, 1, 3, 4]);
    assert.deepEqual(sortByAmount(rows, "asc").map((r) => r.askId), [4, 1, 3, 2]);
    assert.deepEqual(rows.map((r) => r.askId), [3, 1, 2, 4]);
  });

  it("filters by officer and labels blanks Unassigned", () => {
    const rows = [row(1, 1, "Pat Officer"), row(2, 2, null), row(3, 3, "  "), row(4, 4, "Alex Officer")];
    assert.deepEqual(filterByOfficer(rows, ALL_OFFICERS).length, 4);
    assert.deepEqual(filterByOfficer(rows, UNASSIGNED_OFFICER).map((r) => r.askId), [2, 3]);
    assert.deepEqual(filterByOfficer(rows, "Pat Officer").map((r) => r.askId), [1]);
    assert.deepEqual(officerOptions(SAMPLE_PIPELINE.buckets), ["Pat Officer", UNASSIGNED_OFFICER]);
    assert.equal(sumAmount(rows), 10);
  });

  it("formats dates, past due, and status labels", () => {
    assert.equal(shortDate("2026-09-01"), "9/1/2026");
    assert.equal(shortDate(null), "");
    assert.equal(isPastDue({ expectedFulfillmentDate: "2026-09-01" }, "2026-09-30"), true);
    assert.equal(isPastDue({ expectedFulfillmentDate: "2026-09-30" }, "2026-09-30"), false);
    assert.equal(statusLabel("Pending Installment / Annual Gift (MGO)"), "Pending Installment / Annual Gift");
  });
});
