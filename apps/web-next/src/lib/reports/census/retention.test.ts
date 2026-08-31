import assert from "node:assert/strict";
import { test } from "node:test";
import type { CensusRawStudent } from "./lists";
import { buildFtcaAttritionFromPrior, buildSportRetention, catholicOf, deriveFtcaRaw, isCatholic, isFtcaIncoming } from "./retention";

function prior(partial: Partial<CensusRawStudent>): CensusRawStudent {
  return {
    pcid: "P1",
    first: "A",
    last: "B",
    incomingReturning: "Incoming",
    state: "FL",
    religion: "Catholic",
    cathGroup: "Catholic",
    ethnicity: "WHITE",
    gender: "Male",
    program: "UNDERG",
    collegeAttend: "FTCA",
    curriculum: "BIOLOG",
    curriculumName: "Biology",
    classLevel: "Freshman",
    fullPart: "FULL",
    city: "",
    credits: 15,
    gpa: 3.1,
    earnedCredits: 0,
    residency: "Resident",
    sport: "Football",
    athlete: "Athlete",
    athleticType: "Varsity",
    rosterStatus: "Roster - Athlete",
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

test("Non-Catholic is not counted as Catholic", () => {
  assert.equal(isCatholic({ religion: "Catholic" }), true);
  assert.equal(isCatholic({ religion: "Eastern Rite Catholic" }), true);
  assert.equal(isCatholic({ religion: "Christian" }), false);
  assert.equal(isCatholic({ religion: "Other" }), false);
  assert.equal(isCatholic({ cathGroup: "Non-Catholic", religion: "" }), false);
  assert.equal(isCatholic({ cathGroup: "Catholic", religion: "" }), true);
  assert.equal(catholicOf({ cathGroup: "Non-Catholic" }), "Non-Catholic");
  assert.equal(catholicOf({ religion: "Eastern Rite Catholic" }), "Catholic");
});

test("FTCA raw marks left students Not Retained using the FA25 sport", () => {
  const rows = deriveFtcaRaw(
    [prior({ pcid: "P1", sport: "Football" }), prior({ pcid: "P2", sport: "Volleyball", gender: "Female" })],
    [prior({ pcid: "P2", sport: "Volleyball" })],
    [],
  );
  assert.equal(rows.find((r) => r.pcid === "P1")?.retained, "Not Retained");
  assert.equal(rows.find((r) => r.pcid === "P1")?.fa25Sport, "Football");
  assert.equal(rows.find((r) => r.pcid === "P2")?.retained, "Retained");
});

test("sport retention charges leavers to their Fall 2025 sport", () => {
  const rows = buildSportRetention(
    [
      prior({ pcid: "P1", sport: "Football" }),
      prior({ pcid: "P2", sport: "Football" }),
      prior({ pcid: "P3", sport: "Volleyball" }),
    ],
    ["P2"],
    [{ pcid: "P3", year: 2026, term: "SPRING" }],
  );
  const fb = rows.find((r) => r.sport === "Football");
  assert.equal(fb?.roster, 2);
  assert.equal(fb?.notRetained, 1);
  assert.equal(fb?.retained, 1);
  const vb = rows.find((r) => r.sport === "Volleyball");
  assert.equal(vb?.graduated, 1);
  assert.equal(vb?.notRetained, 0);
});

test("FTCA raw keeps Incoming+FTCA only, not returning FTCA", () => {
  const rows = deriveFtcaRaw(
    [
      prior({ pcid: "P1", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
      prior({ pcid: "P2", incomingReturning: "Returning", collegeAttend: "FTCA" }),
      prior({ pcid: "P3", incomingReturning: "Incoming", collegeAttend: "TRAN" }),
    ],
    [],
    [],
  );
  assert.deepEqual(
    rows.map((r) => r.pcid),
    ["P1"],
  );
  assert.equal(isFtcaIncoming(prior({ incomingReturning: "Incoming", collegeAttend: "FTCA" })), true);
  assert.equal(isFtcaIncoming(prior({ incomingReturning: "Returning", collegeAttend: "FTCA" })), false);
});

test("FTCA attrition cohort is Incoming+FTCA", () => {
  const a = buildFtcaAttritionFromPrior(
    [
      prior({ pcid: "P1", incomingReturning: "Incoming", collegeAttend: "FTCA" }),
      prior({ pcid: "P2", incomingReturning: "Returning", collegeAttend: "FTCA" }),
      prior({ pcid: "P3", incomingReturning: "Incoming", collegeAttend: "TRAN" }),
    ],
    ["P1"],
    [],
  );
  assert.equal(a.cohort, 1);
  assert.equal(a.enrolledThisFall, 1);
  assert.equal(a.notRetained, 0);
});

test("pickleball is omitted from sport retention", () => {
  const rows = buildSportRetention(
    [prior({ pcid: "P1", sport: "Pickleball-Men" }), prior({ pcid: "P2", sport: "Football" })],
    [],
    [],
  );
  assert.equal(rows.some((r) => /pickle/i.test(r.sport)), false);
  assert.equal(rows[0]?.sport, "Football");
});

test("hiding a sport drops it from retention totals", () => {
  const rows = buildSportRetention(
    [prior({ pcid: "P1", sport: "Football" }), prior({ pcid: "P2", sport: "Volleyball" })],
    [],
    [],
    ["Football"],
  );
  assert.equal(rows.some((r) => r.sport === "Football"), false);
  assert.equal(rows[0]?.sport, "Volleyball");
});
