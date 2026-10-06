import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchingMonth, monthBounds, monthLabel, monthOptions } from "./month-range.js";
import { EVENT_POINTS_PER_HOUR, MA_ROSTER, TRACKED_EVENT_TYPES } from "./config.js";
import { sortTrackedEventsByMa, summarizeTrackedEventTypes } from "./tracked-events";

describe("month range", () => {
  it("uses the first and last calendar day of the month", () => {
    assert.deepEqual(monthBounds("2026-10"), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
    assert.equal(monthLabel("2026-10"), "October 2026");
  });

  it("lists months from eval start through as-of, latest first", () => {
    const opts = monthOptions("2026-06-01", "2026-10-06");
    assert.equal(opts[0].key, "2026-10");
    assert.equal(opts[opts.length - 1].key, "2026-06");
    assert.equal(opts.length, 5);
  });

  it("matches only a full calendar month", () => {
    assert.equal(matchingMonth("2026-10-01", "2026-10-31"), "2026-10");
    assert.equal(matchingMonth("2026-10-01", "2026-10-15"), "");
    assert.equal(matchingMonth("2026-09-12", "2026-09-18"), "");
  });
});

describe("tracked event types", () => {
  it("totals hours and points by type", () => {
    const rows = summarizeTrackedEventTypes(
      [
        { eventType: "amu", hours: 2 },
        { eventType: "amu", hours: 1.5 },
        { eventType: "tours", hours: 4 },
      ],
      TRACKED_EVENT_TYPES,
      EVENT_POINTS_PER_HOUR,
    );
    assert.equal(rows[0].id, "tours");
    assert.equal(rows[0].count, 1);
    assert.equal(rows[0].hours, 4);
    assert.equal(rows[0].points, 100);
    assert.equal(rows[1].id, "amu");
    assert.equal(rows[1].count, 2);
    assert.equal(rows[1].hours, 3.5);
    assert.equal(rows[1].points, 87.5);
  });

  it("sorts events by roster MA then newest day", () => {
    const sorted = sortTrackedEventsByMa(
      [
        { owner: "Natalia Abrams", day: "2026-10-02", name: "B" },
        { owner: "Alanna McCann", day: "2026-09-01", name: "A" },
        { owner: "Alanna McCann", day: "2026-10-05", name: "C" },
      ],
      MA_ROSTER,
    );
    assert.equal(sorted[0].owner, "Alanna McCann");
    assert.equal(sorted[0].day, "2026-10-05");
    assert.equal(sorted[1].owner, "Alanna McCann");
    assert.equal(sorted[2].owner, "Natalia Abrams");
  });
});
