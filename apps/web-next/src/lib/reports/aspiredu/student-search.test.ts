import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoSearchParams, loadMoreParams, queryTooShort } from "./student-search";

describe("student list search state", () => {
  it("auto-searches empty and 2+ character queries", () => {
    assert.deepEqual(autoSearchParams({ query: "", minRisk: null }, null), { query: "", minRisk: null });
    assert.deepEqual(autoSearchParams({ query: " sm ", minRisk: 3 }, { query: "", minRisk: null }), {
      query: "sm",
      minRisk: 3,
    });
  });

  it("skips a 1-character query when only the text changed", () => {
    assert.equal(autoSearchParams({ query: "m", minRisk: null }, { query: "", minRisk: null }), null);
    assert.equal(queryTooShort("m"), true);
    assert.equal(queryTooShort(" "), false);
    assert.equal(queryTooShort("mo"), false);
  });

  it("reloads a risk chip change with a 1-character box using the last committed query", () => {
    assert.deepEqual(autoSearchParams({ query: "m", minRisk: 4 }, { query: "smith", minRisk: null }), {
      query: "smith",
      minRisk: 4,
    });
    assert.deepEqual(autoSearchParams({ query: "m", minRisk: 4 }, null), { query: "", minRisk: 4 });
  });

  it("Load more reuses the committed params, not the live box (stale cursor case)", () => {
    // Empty query loaded with a cursor, then the user typed "m" without a reload.
    const committed = { query: "", minRisk: null };
    assert.equal(autoSearchParams({ query: "m", minRisk: null }, committed), null);
    assert.deepEqual(loadMoreParams(committed, "100"), { query: "", minRisk: null, cursor: "100" });
    assert.equal(loadMoreParams(null, "100"), null);
    assert.equal(loadMoreParams(committed, null), null);
  });
});
