import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSportKey, SPORTS, sportByKey } from "./sports";

const VIRTUOUS_PROJECT_CODES: Record<string, string | null> = {
  cheerleading: "6625Cheer",
  "cross-country": null,
  "dance-team": "6596Dance",
  football: "6552FB",
  "mens-baseball": "6543MBase",
  "mens-basketball": "6530MBB",
  "mens-golf": "6622MGolf",
  "mens-soccer": "6569MSoc",
  rugby: "6540MRugby",
  "swim-team": "6201Swim",
  tennis: "6563Tennis",
  "track-and-field": "6683Track",
  "ultimate-frisbee": "6251FrisM",
  "womens-basketball": "6514WBB",
  "womens-golf": null,
  "womens-lacrosse": "6654WLACR",
  "womens-soccer": "6572WSoc",
  "womens-softball": "6557WSoft",
  "womens-volleyball": "6573WVB",
};

describe("athletics coaching sport catalog", () => {
  it("has stable keys for giving slugs plus golf", () => {
    const keys = SPORTS.map((sport) => sport.key);
    for (const key of Object.keys(VIRTUOUS_PROJECT_CODES)) {
      assert.equal(keys.includes(key), true, key);
      assert.equal(sportByKey[key]?.key, key);
    }
    assert.equal(keys.includes("marching-band"), false);
  });

  it("maps proven Virtuous project codes and leaves unresolved sports null", () => {
    assert.equal(SPORTS.length, Object.keys(VIRTUOUS_PROJECT_CODES).length);
    for (const sport of SPORTS) {
      assert.equal(
        sport.virtuousProjectCode,
        VIRTUOUS_PROJECT_CODES[sport.key],
        sport.key,
      );
      assert.notEqual(sport.virtuousProjectCode, "6117AthGEN");
      assert.notEqual(sport.virtuousProjectCode, "6644");
    }
    assert.equal(sportByKey["cross-country"]?.virtuousProjectCode, null);
    assert.equal(sportByKey["womens-golf"]?.virtuousProjectCode, null);
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
