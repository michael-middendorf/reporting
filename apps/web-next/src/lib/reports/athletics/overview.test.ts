import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AthleticsRecord } from "./types";
import {
  canSeeOverviewSport,
  coachingSportKeyForRecord,
  recruitingOverviewStats,
  visibleOverviewSports,
} from "./overview";

function app(partial: Partial<AthleticsRecord>): AthleticsRecord {
  return {
    kind: "application",
    id: partial.id || "1",
    firstName: "A",
    lastName: "B",
    email: "",
    phone: "",
    city: "",
    state: "",
    sport: "Football",
    position: "",
    gender: "M",
    term: "Fall 2027",
    sector: "Varsity",
    athleteStatus: "",
    applicationStatus: "",
    workflowBin: "",
    stage: "",
    decisionCode: "",
    withdrawn: "",
    purchasedList: "",
    riskRating: "",
    loiStatus: "",
    offered: "",
    readyToOffer: "",
    signed: "Signed or Deposited",
    studentType: "",
    prospectStatus: "",
    recordUrl: "",
    profileUrl: "",
    gpa: null,
    catholic: false,
    athleticScholarship: 0,
    athleticDiscretionaryFund: 0,
    faithFootball: 0,
    impactAwards: 0,
    academicScholarship: 0,
    admissionsAwards: 0,
    totalAwards: 0,
    ...partial,
  };
}

describe("athletics master overview", () => {
  it("maps ungendered basketball rows with gender", () => {
    assert.equal(coachingSportKeyForRecord({ sport: "Basketball", gender: "M" }), "mens-basketball");
    assert.equal(coachingSportKeyForRecord({ sport: "Basketball", gender: "F" }), "womens-basketball");
    assert.equal(coachingSportKeyForRecord({ sport: "Football", gender: "M" }), "football");
    assert.equal(coachingSportKeyForRecord({ sport: "Ultimate Frisbee", gender: "M" }), "ultimate-frisbee");
  });

  it("summarizes recruiting stats for one sport", () => {
    const rows = [
      app({ id: "1", sport: "Football", athleticScholarship: 10000, signed: "Signed or Deposited" }),
      app({ id: "2", sport: "Football", athleticScholarship: 20000, signed: "Signed or Deposited" }),
      app({ id: "3", sport: "Football", athleticScholarship: 0, signed: "Signed or Deposited" }),
      app({ id: "4", sport: "Football", athleticScholarship: 5000, signed: "" }),
      app({
        id: "5",
        sport: "Basketball",
        gender: "M",
        athleticScholarship: 8000,
        signed: "Signed or Deposited",
      }),
      app({
        id: "6",
        sport: "Football",
        athleticScholarship: 12000,
        signed: "Signed or Deposited",
        term: "Fall 2026",
      }),
    ];
    const football = recruitingOverviewStats(rows, "football");
    assert.equal(football.applications, 5);
    assert.equal(football.signed, 3);
    assert.equal(football.signedWithAid, 2);
    assert.equal(football.avgScholarshipSigned, 15000);
    const mbb = recruitingOverviewStats(rows, "mens-basketball");
    assert.equal(mbb.applications, 1);
    assert.equal(mbb.avgScholarshipSigned, 8000);
  });

  it("lets leadership see every sport and football coaches only football", () => {
    const leadership = visibleOverviewSports("elizabeth.feger@avemaria.edu").map((sport) => sport.key);
    assert.ok(leadership.includes("ultimate-frisbee"));
    assert.ok(leadership.includes("football"));
    assert.equal(canSeeOverviewSport("joseph.patterson@avemaria.edu", "football"), true);
    assert.equal(canSeeOverviewSport("joseph.patterson@avemaria.edu", "mens-soccer"), false);
    assert.equal(canSeeOverviewSport("jamon.copeland@avemaria.edu", "mens-basketball"), true);
    assert.equal(canSeeOverviewSport("jamon.copeland@avemaria.edu", "womens-basketball"), false);
  });
});
