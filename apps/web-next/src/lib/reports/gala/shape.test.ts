import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GALA_FIXTURE } from "./fixture";
import {
  buildKpis,
  buildTables,
  easternDate,
  expenseLines,
  formatCompact,
  formatDelta,
  formatMoney,
  niceMax,
  previousDay,
  trendPoints,
  type GalaHistoryRow,
  type GalaPayload,
} from "./shape";

const clone = (): GalaPayload => structuredClone(GALA_FIXTURE);

function row(date: string, gac: number, ga: number, exp: number, nac: number, na: number): GalaHistoryRow {
  return {
    date,
    gross: { actual: ga, actualPlusCommitment: gac },
    expenses: { committed: exp },
    netAfterExpenses: { actual: na, actualPlusCommitment: nac },
  };
}

describe("formatMoney", () => {
  it("drops cents on whole dollars and keeps them otherwise", () => {
    assert.equal(formatMoney(1233933.91), "$1,233,933.91");
    assert.equal(formatMoney(72000), "$72,000");
    assert.equal(formatMoney(0), "$0");
    assert.equal(formatMoney(-300), "-$300");
    assert.equal(formatMoney(500000.0), "$500,000");
    assert.equal(formatMoney(null), "");
  });
  it("formats deltas", () => {
    assert.equal(formatDelta(1200), "+$1,200");
    assert.equal(formatDelta(-300.5), "-$300.50");
    assert.equal(formatDelta(0), "No change");
    assert.equal(formatDelta(null), "");
  });
});

describe("buildTables", () => {
  it("Table A uses actual + commitment with the email's row order", () => {
    const { combined } = buildTables(clone());
    assert.equal(combined.title, "Actual + Commitment");
    assert.deepEqual(
      combined.rows.map((r) => r.label),
      ["Total Sponsorship", "Total Underwriting", "Total Tickets", "Match", "Paddle Raise", "Other Gala Gifts", "TOTAL GROSS", "EXPENSES", "TOTAL NET"],
    );
    assert.deepEqual(
      combined.rows.map((r) => r.amount),
      [177000, 247000, 141775, 500000, 158000, 10158.91, 1233933.91, 0, 1233933.91],
    );
  });

  it("Table B uses actual values", () => {
    const { actual } = buildTables(clone());
    assert.equal(actual.title, "Actual (received)");
    assert.deepEqual(
      actual.rows.map((r) => r.amount),
      [72000, 22000, 131775, 247769.67, 25000, 10158.91, 508703.58, 0, 508703.58],
    );
  });

  it("subtracts committed expenses in net, as the feed reports it", () => {
    const p = clone();
    p.expenses = { committed: 1000, paid: 400, lineCount: 1, byCategory: [] };
    p.netAfterExpenses = { actual: 507703.58, actualPlusCommitment: 1232933.91 };
    const { combined, actual } = buildTables(p);
    assert.equal(combined.rows.at(-2)?.amount, 1000);
    assert.equal(combined.rows.at(-1)?.amount, 1232933.91);
    assert.equal(actual.rows.at(-1)?.amount, 507703.58);
  });

  it("has no deltas without history", () => {
    const { combined, previousDate } = buildTables(clone(), []);
    assert.equal(previousDate, null);
    assert.ok(combined.rows.every((r) => r.delta === null));
  });

  it("computes total-row deltas against the previous day only", () => {
    const history = [
      row("2026-10-11", 1000000, 400000, 0, 1000000, 400000),
      row("2026-10-12", 1200000, 500000, 0, 1200000, 500000),
      row("2026-10-13", 1233933.91, 508703.58, 0, 1233933.91, 508703.58),
    ];
    const { combined, actual, previousDate } = buildTables(clone(), history);
    assert.equal(previousDate, "2026-10-12");
    const byKey = Object.fromEntries(combined.rows.map((r) => [r.key, r.delta]));
    assert.equal(byKey.gross, 33933.91);
    assert.equal(byKey.net, 33933.91);
    assert.equal(byKey.expenses, 0);
    assert.equal(byKey.sponsorship, null);
    assert.equal(actual.rows.find((r) => r.key === "gross")?.delta, 8703.58);
  });
});

describe("previousDay", () => {
  it("uses the Eastern day of asOf and ignores same-day and future rows", () => {
    // 2026-10-14T02:00Z is 10pm Oct 13 Eastern.
    assert.equal(easternDate("2026-10-14T02:00:00Z"), "2026-10-13");
    const history = [row("2026-10-12", 1, 1, 0, 1, 1), row("2026-10-13", 2, 2, 0, 2, 2), row("2026-10-15", 3, 3, 0, 3, 3)];
    assert.equal(previousDay(history, "2026-10-14T02:00:00Z")?.date, "2026-10-12");
    assert.equal(previousDay([], "2026-10-14T02:00:00Z"), null);
    assert.equal(previousDay(history, "not a date"), null);
  });
});

describe("buildKpis", () => {
  it("returns the four headline numbers", () => {
    const kpis = buildKpis(clone());
    assert.deepEqual(
      kpis.map((k) => [k.label, k.value]),
      [
        ["Gross (actual + commitment)", 1233933.91],
        ["Gross (actual)", 508703.58],
        ["Expenses (committed)", 0],
        ["Net (actual + commitment)", 1233933.91],
      ],
    );
  });
});

describe("expenseLines", () => {
  it("is empty when no lines are entered", () => {
    assert.deepEqual(expenseLines(clone()), []);
  });
  it("normalizes category rows", () => {
    const p = clone();
    p.expenses = {
      committed: 5000,
      paid: 1000,
      lineCount: 2,
      byCategory: [{ category: "Venue", budgeted: 6000, committed: 4000, paid: 1000 }, { name: "Music", committed: 1000 }],
    };
    assert.deepEqual(expenseLines(p), [
      { category: "Venue", budgeted: 6000, committed: 4000, paid: 1000 },
      { category: "Music", budgeted: null, committed: 1000, paid: 0 },
    ]);
  });
});

describe("trend helpers", () => {
  it("sorts, de-duplicates by date and maps the three series", () => {
    const pts = trendPoints([
      row("2026-10-13", 3, 2, 0, 3, 2),
      row("2026-10-12", 2, 1, 0, 2, 1),
      row("2026-10-12", 5, 4, 0, 5, 4),
    ]);
    assert.deepEqual(pts, [
      { date: "2026-10-12", grossAC: 5, grossActual: 4, netAC: 5 },
      { date: "2026-10-13", grossAC: 3, grossActual: 2, netAC: 3 },
    ]);
  });
  it("niceMax and formatCompact give tidy axes", () => {
    assert.equal(niceMax(1233933), 2000000);
    assert.equal(niceMax(480000), 500000);
    assert.equal(niceMax(0), 1);
    assert.equal(formatCompact(1500000), "$1.5M");
    assert.equal(formatCompact(250000), "$250K");
    assert.equal(formatCompact(900), "$900");
  });
});
