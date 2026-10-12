import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundFilters,
  defaultFilters,
  filterCards,
  isGiftId,
  type TyLetterCard,
} from "./shape";

const SNAP = { windowStart: "2026-08-13", windowEnd: "2026-10-12", minAmount: 1000 };

function card(giftId: string, giftDate: string, amount: number, extra: Partial<TyLetterCard> = {}): TyLetterCard {
  return {
    giftId,
    giftDate,
    amount,
    donorContactId: "1001",
    donorName: "Test Donor",
    solicitor: "",
    salutation: "",
    addressee: "",
    addressLines: [],
    cellPhone: "",
    homePhone: "",
    anonymous: false,
    rows: { latest: null, secondLatest: null, largest: null, first: null },
    totalGiving: amount,
    batch: null,
    ...extra,
  };
}

describe("ty-letters filters", () => {
  it("defaults to the last 7 days at the snapshot floor", () => {
    assert.deepEqual(defaultFilters(SNAP), { from: "2026-10-05", to: "2026-10-12", minAmount: 1000, sent: "all", q: "" });
  });

  it("bounds dates to the window and amount to the floor", () => {
    const f = boundFilters({ from: "2026-01-01", to: "2027-01-01", minAmount: 10, sent: "all", q: "" }, SNAP);
    assert.equal(f.from, "2026-08-13");
    assert.equal(f.to, "2026-10-12");
    assert.equal(f.minAmount, 1000);
  });

  it("filters by date, amount, sent and name, sorted by date then amount desc", () => {
    const cards = [
      card("1", "2026-10-01", 2000),
      card("2", "2026-10-10", 1500, { sent: true }),
      card("3", "2026-10-10", 9000, { donorName: "Other Person" }),
      card("4", "2026-09-01", 50000),
    ];
    const base = { from: "2026-10-01", to: "2026-10-12", minAmount: 1000, sent: "all" as const, q: "" };
    assert.deepEqual(filterCards(cards, base).map((c) => c.giftId), ["3", "2", "1"]);
    assert.deepEqual(filterCards(cards, { ...base, minAmount: 1800 }).map((c) => c.giftId), ["3", "1"]);
    assert.deepEqual(filterCards(cards, { ...base, sent: "sent" }).map((c) => c.giftId), ["2"]);
    assert.deepEqual(filterCards(cards, { ...base, sent: "not-sent" }).map((c) => c.giftId), ["3", "1"]);
    assert.deepEqual(filterCards(cards, { ...base, q: "  other " }).map((c) => c.giftId), ["3"]);
  });

  it("gift ids are digits only, up to 20", () => {
    assert.equal(isGiftId("442640"), true);
    assert.equal(isGiftId("1".repeat(21)), false);
    assert.equal(isGiftId("12 3"), false);
    assert.equal(isGiftId(123), false);
  });
});
