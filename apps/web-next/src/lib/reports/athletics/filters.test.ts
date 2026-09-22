import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterOptions,
  includeInAthleticsReport,
  normalizeApplication,
  normalizeProspect,
} from "./normalize";
import type { AthleticsRecord } from "./types";

function record(partial: Partial<AthleticsRecord>): AthleticsRecord {
  return {
    kind: "application",
    id: "1",
    firstName: "A",
    lastName: "B",
    email: "",
    phone: "",
    city: "",
    state: "",
    sport: "Football",
    position: "",
    gender: "M",
    term: "",
    sector: "",
    athleteStatus: "Athlete",
    applicationStatus: "",
    workflowBin: "",
    stage: "Applied",
    decisionCode: "",
    withdrawn: "",
    purchasedList: "",
    riskRating: "",
    recruitRating: "",
    loiStatus: "",
    offered: "",
    readyToOffer: "",
    signed: "",
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

describe("athletics report filters", () => {
  it("drops pickleball and cheerleading and non-athletic rows", () => {
    assert.equal(includeInAthleticsReport(record({ sport: "Pickleball" })), false);
    assert.equal(includeInAthleticsReport(record({ sport: "Cheerleading" })), false);
    assert.equal(includeInAthleticsReport(record({ sport: "Cheer" })), false);
    assert.equal(includeInAthleticsReport(record({ athleteStatus: "Non-Athlete" })), false);
    assert.equal(includeInAthleticsReport(record({ athleteStatus: "Non Athletic" })), false);
    assert.equal(includeInAthleticsReport(record({ sport: "Football", athleteStatus: "Athlete" })), true);
  });

  it("keeps risk on a 1-4 scale and stores recruit rating separately", () => {
    const application = normalizeApplication({
      PersonSport: "Soccer",
      "PersonRecruit-Rating": "Varsity",
      "Risk Factor": "3",
      ApplicationAthleticDecision: "Athlete",
      ApplicationStatus: "Awaiting Decision",
    }, 0);
    assert.equal(application.riskRating, "3");
    assert.equal(application.recruitRating, "Varsity");

    const ignored = normalizeApplication({
      PersonSport: "Soccer",
      "PersonRecruit-Rating": "Non-NAIA",
      "Risk Factor": "Varsity",
    }, 1);
    assert.equal(ignored.riskRating, "");
    assert.equal(ignored.recruitRating, "Non-NAIA");

    const prospect = normalizeProspect({
      "PersonSport-Primary": "Soccer",
      "Recruit-Rating": "Non-Varsity",
      "AthleteorNon-Athlete": "Athlete",
    }, 0);
    assert.equal(prospect.recruitRating, "Non-Varsity");
    assert.equal(prospect.riskRating, "");
  });

  it("hides removed sports, non-athletic status, and risk values outside 1-4", () => {
    const options = filterOptions([
      record({ sport: "Football", athleteStatus: "Athlete", riskRating: "2", recruitRating: "Varsity" }),
      record({ sport: "Pickleball", athleteStatus: "Non-Athlete", riskRating: "No Risk Rating", recruitRating: "" }),
      record({ sport: "Cheerleading", athleteStatus: "Athlete", riskRating: "5", recruitRating: "Non-NAIA" }),
      record({ sport: "Soccer", athleteStatus: "Non Athletic", riskRating: "1", recruitRating: "Varsity" }),
    ]);
    assert.deepEqual(options.sport, ["Football", "Soccer"]);
    assert.deepEqual(options.athleteStatus, ["Athlete"]);
    assert.deepEqual(options.riskRating, ["1", "2"]);
    assert.deepEqual(options.recruitRating, ["Non-NAIA", "Varsity"]);
  });
});
