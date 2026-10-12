import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPACITY_TERMS, capacityTermById } from "./capacity-terms";

describe("capacity terms", () => {
  it("lists Fall 2026, Spring 2027, and Fall 2027 in that order", () => {
    assert.deepEqual(
      CAPACITY_TERMS.map((term) => term.id),
      ["fa26", "sp27", "fa27"],
    );
    assert.deepEqual(
      CAPACITY_TERMS.map((term) => term.label),
      ["Fall 2026", "Spring 2027", "Fall 2027"],
    );
  });

  it("keeps Fall 2026 on the live eRez sessions", () => {
    const fall = capacityTermById("fa26");
    assert.equal(fall.ready, true);
    assert.equal(fall.sessions?.domestic, "2026FALL01");
    assert.equal(fall.sessions?.ireland, "2026FALL03Ireland");
    assert.equal(fall.pending, null);
  });

  it("leaves Spring 2027 and Fall 2027 without figures", () => {
    for (const id of ["sp27", "fa27"] as const) {
      const term = capacityTermById(id);
      assert.equal(term.ready, false);
      assert.equal(term.sessions, null);
      assert.match(term.pending || "", /eRez session id/);
    }
  });

  it("falls back to Fall 2026 for a missing or unknown term", () => {
    assert.equal(capacityTermById(null).id, "fa26");
    assert.equal(capacityTermById("").id, "fa26");
    assert.equal(capacityTermById("fa28").id, "fa26");
  });
});
