import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachLoaStatus,
  deriveUnretained,
  dropNonCensusSports,
  isInterveningGraduate,
  isUgDegreeSeekingRow,
  S26_LOA_ROSTER,
  type CensusRawStudent,
  type UnretainedStudent,
} from "./lists-core";
import { applyErezResidency, markIrelandReturning } from "./lists";

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
      residency: "On Campus",
      classStatus: "Freshman",
      studentType: "Incoming",
      includedInCensus: true,
    },
  ]);
  assert.equal(out[0].residency, "On Campus");
});

test("Ireland housing and 03Ireland session count as Returning for now", () => {
  const students: CensusRawStudent[] = [
    {
      pcid: "P000384251",
      first: "Katie",
      last: "Scuderi",
      incomingReturning: "Incoming",
      state: "FL",
      religion: "",
      cathGroup: "",
      ethnicity: "",
      gender: "",
      program: "UNDERG",
      collegeAttend: "TRAN",
      curriculum: "",
      curriculumName: "",
      classLevel: "Sophomore",
      fullPart: "FULL",
      city: "",
      credits: 15,
      gpa: "",
      earnedCredits: 0,
      residency: "",
      sport: "",
      athlete: "",
      athleticType: "",
      rosterStatus: "",
      honors: "",
      fsp: "",
      household: "",
      institute: "",
      marines: "",
      appDecision: "",
      session: "01",
      degree: "BARTS",
      email: "",
      citizenship: "",
      visa: "",
    },
    {
      pcid: "P000386430",
      first: "Christian",
      last: "Gontowski",
      incomingReturning: "Incoming",
      state: "FL",
      religion: "",
      cathGroup: "",
      ethnicity: "",
      gender: "",
      program: "UNDERG",
      collegeAttend: "TRAN",
      curriculum: "",
      curriculumName: "",
      classLevel: "Sophomore",
      fullPart: "FULL",
      city: "",
      credits: 15,
      gpa: "",
      earnedCredits: 0,
      residency: "",
      sport: "",
      athlete: "",
      athleticType: "",
      rosterStatus: "",
      honors: "",
      fsp: "",
      household: "",
      institute: "",
      marines: "",
      appDecision: "",
      session: "03Ireland",
      degree: "BARTS",
      email: "",
      citizenship: "",
      visa: "",
    },
  ];
  const out = markIrelandReturning(students, [
    {
      pcid: "P000384251",
      name: "Katie Scuderi",
      email: "",
      building: "CIARA",
      room: "",
      priceType: "ISTA",
      residency: "Study Abroad",
      classStatus: "",
      studentType: "Incoming",
      includedInCensus: true,
    },
  ]);
  assert.equal(out[0].incomingReturning, "Returning");
  assert.equal(out[0].residency, "Ireland");
  assert.equal(out[0].sport, "Ireland");
  assert.equal(out[0].athlete, "Athlete");
  assert.equal(out[1].incomingReturning, "Returning");
});

test("Ireland keeps an existing sport and still counts as Ireland campus", () => {
  const students: CensusRawStudent[] = [
    {
      pcid: "P2",
      first: "R",
      last: "U",
      incomingReturning: "Incoming",
      state: "FL",
      religion: "",
      cathGroup: "",
      ethnicity: "",
      gender: "Male",
      program: "UNDERG",
      collegeAttend: "FTCA",
      curriculum: "",
      curriculumName: "",
      classLevel: "Sophomore",
      fullPart: "FULL",
      city: "",
      credits: 15,
      gpa: "",
      earnedCredits: 0,
      residency: "",
      sport: "Rugby-Men",
      athlete: "Athlete",
      athleticType: "",
      rosterStatus: "",
      honors: "",
      fsp: "",
      household: "",
      institute: "",
      marines: "",
      appDecision: "",
      session: "01",
      degree: "BARTS",
      email: "",
      citizenship: "",
      visa: "",
    },
  ];
  const out = applyErezResidency(students, [
    {
      pcid: "P2",
      name: "R U",
      email: "",
      building: "MALAC",
      room: "",
      priceType: "ISTA",
      residency: "Study Abroad",
      classStatus: "",
      studentType: "Returning",
      includedInCensus: true,
    },
  ]);
  assert.equal(out[0].residency, "Ireland");
  assert.equal(out[0].sport, "Rugby-Men");
  assert.equal(out[0].incomingReturning, "Returning");
});

test("pickleball is dropped as a census sport", () => {
  const out = dropNonCensusSports([
    { pcid: "P1", sport: "Pickleball-Men", athlete: "Athlete", athleticType: "Club", rosterStatus: "Roster - Athlete" } as CensusRawStudent,
    { pcid: "P2", sport: "Football", athlete: "Athlete", athleticType: "Varsity", rosterStatus: "Roster - Athlete" } as CensusRawStudent,
  ]);
  assert.equal(out[0]?.sport, "");
  assert.equal(out[0]?.athlete, "Non-Athlete");
  assert.equal(out[1]?.sport, "Football");
  assert.equal(out[1]?.athlete, "Athlete");
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

test("S26 LOA roster marks Mondarez returned and the other six as not returned", () => {
  const enrolled: CensusRawStudent[] = [
    {
      pcid: "P000353941",
      first: "Jacob",
      last: "Mondarez",
      incomingReturning: "Returning",
      state: "VA",
      religion: "Catholic",
      cathGroup: "Catholic",
      ethnicity: "ASIAN",
      gender: "Male",
      program: "UNDERG",
      collegeAttend: "FTCA",
      curriculum: "CSCI",
      curriculumName: "Computer Science",
      classLevel: "Junior",
      fullPart: "FULL",
      city: "",
      credits: 16,
      gpa: 2.27,
      earnedCredits: 76,
      residency: "On Campus",
      sport: "Rugby-Men",
      athlete: "Athlete",
      athleticType: "",
      rosterStatus: "",
      honors: "",
      fsp: "",
      household: "",
      institute: "",
      marines: "",
      appDecision: "",
      session: "01",
      degree: "BARTS",
      email: "",
      citizenship: "",
      visa: "",
    },
  ];
  const rows = attachLoaStatus(S26_LOA_ROSTER, enrolled, []);
  assert.equal(rows.length, 7);
  assert.equal(rows.filter((r) => r.status === "Returned").length, 1);
  assert.equal(rows.find((r) => r.pcid === "P000353941")?.fa26Sport, "Rugby-Men");
  assert.equal(rows.find((r) => r.pcid === "P000385107")?.status, "Did not return");
  const grad = attachLoaStatus(S26_LOA_ROSTER, [], ["P000380327"]);
  assert.equal(grad.find((r) => r.pcid === "P000380327")?.status, "Graduated");
});

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
