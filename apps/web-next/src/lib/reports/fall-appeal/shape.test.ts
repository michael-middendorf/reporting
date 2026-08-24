import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { usd } from "./shape";

describe("fall appeal shape", () => {
  it("formats money", () => {
    assert.equal(usd(67104), "$67,104");
    assert.equal(usd(0), "$0");
    assert.equal(usd(null), "—");
    assert.equal(usd(-100), "-$100");
  });
});
