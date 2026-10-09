import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterListedGifts, giftMatchesQuery } from "./gift-search.js";

const myers = {
  owner: "Natalia Abrams",
  day: "2026-09-29",
  giftType: "Check",
  project: "FYE27 Fall 2026 Appeal Lapsed 24-48 Direct Mail 1",
  amount: 50,
  giftId: 452371,
};

const wagner = {
  owner: "Natalia Abrams",
  day: "2026-09-17",
  acIncrease: true,
  project: "AMU Mission Fund",
  amount: 117.72,
  priorMonthly: 11.1,
  newMonthly: 20.91,
  giftId: "rg-3853",
};

const suran = {
  owner: "Natalia Abrams",
  day: "2026-09-12",
  giftType: "Credit",
  project: "26-27 Gyrene Booster Club",
  amount: 257.78,
  giftId: 451822,
};

describe("gift search", () => {
  it("matches a donor name across words", () => {
    assert.equal(giftMatchesQuery(myers, "myers", "Bill and Janet Myers"), true);
    assert.equal(giftMatchesQuery(myers, "janet myers", "Bill and Janet Myers"), true);
    assert.equal(giftMatchesQuery(myers, "wagner", "Bill and Janet Myers"), false);
  });

  it("matches the rounded dollars shown on the row", () => {
    assert.equal(giftMatchesQuery(myers, "50", "Bill and Janet Myers"), true);
    assert.equal(giftMatchesQuery(myers, "$50", "Bill and Janet Myers"), true);
    assert.equal(giftMatchesQuery(suran, "258", "John Suran"), true);
    assert.equal(giftMatchesQuery(suran, "25", "John Suran"), false);
    assert.equal(giftMatchesQuery(wagner, "$118", "Paul and Mechelle Wagner"), true);
    assert.equal(giftMatchesQuery(wagner, "20.91", "Paul and Mechelle Wagner"), true);
    assert.equal(giftMatchesQuery(wagner, "11.10", "Paul and Mechelle Wagner"), true);
  });

  it("matches the kind, project, date, and gift id", () => {
    assert.equal(giftMatchesQuery(myers, "check lapsed", "Bill and Janet Myers"), true);
    assert.equal(giftMatchesQuery(wagner, "ac increase", "Paul and Mechelle Wagner"), true);
    assert.equal(giftMatchesQuery(wagner, "mission fund", "Paul and Mechelle Wagner"), true);
    assert.equal(giftMatchesQuery(myers, "sep 29", "Bill and Janet Myers"), true);
    assert.equal(giftMatchesQuery(myers, "sep 5", "Bill and Janet Myers"), false);
    assert.equal(giftMatchesQuery(wagner, "rg-3853", "Paul and Mechelle Wagner"), true);
    assert.equal(giftMatchesQuery(myers, "natalia", "Bill and Janet Myers"), true);
  });

  it("keeps every gift when the query is blank", () => {
    assert.equal(giftMatchesQuery(myers, "  ", "Bill and Janet Myers"), true);
  });

  it("searches the selected MA, then the other MAs when that MA has no match", () => {
    const rows = [
      { ...myers, contactName: "Bill and Janet Myers" },
      { ...suran, contactName: "John Suran" },
      { owner: "Sean Kelly", contactName: "Robert and Nicole Lyons", day: "2026-10-07", giftType: "Credit", amount: 3089.91, giftId: 452770 },
    ];
    const nameOf = (g) => g.contactName;
    assert.equal(filterListedGifts(rows, { owner: null, query: "", nameOf }).rows.length, 0);
    assert.equal(filterListedGifts(rows, { owner: "Natalia Abrams", query: "", nameOf }).rows.length, 2);
    assert.equal(filterListedGifts(rows, { owner: "Natalia Abrams", query: "myers", nameOf }).rows.length, 1);
    const widened = filterListedGifts(rows, { owner: "Natalia Abrams", query: "lyons", nameOf });
    assert.equal(widened.widened, true);
    assert.equal(widened.rows[0].owner, "Sean Kelly");
    const everyone = filterListedGifts(rows, { owner: null, query: "sep", nameOf });
    assert.equal(everyone.widened, false);
    assert.equal(everyone.rows.length, 2);
  });
});
