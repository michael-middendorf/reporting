import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ambiguousSportKeys,
  canonicalSportKey,
  resolveGenderedSportKey,
  resolvePcAssociation,
  resolveSportKey,
  SPORTS,
  sportByKey,
} from "./sports";

const VIRTUOUS_PROJECT_CODES: Record<string, string | null> = {
  "xc-track": null,
  "dance-team": "6596Dance",
  football: "6552FB",
  "mens-baseball": "6543MBase",
  "mens-basketball": "6530MBB",
  "mens-golf": "6622MGolf",
  "mens-soccer": "6569MSoc",
  rugby: "6540MRugby",
  "swim-team": "6201Swim",
  tennis: "6563Tennis",
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
    assert.equal(sportByKey["xc-track"]?.virtuousProjectCode, null);
    assert.deepEqual(sportByKey["xc-track"]?.virtuousProjectCodes, ["6578MXC", "6580WXC", "6683Track"]);
    assert.equal(sportByKey["womens-golf"]?.virtuousProjectCode, null);
    const catalogKeys = SPORTS.map((sport) => sport.key);
    assert.equal(catalogKeys.includes("mens-cross-country"), false);
    assert.equal(catalogKeys.includes("womens-cross-country"), false);
    assert.equal(catalogKeys.includes("track-and-field"), false);
  });

  it("resolves Slate and giving aliases", () => {
    assert.equal(resolveSportKey("Baseball"), "mens-baseball");
    assert.equal(resolveSportKey("Competitive Dance"), "dance-team");
    assert.equal(resolveSportKey("M Basketball"), "mens-basketball");
    assert.equal(resolveSportKey("W Basketball"), "womens-basketball");
    assert.equal(resolveSportKey("Men's Cross Country"), "xc-track");
    assert.equal(resolveSportKey("WXC"), "xc-track");
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
    assert.equal(resolveSportKey("Cheerleading"), null);
    assert.equal(resolveSportKey("Cheer"), null);
    assert.equal(resolveSportKey("Pickleball"), null);
    assert.equal(resolveSportKey(""), null);
  });

  it("maps Slate Cross Country/Track names onto one XC/Track team", () => {
    assert.equal(resolveSportKey("Cross Country"), "xc-track");
    assert.equal(resolveSportKey("Cross Country/Track"), "xc-track");
    assert.equal(resolveSportKey("XC"), "xc-track");
    assert.equal(resolveSportKey("Track and Field"), "xc-track");
    assert.equal(resolveSportKey("Track"), "xc-track");
    assert.equal(canonicalSportKey("mens-cross-country"), "xc-track");
    assert.equal(canonicalSportKey("womens-cross-country"), "xc-track");
    assert.equal(canonicalSportKey("track-and-field"), "xc-track");
    assert.equal(canonicalSportKey("cross-country"), "xc-track");
    assert.equal(resolveGenderedSportKey("Cross Country/Track", "M"), "xc-track");
    assert.equal(resolveGenderedSportKey("XC", "F"), "xc-track");
    assert.equal(resolveGenderedSportKey("Cross Country", ""), "xc-track");
    assert.equal(resolveGenderedSportKey("Track and Field", "M"), "xc-track");
    assert.equal(ambiguousSportKeys("Cross Country"), null);
    assert.equal(resolveGenderedSportKey("Basketball", "M"), "mens-basketball");
    assert.equal(resolveGenderedSportKey("Basketball", "F"), "womens-basketball");
    assert.equal(resolveGenderedSportKey("Soccer", "Male"), "mens-soccer");
    assert.equal(resolveGenderedSportKey("Golf", "Female"), "womens-golf");
    assert.equal(resolveGenderedSportKey("Basketball", ""), null);
    assert.equal(resolveGenderedSportKey("Football", "M"), "football");
    assert.equal(resolveGenderedSportKey("Volleyball", "F"), "womens-volleyball");
    assert.deepEqual(ambiguousSportKeys("Basketball", ["F"]), ["womens-basketball"]);
  });
});

/** Must match ATHLETIC_ASSOCIATION_CODES in services/publishers/powercampus/queries.py. */
const PC_ATHLETIC_CODES = [
  "ICBASE", "ICBBM", "ICBBW", "ICCG", "ICFBM", "ICGLFM", "ICGLFW", "ICSOCM",
  "ICSOCW", "ICSOFT", "ICSSWM", "ICSWMW", "ICTENM", "ICTENW", "ICTRKM",
  "ICTRKW", "ICVBAL", "ICXCM", "ICXCW", "LACROS", "CDANCE",
  "ICJBAS", "ICJBBM", "ICJBBW", "ICJEQU", "ICJFRM", "ICJGLM", "ICJGLW",
  "ICJLCM", "ICJSOF", "ICJSOM", "ICJSOW", "ICJSWM", "ICJTNM", "ICJTNW",
  "ICJVBL", "ICHSWW",
  "AFBALM", "AFBALW",
];

const UNMAPPED_PC_CODES = ["ICCG", "ICJEQU", "ICJLCM", "AFBALW"];

describe("PowerCampus association codes", () => {
  it("maps varsity, JV, and legacy codes to the parent sport", () => {
    assert.equal(resolvePcAssociation("ICFBM"), "football");
    assert.equal(resolvePcAssociation("AFBALM"), "football");
    assert.equal(resolvePcAssociation("ICBBM"), "mens-basketball");
    assert.equal(resolvePcAssociation("ICJBBM"), "mens-basketball");
    assert.equal(resolvePcAssociation("ICJBBW"), "womens-basketball");
    assert.equal(resolvePcAssociation("ICJBAS"), "mens-baseball");
    assert.equal(resolvePcAssociation("ICXCW"), "xc-track");
    assert.equal(resolvePcAssociation("ICTRKM"), "xc-track");
    assert.equal(resolvePcAssociation("ICHSWW"), "swim-team");
    assert.equal(resolvePcAssociation("ICSSWM"), "swim-team");
    assert.equal(resolvePcAssociation("ICJTNW"), "tennis");
    assert.equal(resolvePcAssociation("ICJFRM"), "ultimate-frisbee");
    assert.equal(resolvePcAssociation("LACROS"), "womens-lacrosse");
    assert.equal(resolvePcAssociation("CDANCE"), "dance-team");
    assert.equal(resolvePcAssociation("ICJVBL"), "womens-volleyball");
    assert.equal(resolvePcAssociation(" icsoft "), "womens-softball");
  });

  it("leaves codes without a coaching sport unmapped", () => {
    for (const code of UNMAPPED_PC_CODES) assert.equal(resolvePcAssociation(code), null, code);
    assert.equal(resolvePcAssociation(""), null);
    assert.equal(resolvePcAssociation("ICUFRM"), null);
    assert.equal(resolvePcAssociation("HONORS"), null);
  });

  it("covers every publisher athletic code exactly once", () => {
    const seen = new Map<string, string>();
    for (const sport of SPORTS) {
      for (const code of sport.pcAssociationCodes) {
        assert.equal(seen.has(code), false, `${code} on ${seen.get(code)} and ${sport.key}`);
        seen.set(code, sport.key);
        assert.equal(PC_ATHLETIC_CODES.includes(code), true, `${code} is not published`);
      }
    }
    for (const code of PC_ATHLETIC_CODES) {
      assert.equal(seen.has(code) || UNMAPPED_PC_CODES.includes(code), true, code);
    }
  });
});
