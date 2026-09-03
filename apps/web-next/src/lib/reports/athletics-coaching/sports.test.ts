import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSportKey, SPORTS, sportByKey } from "./sports";

describe("athletics coaching sport catalog", () => {
  it("has stable keys for giving slugs plus golf", () => {
    const keys = SPORTS.map((sport) => sport.key);
    for (const key of [
      "cheerleading",
      "cross-country",
      "dance-team",
      "football",
      "mens-baseball",
      "mens-basketball",
      "mens-golf",
      "mens-soccer",
      "rugby",
      "swim-team",
      "tennis",
      "track-and-field",
      "ultimate-frisbee",
      "womens-basketball",
      "womens-golf",
      "womens-lacrosse",
      "womens-soccer",
      "womens-softball",
      "womens-volleyball",
    ]) {
      assert.equal(keys.includes(key), true, key);
      assert.equal(sportByKey[key]?.key, key);
      assert.equal(sportByKey[key]?.virtuousProjectCode, null);
    }
    assert.equal(keys.includes("marching-band"), false);
  });

  it("resolves Slate and giving aliases", () => {
    assert.equal(resolveSportKey("Baseball"), "mens-baseball");
    assert.equal(resolveSportKey("Competitive Dance"), "dance-team");
    assert.equal(resolveSportKey("M Basketball"), "mens-basketball");
    assert.equal(resolveSportKey("W Basketball"), "womens-basketball");
    assert.equal(resolveSportKey("Cross Country/Track"), "cross-country");
    assert.equal(resolveSportKey("Rugby-Women"), "rugby");
    assert.equal(resolveSportKey("mens-soccer"), "mens-soccer");
    assert.equal(resolveSportKey("swim-team"), "swim-team");
    assert.equal(resolveSportKey("Golf-Men"), "mens-golf");
    assert.equal(resolveSportKey("Volleyball"), "womens-volleyball");
  });

  it("does not guess ungendered basketball/soccer/golf or marching band", () => {
    assert.equal(resolveSportKey("Basketball"), null);
    assert.equal(resolveSportKey("Soccer"), null);
    assert.equal(resolveSportKey("Golf"), null);
    assert.equal(resolveSportKey("Marching Band"), null);
    assert.equal(resolveSportKey("Band"), null);
    assert.equal(resolveSportKey(""), null);
  });
});
