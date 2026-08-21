import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shortStatus, usd } from "./shape";

describe("mgo top prospects shape", () => {
  it("formats money", () => {
    assert.equal(usd(14333500), "$14,333,500");
    assert.equal(usd(0), "$0");
    assert.equal(usd(null), "—");
  });

  it("shortens pipeline status labels", () => {
    assert.equal(shortStatus("Cultivation / Gift Ask Strategy (MGO)"), "Cultivation / Gift Ask Strategy");
    assert.equal(shortStatus("Gift Received (Adv Svcs)"), "Gift Received");
    assert.equal(shortStatus(null), "—");
  });
});
