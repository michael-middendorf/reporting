import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachLoaStatus,
  deriveUnretained,
  dropNonCensusSports,
  isInterveningGraduate,
  censusAthleticTypeCategory,
  censusRawAthleteFlag,
  isTeamAthlete,
  isUgDegreeSeekingRow,
  withoutFootballPlayers,
  S26_LOA_ROSTER,
  type CensusRawStudent,
  type UnretainedStudent,
} from "./lists-core";
import { applyErezResidency, markIrelandReturning, markSpringAdmitsReturning, promoteFormerDualFtca, resolveCensusResidency } from "./lists";
import {
  applyCensusRetentionNotes,
  isDroppedAfterCensus,
  isOutOfRetentionCohort,
  loaStudentsFromNotes,
  markUnretainedNotes,
  mergeLoaRosters,
  omitLeaveOfAbsence,
  RETENTION_LOA,
} from "./retention-overrides";

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

test("spring admits stay Returning on the fall census", () => {
  const current = [
    {
      pcid: "P1",
      collegeAttend: "FTCA",
      classLevel: "Freshman",
      incomingReturning: "Incoming",
      admitTerm: "Spring 2026",
      program: "UNDERG",
    } as CensusRawStudent,
    {
      pcid: "P2",
      collegeAttend: "FTCA",
      classLevel: "Sophomore",
      incomingReturning: "Incoming",
      admitTerm: "Fall 2026",
      program: "UNDERG",
    } as CensusRawStudent,
  ];
  const promoted = promoteFormerDualFtca(current, []);
  assert.equal(promoted[0]?.incomingReturning, "Incoming", "promote leaves spring Incoming until markSpring");
  const out = markSpringAdmitsReturning(promoted);
  assert.equal(out[0]?.incomingReturning, "Returning");
  assert.equal(out[1]?.incomingReturning, "Incoming", "fall FTCA sophomore stays Incoming");
});

