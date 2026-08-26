import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyErezResidency,
  deriveUnretained,
  isInterveningGraduate,
  isUgDegreeSeekingRow,
  type CensusRawStudent,
  type UnretainedStudent,
} from "./lists";

test("eRez residency overwrites blank registration housing", () => {
  const students: CensusRawStudent[] = [
    {
      pcid: "P1",
      first: "A",
      last: "B",
      incomingReturning: "Incoming",
      state: "FL",
      religion: "",
      cathGroup: "",
      ethnicity: "",
      gender: "",
      program: "UNDERG",
      collegeAttend: "FTCA",
      curriculum: "",
      curriculumName: "",
      classLevel: "Freshman",
      fullPart: "FULL",
      city: "",
      credits: 15,
      gpa: "",
      earnedCredits: 0,
      residency: "",
      sport: "",
      athlete: "",
      honors: "",
      fsp: "",
      household: "",
      institute: "",
      marines: "",
      appDecision: "",
      session: "",
      degree: "",
      email: "",
      citizenship: "",
      visa: "",
    },
  ];
  const out = applyErezResidency(students, [
    {
      pcid: "P1",
      name: "A B",
      email: "",
      building: "JPII",
      room: "101",
      priceType: "UGDP",
      residency: "Resident",
      classStatus: "Freshman",
      studentType: "Incoming",
      includedInCensus: true,
    },
  ]);
  assert.equal(out[0].residency, "Resident");
});

function prior(pcid: string, extra: Partial<UnretainedStudent> = {}): UnretainedStudent {
  return {
    pcid,
    first: "A",
    last: "B",
    retention: "",
    gpa: 3,
    fsp: "-",
    household: "-",
    marines: "-",
    honors: "-",
    sport: "-",
    state: "FL",
    gender: "Female",
    classLevel: "Sophomore",
    collegeAttend: "FTCA",
    incomingReturning: "Returning",
    program: "UNDERG",
    ...extra,
  };
}

test("unretained is last census minus graduates minus this-term registration", () => {
  const rows = deriveUnretained(
    [prior("P1"), prior("P2"), prior("P3"), prior("P4", { program: "GRAD", collegeAttend: "GRAD" })],
    ["P2", "p4"],
    ["P3"],
  );
  assert.deepEqual(
    rows.map((r) => r.pcid),
    ["P1"],
  );
  assert.equal(rows[0].retention, "Not Retained");
});

test("Fall 2025 / Spring 2026 / Summer 2026 count as intervening graduates", () => {
  assert.equal(isInterveningGraduate(2025, "FALL"), true);
  assert.equal(isInterveningGraduate("2026", "Spring"), true);
  assert.equal(isInterveningGraduate(2026, "SUMMER"), true);
  assert.equal(isInterveningGraduate(2025, "SPRING"), false);
  assert.equal(isInterveningGraduate(2025, "SUMMER"), false);
  assert.equal(isUgDegreeSeekingRow("UNDERG", "FTCA"), true);
  assert.equal(isUgDegreeSeekingRow("UNDERG", "DUAL"), false);
  assert.equal(isUgDegreeSeekingRow("GRAD", "GRAD"), false);
});
