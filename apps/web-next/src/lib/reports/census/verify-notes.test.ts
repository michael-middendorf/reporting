import assert from "node:assert/strict";
import { test } from "node:test";
import { applyErezResidency, markIrelandReturning, markSpringAdmitsReturning } from "./lists";
import type { CensusRawStudent } from "./lists-core";
import { applyCensusVerifyNotes, omitExcludedHousing } from "./verify-notes";
import { buildFtcaAttritionFromPrior } from "./retention";
import { buildVerifyList } from "./verify";

function raw(partial: Partial<CensusRawStudent>): CensusRawStudent {
  return {
    pcid: "P1",
    first: "A",
    last: "B",
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
    classLevel: "Senior",
    fullPart: "FULL",
    city: "",
    credits: 15,
    gpa: "",
    earnedCredits: 0,
    residency: "Unassigned",
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
    ...partial,
  };
}

test("verify notes set Trumpore off-campus; Shephard stays Ireland", () => {
  const students = [
    raw({ pcid: "P000352989", first: "Andrew", last: "Trumpore", residency: "Unassigned" }),
    raw({
      pcid: "P000355002",
      first: "Sebastian",
      last: "Shephard",
      session: "03Ireland",
      residency: "Ireland",
    }),
  ];
  const afterIreland = markIrelandReturning(applyErezResidency(students, []), []);
  assert.equal(afterIreland[1]?.residency, "Mount Melleray Abbey");
  const out = applyCensusVerifyNotes(afterIreland);
  assert.equal(out[0]?.residency, "Commuter");
  assert.equal(out[1]?.residency, "Mount Melleray Abbey");
  assert.equal(out[1]?.incomingReturning, "Returning");
});

test("Snyder Incoming freshman with blank College Attend is FTCA", () => {
  const out = applyCensusVerifyNotes([
    raw({
      pcid: "P000384840",
      first: "Michael",
      last: "Snyder",
      collegeAttend: "",
      incomingReturning: "Incoming",
      classLevel: "Freshman",
      curriculum: "PREED",
    }),
  ]);
  assert.equal(out[0]?.collegeAttend, "FTCA");
  assert.equal(out[0]?.incomingReturning, "Incoming");
  assert.equal(out[0]?.classLevel, "Freshman");
});

test("O'Connor Incoming SECB with blank Class is Freshman like the other SECB", () => {
  const out = applyCensusVerifyNotes([
    raw({
      pcid: "P000389994",
      first: "John",
      last: "O'Connor",
      collegeAttend: "SECB",
      incomingReturning: "Incoming",
      classLevel: "",
      credits: 0,
      fullPart: "",
    }),
  ]);
  assert.equal(out[0]?.classLevel, "Freshman");
});

test("Peloso is rugby; Rodriguez graduate row is dropped", () => {
  const out = applyCensusVerifyNotes([
    raw({ pcid: "P000382172", first: "Christopher", last: "Peloso", sport: "Ultimate Frisbee" }),
    raw({ pcid: "P000390750", first: "Arianna", last: "Rodriguez", program: "UNDERG" }),
    raw({ pcid: "P000390750", first: "Arianna", last: "Rodriguez", program: "GRAD", session: "01LuxMundi" }),
  ]);
  assert.equal(out.find((s) => s.pcid === "P000382172")?.sport, "Rugby-Men");
  assert.equal(out.filter((s) => s.pcid === "P000390750").length, 1);
  assert.equal(out.find((s) => s.pcid === "P000390750")?.program, "UNDERG");
});

test("verify notes count new-program graduates as Incoming even if spring/summer starters", () => {
  const students = markSpringAdmitsReturning([
    raw({
      pcid: "P000343257",
      first: "Lily",
      last: "Verburgt",
      program: "GRAD",
      collegeAttend: "GRAD",
      degree: "MBA",
      incomingReturning: "Incoming",
      admitTerm: "Spring 2026",
      residency: "Commuter",
    }),
    raw({
      pcid: "P000346145",
      first: "Michael",
      last: "Kelly",
      program: "GRAD",
      collegeAttend: "GRAD",
      degree: "MBA",
      incomingReturning: "Returning",
      residency: "Commuter",
    }),
    raw({
      pcid: "P000349612",
      first: "Wesley",
      last: "From",
      program: "GRAD",
      collegeAttend: "GRAD",
      degree: "MBA",
      incomingReturning: "Returning",
      residency: "Commuter",
    }),
  ]);
  assert.equal(students[0]?.incomingReturning, "Returning");
  const out = applyCensusVerifyNotes(students);
  assert.equal(out[0]?.incomingReturning, "Incoming");
  assert.equal(out[1]?.incomingReturning, "Returning");
  assert.equal(out[2]?.incomingReturning, "Incoming");
});

test("US missing state fills from the incoming extract; Canadians stay blank", () => {
  const out = applyCensusVerifyNotes(
    [
      raw({ pcid: "P000384823", first: "Maya", last: "Bassi", state: "-", incomingReturning: "Incoming" }),
      raw({ pcid: "P000384774", first: "Zachary", last: "Szymakowski", state: "", incomingReturning: "Incoming" }),
    ],
    { incomingNotes: false },
  );
  assert.equal(out.find((s) => s.pcid === "P000384823")?.state, "-", "Welland ON is international, not a US state");
  assert.equal(out.find((s) => s.pcid === "P000384774")?.state, "UT");
});

test("incoming notes do not rewrite last year's FTCA cohort", () => {
  const fa25 = [
    raw({
      pcid: "P000343255",
      first: "Ivy",
      last: "Verburgt",
      incomingReturning: "Returning",
      collegeAttend: "FTCA",
      classLevel: "Senior",
    }),
    raw({
      pcid: "P000380001",
      first: "New",
      last: "Ftca",
      incomingReturning: "Incoming",
      collegeAttend: "FTCA",
      classLevel: "Freshman",
    }),
  ];
  const prior = applyCensusVerifyNotes(fa25, { incomingNotes: false });
  assert.equal(prior.find((s) => s.pcid === "P000343255")?.incomingReturning, "Returning");
  const a = buildFtcaAttritionFromPrior(prior, ["P000380001"], []);
  assert.equal(a.cohort, 1);
});

test("Pankratz is dropped from census housing after the verify note", () => {
  const kept = omitExcludedHousing([
    { pcid: "P000382666", building: "TERESA" },
    { pcid: "P000355002", building: "Commuter" },
  ]);
  assert.deepEqual(
    kept.map((r) => r.pcid),
    ["P000355002"],
  );
});

test("Ireland session flagged as commuter is off the verify list", () => {
  const flagged = buildVerifyList(
    [raw({ pcid: "P1", session: "03Ireland", residency: "Mount Melleray Abbey" })],
    [],
    [],
    [],
  );
  assert.ok(flagged.some((r) => r.issue === "Ireland session, not Ireland housing"));
  const resolved = buildVerifyList(
    [raw({ pcid: "P000355002", first: "Sebastian", last: "Shephard", session: "03Ireland", residency: "Commuter" })],
    [],
    [],
    [],
  );
  assert.equal(
    resolved.some((r) => r.issue === "Ireland session, not Ireland housing"),
    false,
  );
});
