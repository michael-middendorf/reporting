import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachLoaStatus,
  deriveUnretained,
  dropNonCensusSports,
  isInterveningGraduate,
  isUgDegreeSeekingRow,
  withoutFootballPlayers,
  S26_LOA_ROSTER,
  type CensusRawStudent,
  type UnretainedStudent,
} from "./lists-core";
import { applyErezResidency, markIrelandReturning, promoteFormerDualFtca, resolveCensusResidency } from "./lists";

test("eRez On Campus / Commuter wins over registration Res Comm", () => {
  const student = {
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
    residency: "On Campus",
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
    degree: "",
    email: "",
    citizenship: "",
    visa: "",
  };
  const house = {
    pcid: "P1",
    name: "A B",
    email: "",
    building: "Commuter",
    room: "",
    priceType: "NODM",
    residency: "Commuter" as const,
    classStatus: "Freshman",
    studentType: "Incoming",
    includedInCensus: true,
  };
  assert.equal(applyErezResidency([student], [house])[0].residency, "Commuter");
});

test("registration Ireland is not overwritten by eRez commuter or hall", () => {
  const student = {
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
    classLevel: "Sophomore",
    fullPart: "FULL",
    city: "",
    credits: 15,
    gpa: "",
    earnedCredits: 0,
    residency: "Ireland",
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
    degree: "",
    email: "",
    citizenship: "",
    visa: "",
  };
  const house = {
    pcid: "P1",
    name: "A B",
    email: "",
    building: "JPII",
    room: "101",
    priceType: "UGDP",
    residency: "On Campus" as const,
    classStatus: "",
    studentType: "Returning",
    includedInCensus: true,
  };
  assert.equal(applyErezResidency([student], [house])[0].residency, "Mount Melleray Abbey");
});

test("eRez Other does not wipe registration Commuter; blank both is Unassigned", () => {
  const base = {
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
    residency: "Commuter",
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
    degree: "",
    email: "",
    citizenship: "",
    visa: "",
  };
  const other = {
    pcid: "P1",
    name: "A B",
    email: "",
    building: "",
    room: "",
    priceType: "",
    residency: "Other" as const,
    classStatus: "",
    studentType: "",
    includedInCensus: true,
  };
  assert.equal(applyErezResidency([base], [other])[0].residency, "Commuter");
  assert.equal(resolveCensusResidency({ ...base, residency: "" }), "Unassigned");
  assert.equal(
    applyErezResidency([{ ...base, residency: "" }], [
      { ...other, building: "TERESA", room: "210", priceType: "UGDP", residency: "On Campus" },
    ])[0].residency,
    "On Campus",
  );
});

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
  assert.equal(out[0].residency, "Mount Melleray Abbey");
  assert.equal(out[0].sport, "");
  assert.notEqual(out[0].athlete, "Athlete");
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
  assert.equal(out[0].residency, "Mount Melleray Abbey");
  assert.equal(out[0].sport, "Rugby-Men");
  assert.equal(out[0].incomingReturning, "Returning");
});

test("pickleball and Ireland are dropped as census sports", () => {
  const out = dropNonCensusSports([
    { pcid: "P1", sport: "Pickleball-Men", athlete: "Athlete", athleticType: "Club", rosterStatus: "Roster - Athlete" } as CensusRawStudent,
    { pcid: "P2", sport: "Football", athlete: "Athlete", athleticType: "Varsity", rosterStatus: "Roster - Athlete" } as CensusRawStudent,
    { pcid: "P3", sport: "Ireland", athlete: "Athlete", athleticType: "", rosterStatus: "" } as CensusRawStudent,
  ]);
  assert.equal(out[0]?.sport, "");
  assert.equal(out[0]?.athlete, "Non-Athlete");
  assert.equal(out[1]?.sport, "Football");
  assert.equal(out[1]?.athlete, "Athlete");
  assert.equal(out[2]?.sport, "");
  assert.equal(out[2]?.athlete, "Non-Athlete");
});

test("withoutFootballPlayers drops Football and keeps other sports", () => {
  const out = withoutFootballPlayers([
    { pcid: "P1", sport: "Football" } as CensusRawStudent,
    { pcid: "P2", sport: "Volleyball" } as CensusRawStudent,
    { pcid: "P3", sport: "" } as CensusRawStudent,
  ]);
  assert.deepEqual(out.map((s) => s.pcid), ["P2", "P3"]);
});

test("freshman FTCA who were dual enrollment last year count as Incoming", () => {
  const current = [
    { pcid: "P1", collegeAttend: "FTCA", classLevel: "Freshman", incomingReturning: "Returning", program: "UNDERG" } as CensusRawStudent,
    { pcid: "P2", collegeAttend: "FTCA", classLevel: "Freshman", incomingReturning: "Returning", program: "UNDERG" } as CensusRawStudent,
    { pcid: "P3", collegeAttend: "TRAN", classLevel: "Freshman", incomingReturning: "Returning", program: "UNDERG" } as CensusRawStudent,
  ];
  const prior = [
    { pcid: "P1", collegeAttend: "DUAL", program: "NDEG" } as CensusRawStudent,
    { pcid: "P2", collegeAttend: "FTCA", program: "UNDERG" } as CensusRawStudent,
    { pcid: "P3", collegeAttend: "DUAL", program: "NDEG" } as CensusRawStudent,
  ];
  const out = promoteFormerDualFtca(current, prior);
  assert.equal(out[0]?.incomingReturning, "Incoming");
  assert.equal(out[1]?.incomingReturning, "Returning", "repeat freshman who were UG last year stay Returning");
  assert.equal(out[2]?.incomingReturning, "Returning", "former DE who are TRAN are not the FTCA exception");
});

test("Rugby-Women is men's rugby associated, not a women's team", () => {
  const out = dropNonCensusSports([
    { pcid: "P1", sport: "Rugby-Women", athlete: "Athlete", athleticType: "Manager/Student Coach", rosterStatus: "Roster - Athletic Associated" } as CensusRawStudent,
    { pcid: "P2", sport: "Rugby-Men", athlete: "Athlete", athleticType: "Non-NAIA", rosterStatus: "Roster - Athlete" } as CensusRawStudent,
  ]);
  assert.equal(out[0]?.sport, "Rugby-Men");
  assert.equal(out[0]?.athlete, "Athlete");
  assert.equal(out[0]?.athleticType, "Manager/Student Coach");
  assert.equal(out[1]?.sport, "Rugby-Men");
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
