import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ambiguousSportKeys, resolveGenderedSportKey, resolveSportKey, SPORTS, sportByKey } from "./sports";

const VIRTUOUS_PROJECT_CODES: Record<string, string | null> = {
  "mens-cross-country": "6578MXC",
  "womens-cross-country": "6580WXC",
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
    assert.equal(keys.includes("cheerleading"), false);
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
    assert.equal(sportByKey["mens-cross-country"]?.virtuousProjectCode, "6578MXC");
    assert.equal(sportByKey["womens-cross-country"]?.virtuousProjectCode, "6580WXC");
    assert.equal(sportByKey["womens-golf"]?.virtuousProjectCode, null);
  });

  it("resolves Slate and giving aliases", () => {
    assert.equal(resolveSportKey("Baseball"), "mens-baseball");
    assert.equal(resolveSportKey("Competitive Dance"), "dance-team");
    assert.equal(resolveSportKey("M Basketball"), "mens-basketball");
    assert.equal(resolveSportKey("W Basketball"), "womens-basketball");
    assert.equal(resolveSportKey("Men's Cross Country"), "mens-cross-country");
    assert.equal(resolveSportKey("WXC"), "womens-cross-country");
    assert.equal(resolveSportKey("Rugby-Women"), "rugby");
    assert.equal(resolveSportKey("mens-soccer"), "mens-soccer");
    assert.equal(resolveSportKey("swim-team"), "swim-team");
    assert.equal(resolveSportKey("Golf-Men"), "mens-golf");
    assert.equal(resolveSportKey("Volleyball"), "womens-volleyball");
  });

  it("does not guess ungendered basketball/soccer/golf/cross country or marching band", () => {
    assert.equal(resolveSportKey("Basketball"), null);
    assert.equal(resolveSportKey("Soccer"), null);
    assert.equal(resolveSportKey("Golf"), null);
    assert.equal(resolveSportKey("Cross Country"), null);
    assert.equal(resolveSportKey("Cross Country/Track"), null);
    assert.equal(resolveSportKey("XC"), null);
    assert.equal(resolveSportKey("Marching Band"), null);
    assert.equal(resolveSportKey("Band"), null);
    assert.equal(resolveSportKey("Cheerleading"), null);
    assert.equal(resolveSportKey("Cheer"), null);
    assert.equal(resolveSportKey("Pickleball"), null);
    assert.equal(resolveSportKey(""), null);
  });

  it("uses gender only for ungendered basketball, soccer, golf, and cross country", () => {
    assert.equal(resolveGenderedSportKey("Basketball", "M"), "mens-basketball");
    assert.equal(resolveGenderedSportKey("Basketball", "F"), "womens-basketball");
    assert.equal(resolveGenderedSportKey("Soccer", "Male"), "mens-soccer");
    assert.equal(resolveGenderedSportKey("Golf", "Female"), "womens-golf");
    assert.equal(resolveGenderedSportKey("Cross Country/Track", "M"), "mens-cross-country");
    assert.equal(resolveGenderedSportKey("XC", "F"), "womens-cross-country");
    assert.equal(resolveGenderedSportKey("Cross Country", ""), null);
    assert.equal(resolveGenderedSportKey("Basketball", ""), null);
    assert.equal(resolveGenderedSportKey("Football", "M"), "football");
    assert.equal(resolveGenderedSportKey("Volleyball", "F"), "womens-volleyball");
    assert.equal(resolveGenderedSportKey("Track and Field", "M"), "track-and-field");
    assert.deepEqual(ambiguousSportKeys("Cross Country"), ["mens-cross-country", "womens-cross-country"]);
    assert.deepEqual(ambiguousSportKeys("cross-country", ["M"]), ["mens-cross-country"]);
    assert.deepEqual(ambiguousSportKeys("Basketball", ["F"]), ["womens-basketball"]);
  });
});