test("team athletes are Varsity / Non-Varsity / Non-NAIA only; managers and band are associated", () => {
  assert.equal(isTeamAthlete({ sport: "Football", athleticType: "Varsity" }), true);
  assert.equal(isTeamAthlete({ sport: "Football", athleticType: "Non-Varsity" }), true);
  assert.equal(isTeamAthlete({ sport: "Rugby-Men", athleticType: "Non-NAIA" }), true);
  assert.equal(isTeamAthlete({ sport: "Football", athleticType: "Manager/Student Coach" }), false);
  assert.equal(isTeamAthlete({ sport: "Football", athleticType: "", rosterStatus: "Roster - Athletic Associated" }), false);
  assert.equal(isTeamAthlete({ sport: "Football", athleticType: "Varsity", rosterStatus: "Roster - Athletic Associated" }), false);
  assert.equal(isTeamAthlete({ sport: "Band", athleticType: "Non-Varsity", rosterStatus: "Roster - Athletic Associated" }), false);
  assert.equal(isTeamAthlete({ sport: "Football", athleticType: "" }), false, "blank FA25 status is a manager, not a player");
  assert.equal(isTeamAthlete({ sport: "Ireland", athleticType: "" }), false);
  assert.equal(censusRawAthleteFlag({ sport: "Football", athleticType: "Varsity" }), "Athlete");
  assert.equal(censusRawAthleteFlag({ sport: "Football", athleticType: "Manager/Student Coach" }), "Non-Athlete");
  assert.equal(censusRawAthleteFlag({ sport: "Band", rosterStatus: "Roster - Athletic Associated" }), "Non-Athlete");
  assert.equal(censusAthleticTypeCategory({ athleticType: "Varsity" }), "Varsity");
  assert.equal(censusAthleticTypeCategory({ sport: "Band", athleticType: "" }), "Band");
  assert.equal(censusAthleticTypeCategory({ sport: "", athleticType: "" }), "None");
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

function rawPrior(pcid: string): CensusRawStudent {
  return { pcid } as CensusRawStudent;
}

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

test("unretained notes take graduates, LOA, and exclude/force-retained off All Not Retained", () => {
  assert.equal(RETENTION_LOA.size, 5);
  assert.equal(RETENTION_LOA.has("P000344532"), false, "Derrick Guza is not retained, not LOA");
  const tagged = markUnretainedNotes([
    prior("P000346188", { first: "Sophia", last: "Gomez" }),
    prior("P1"),
  ]);
  assert.equal(tagged.find((s) => s.pcid === "P000346188")?.retention, "Leave of Absence");
  assert.equal(tagged.find((s) => s.pcid === "P1")?.retention, "");
  const notes = applyCensusRetentionNotes(
    [
      rawPrior("P000384377"), // Aiden — exclude
      rawPrior("P000346188"), // Gomez — LOA
      rawPrior("P000352989"), // Trumpore — force retained
      rawPrior("P000347161"), // Berns — summer graduate
      rawPrior("P1"),
    ],
    [],
    [],
  );
  assert.deepEqual(
    notes.prior.map((s) => s.pcid).sort(),
    ["P000346188", "P000347161", "P000352989", "P1"].sort(),
  );
  assert.equal(isDroppedAfterCensus("P000384377"), true, "Aiden is out of Historical counts");
  assert.equal(isDroppedAfterCensus("P000378273"), false, "Hannah stays in Historical UG");
  assert.equal(isOutOfRetentionCohort("P000384377"), true, "Aiden is out of the denominator");
  assert.equal(isOutOfRetentionCohort("P000378273"), true, "Hannah is out of the denominator");
  assert.equal(isOutOfRetentionCohort("P000346188"), false, "LOA stays in the FA25 total");
  assert.equal(notes.currentIds.includes("P000352989"), true);
  assert.equal(
    notes.graduates.some((g) => g.pcid === "P000347161"),
    true,
  );
  const left = omitLeaveOfAbsence(
    deriveUnretained(
      notes.prior.map((s) => prior(s.pcid)),
      notes.currentIds,
      notes.graduates.map((g) => g.pcid),
    ),
  );
  assert.deepEqual(
    left.map((s) => s.pcid),
    ["P1"],
  );
  const fall = loaStudentsFromNotes([
    {
      pcid: "P000346188",
      first: "Sophia",
      last: "Gomez",
      incomingReturning: "Returning",
      state: "GA",
      religion: "Catholic",
      cathGroup: "Catholic",
      ethnicity: "WHITE",
      gender: "Female",
      program: "UNDERG",
      collegeAttend: "FTCA",
      curriculum: "EXPHYS",
      curriculumName: "Exercise Physiology",
      classLevel: "Junior",
      fullPart: "FULL",
      city: "",
      credits: 16,
      gpa: 2.29,
      earnedCredits: 0,
      residency: "On Campus",
      sport: "",
      athlete: "Non-Athlete",
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
  ]);
  assert.equal(fall[0]?.term, "Fall 2026");
  const merged = mergeLoaRosters(S26_LOA_ROSTER, fall);
  assert.equal(merged.filter((s) => s.pcid === "P000346188").length, 1);
  assert.equal(merged.length, S26_LOA_ROSTER.length + 1);
});

test("Fall 2026 LOA notes are the five intend-to-return students", () => {
  assert.equal(S26_LOA_ROSTER.some((s) => s.pcid === "P000380481"), true);
  assert.equal(S26_LOA_ROSTER.some((s) => s.pcid === "P000341593"), false, "Earnhardt is FA26 LOA only");
  const fall = loaStudentsFromNotes([
    rawPrior("P000380481"),
    rawPrior("P000341593"),
    rawPrior("P000346188"),
    rawPrior("P1"),
  ]);
  assert.deepEqual(
    fall.map((s) => s.pcid).sort(),
    ["P000341593", "P000346188", "P000380481"],
  );
  assert.equal(fall.every((s) => s.term === "Fall 2026"), true);
});

test("unretained is last census minus graduates minus this-term registration", () => {
  const rows = deriveUnretained(
    [
      prior("P1"),
      prior("P2"),
      prior("P3"),
      prior("P4", { program: "GRAD", collegeAttend: "GRAD" }),
      prior("P5", { program: "GRAD", collegeAttend: "GRAD" }),
    ],
    ["P2", "p4"],
    ["P3"],
  );
  assert.deepEqual(
    rows.map((r) => r.pcid),
    ["P1"],
  );
  assert.equal(rows[0].retention, "Not Retained");
  assert.equal(rows.some((r) => r.pcid === "P5"), false, "graduate program leavers are not All Not Retained");
});

test("Fall 2025 / Spring 2026 / Summer 2026 count as intervening graduates", () => {
  assert.equal(isInterveningGraduate(2025, "FALL"), true);
  assert.equal(isInterveningGraduate("2026", "Spring"), true);
  assert.equal(isInterveningGraduate(2026, "SUMMER"), true);
  assert.equal(isInterveningGraduate(2025, "SPRING"), false);
  assert.equal(isInterveningGraduate(2025, "SUMMER"), false);
  assert.equal(isInterveningGraduate(2025, "SPRING", "2025-12-13"), true, "December conferral is Fall, not extract Spring");
  assert.equal(isInterveningGraduate("", "", "2026-05-06"), true, "May commencement with blank term is Spring 2026");
  assert.equal(isInterveningGraduate(2025, "SPRING", "2025-05-10"), false);
  assert.equal(isUgDegreeSeekingRow("UNDERG", "FTCA"), true);
  assert.equal(isUgDegreeSeekingRow("UNDERG", "DUAL"), false);
  assert.equal(isUgDegreeSeekingRow("GRAD", "GRAD"), false);
  assert.equal(isUgDegreeSeekingRow("GRAD", "GRAD", "BARTS"), true, "dual BA coded GRAD still UG");
  assert.equal(isUgDegreeSeekingRow("GRAD", "GRAD", "MBA"), false);
});
