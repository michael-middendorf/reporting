import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CensusRawStudent } from "../census/lists-core";
import {
  buildEligibilityAthletes,
  eligibilityExportRows,
  filterEligibilityBySports,
} from "./eligibility";

function census(partial: Partial<CensusRawStudent>): CensusRawStudent {
  return {
    pcid: "P000000001",
    first: "Pat",
    last: "Player",
    incomingReturning: "Returning",
    state: "FL",
    religion: "",
    cathGroup: "",
    ethnicity: "",
    gender: "Male",
    program: "UNDERG",
    collegeAttend: "FTCA",
    curriculum: "",
    curriculumName: "",
    classLevel: "Junior",
    fullPart: "FULL",
    city: "",
    credits: 15,
    gpa: 3.2,
    earnedCredits: 72,
    residency: "",
    sport: "Football",
    athlete: "Y",
    athleticType: "",
    rosterStatus: "",
    honors: "",
    fsp: "",
    household: "",
    institute: "",
    marines: "",
    appDecision: "",
    session: "",
    degree: "",
    email: "pat@avemaria.edu",
    citizenship: "",
    visa: "",
    admitTerm: "Fall 2024",
    ...partial,
  };
}

describe("athletics eligibility sheet", () => {
  it("joins roster to census hours and GPA and keeps Fall 2025 hours from prior census", () => {
    const athletes = buildEligibilityAthletes(
      [
        {
          email: "pat@avemaria.edu",
          pcid: "P000000001",
          firstname: "Pat",
          lastname: "Player",
          currentsport: "Football",
          classyear: "Junior",
        },
        {
          email: "sam@avemaria.edu",
          pcid: "P000000002",
          firstname: "Sam",
          lastname: "Soccer",
          currentsport: "Soccer-Men",
        },
      ],
      [census({}), census({ pcid: "P000000002", email: "sam@avemaria.edu", sport: "Soccer", gender: "Male", credits: 12, gpa: 2.9, earnedCredits: 48 })],
      [census({ credits: 16 }), census({ pcid: "P000000002", email: "sam@avemaria.edu", credits: 13 })],
    );
    assert.equal(athletes.length, 2);
    const football = athletes.find((row) => row.sportKey === "football");
    assert.equal(football?.currentHours, 15);
    assert.equal(football?.secondLastHours, 16);
    assert.equal(football?.earnedHours, 72);
    assert.equal(football?.cumGpa, 3.2);
    assert.equal(football?.matriculation, "Fall 2024");
    assert.equal(football?.priorTermHours, null);
    assert.equal(football?.summerHours, null);
    assert.equal(football?.fullTimeTerms, null);
    const soccerOnly = filterEligibilityBySports(athletes, ["football"]);
    assert.equal(soccerOnly.length, 1);
    assert.equal(soccerOnly[0]?.sportKey, "football");
    const sheet = eligibilityExportRows(athletes);
    assert.equal(sheet[0]?.includes("Current hours (Fall 2026)"), true);
    assert.equal(sheet[0]?.includes("Date of matriculation"), true);
  });
});
