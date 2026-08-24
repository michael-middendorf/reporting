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
    assert.deepEqual(reportsForEmail(GABRIEL), ["institute"]);
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
      const reports = reportsForEmail(email);
      assert.deepEqual(reports, ["advancement", "chapel", "annunciation"], email);
    }
  });

  it("does not promote them to admins or other folders", () => {
    for (const email of people) {
      assert.equal(canAccessReport(email, "points"), false, email);
      assert.equal(canAccessReport(email, "housing"), false, email);
      assert.equal(canAccessReport(email, "census"), false, email);
    }
  });
});
