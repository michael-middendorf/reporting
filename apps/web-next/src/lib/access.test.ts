import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessReport,
  canLogin,
  reportsForEmail,
} from "./access";

const ROBERT = "Robert.Musselman@avemaria.edu";
const ZENA = "zena.weist@avemaria.edu";
const ANNIE = "annie.esposito@avemaria.edu";

describe("chapel-only grant", () => {
  it("lets Robert sign in and open only chapel reports", () => {
    assert.equal(canLogin(ROBERT), true);
    assert.equal(canAccessReport(ROBERT, "chapel"), true);
    assert.equal(canAccessReport(ROBERT, "advancement"), false);
    assert.equal(canAccessReport(ROBERT, "annunciation"), false);
    assert.equal(canAccessReport(ROBERT, "enrollment"), false);
    assert.deepEqual(reportsForEmail(ROBERT), ["chapel"]);
  });

  it("keeps existing Advancement users on chapel pages", () => {
    assert.equal(canAccessReport(ZENA, "advancement"), true);
    assert.equal(canAccessReport(ZENA, "chapel"), true);
    assert.equal(canAccessReport(ZENA, "annunciation"), true);
    assert.equal(reportsForEmail(ZENA).includes("chapel"), true);
    assert.equal(reportsForEmail(ZENA).includes("advancement"), true);
  });

  it("does not grant chapel to unrelated report users", () => {
    assert.equal(canLogin(ANNIE), true);
    assert.equal(canAccessReport(ANNIE, "points"), true);
    assert.equal(canAccessReport(ANNIE, "chapel"), false);
    assert.equal(canAccessReport(ANNIE, "advancement"), false);
    assert.equal(canAccessReport(ANNIE, "athletics"), false);
  });
});

describe("institute-only grant", () => {
  const GABRIEL = "Gabriel.F.Mellino@avemaria.edu";

  it("lets Gabriel sign in and open only The Institute", () => {
    assert.equal(canLogin(GABRIEL), true);
    assert.equal(canAccessReport(GABRIEL, "institute"), true);
    assert.equal(canAccessReport(GABRIEL, "enrollment"), false);
    assert.equal(canAccessReport(GABRIEL, "census"), false);
    assert.equal(canAccessReport(GABRIEL, "housing"), false);
    assert.equal(canAccessReport(GABRIEL, "advancement"), false);
    assert.equal(canAccessReport(GABRIEL, "chapel"), false);
    assert.equal(canAccessReport(GABRIEL, "points"), false);
    assert.equal(canAccessReport(GABRIEL, "annunciation"), false);
    assert.equal(canAccessReport(GABRIEL, "aspiredu"), false);
    assert.equal(canAccessReport(GABRIEL, "athletics"), false);
    assert.deepEqual(reportsForEmail(GABRIEL), ["institute"]);
  });
});

describe("athletics-only grant", () => {
  const ERIC = "Eric.Vanheusen@avemaria.edu";

  it("lets Eric sign in and open only Athletics Master", () => {
    assert.equal(canLogin(ERIC), true);
    assert.equal(canAccessReport(ERIC, "athletics"), true);
    assert.equal(canAccessReport(ERIC, "enrollment"), false);
    assert.equal(canAccessReport(ERIC, "census"), false);
    assert.equal(canAccessReport(ERIC, "housing"), false);
    assert.equal(canAccessReport(ERIC, "institute"), false);
    assert.equal(canAccessReport(ERIC, "advancement"), false);
    assert.equal(canAccessReport(ERIC, "chapel"), false);
    assert.equal(canAccessReport(ERIC, "points"), false);
    assert.equal(canAccessReport(ERIC, "annunciation"), false);
    assert.equal(canAccessReport(ERIC, "aspiredu"), false);
    assert.deepEqual(reportsForEmail(ERIC), ["athletics"]);
  });
});

describe("housing grant for existing enrollment viewer", () => {
  const DAN = "Dan.Donaldson@avemaria.edu";

  it("lets Dan sign in and open Enrollment plus Housing only", () => {
    assert.equal(canLogin(DAN), true);
    assert.equal(canAccessReport(DAN, "enrollment"), true);
    assert.equal(canAccessReport(DAN, "housing"), true);
    assert.equal(canAccessReport(DAN, "census"), false);
    assert.equal(canAccessReport(DAN, "athletics"), false);
    assert.equal(canAccessReport(DAN, "institute"), false);
    assert.equal(canAccessReport(DAN, "advancement"), false);
    assert.equal(canAccessReport(DAN, "chapel"), false);
    assert.equal(canAccessReport(DAN, "points"), false);
    assert.equal(canAccessReport(DAN, "annunciation"), false);
    assert.equal(canAccessReport(DAN, "aspiredu"), false);
    assert.deepEqual(reportsForEmail(DAN), ["enrollment", "housing"]);
  });
});

describe("Fall Appeal viewers", () => {
  const people = [
    "cassandra.l.bournos@avemaria.edu",
    "zena.weist@avemaria.edu",
    "sarah.chichester@avemaria.edu",
  ];

  it("lets Cassandra, Zena, and Sarah open Advancement reports including Fall Appeal", () => {
    for (const email of people) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "advancement"), true, email);
    }
  });
});

describe("full Advancement grants", () => {
  const people = [
    "Leslie.Sonnen@avemaria.edu",
    "Julie.Musselman@avemaria.edu",
    "Jim.Thomas@avemaria.edu",
  ];

  it("lets Leslie, Julie, and Jim sign in to every Advancement report", () => {
    for (const email of people) {
      assert.equal(canLogin(email), true, email);
      assert.equal(canAccessReport(email, "advancement"), true, email);
      assert.equal(canAccessReport(email, "chapel"), true, email);
      assert.equal(canAccessReport(email, "annunciation"), true, email);
      assert.equal(canAccessReport(email, "enrollment"), false, email);
    }
  });

  it("gives Leslie MA Points in addition to Advancement", () => {
    const leslie = "Leslie.Sonnen@avemaria.edu";
    assert.equal(canAccessReport(leslie, "points"), true);
    assert.deepEqual(reportsForEmail(leslie), [
      "advancement",
      "chapel",
      "points",
      "annunciation",
    ]);
  });

  it("does not promote Julie or Jim to MA Points or other folders", () => {
    for (const email of [
      "Julie.Musselman@avemaria.edu",
      "Jim.Thomas@avemaria.edu",
    ]) {
      assert.equal(canAccessReport(email, "points"), false, email);
      assert.equal(canAccessReport(email, "housing"), false, email);
      assert.equal(canAccessReport(email, "census"), false, email);
      assert.deepEqual(
        reportsForEmail(email),
        ["advancement", "chapel", "annunciation"],
        email,
      );
    }
  });

  it("does not promote Leslie to housing, census, or other folders", () => {
    const leslie = "Leslie.Sonnen@avemaria.edu";
    assert.equal(canAccessReport(leslie, "housing"), false);
    assert.equal(canAccessReport(leslie, "census"), false);
    assert.equal(canAccessReport(leslie, "enrollment"), false);
    assert.equal(canAccessReport(leslie, "athletics"), false);
  });
});
