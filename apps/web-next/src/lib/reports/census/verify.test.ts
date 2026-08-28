import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVerifyList } from "./verify";
import type { CensusRawStudent, UnretainedStudent } from "./lists-core";
import type { HousingAssignmentRow } from "./residency";

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
    gender: "Female",
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
    residency: "Resident",
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

function house(partial: Partial<HousingAssignmentRow>): HousingAssignmentRow {
  return {
    pcid: "P1",
    name: "A B",
    email: "",
    building: "JPII",
    room: "101",
    priceType: "UGDP",
    residency: "Resident",
    classStatus: "",
    studentType: "",
    includedInCensus: true,
    ...partial,
  };
}

test("Ireland session vs hall and housed-not-registered land on the verify list", () => {
  const rows = buildVerifyList(
    [
      raw({ pcid: "P1", first: "Pat", last: "Session", session: "03Ireland" }),
      raw({ pcid: "P2", first: "Casey", last: "Hall", session: "01", residency: "Resident" }),
    ],
    [],
    [],
    [
      house({ pcid: "P2", name: "Casey Hall", building: "CIARA", room: "", priceType: "ISTA", residency: "Study Abroad" }),
      house({ pcid: "P9", name: "Left Behind", building: "TERESA", room: "210", priceType: "UGDP" }),
    ],
  );
  assert.ok(rows.some((r) => r.pcid === "P1" && r.issue.startsWith("Ireland session")));
  assert.ok(rows.some((r) => r.pcid === "P2" && r.issue.startsWith("Ireland housing")));
  assert.ok(rows.some((r) => r.pcid === "P9" && r.issue === "Housed, not registered"));
});

test("unretained seniors and unretained-but-housed are flagged", () => {
  const left: UnretainedStudent = {
    pcid: "P3",
    first: "Sam",
    last: "Senior",
    retention: "Not Retained",
    gpa: 3.2,
    fsp: "",
    household: "",
    marines: "",
    honors: "",
    sport: "",
    state: "FL",
    gender: "Female",
    classLevel: "Senior",
    collegeAttend: "FTCA",
    incomingReturning: "Returning",
    program: "UNDERG",
  };
  const rows = buildVerifyList([], [left], [], [house({ pcid: "P3", name: "Sam Senior", building: "JPII", room: "12" })]);
  assert.ok(rows.some((r) => r.issue === "Unretained senior"));
  assert.ok(rows.some((r) => r.issue === "Unretained but still housed"));
});

test("UG plus Lux Mundi MA on the same PCID is flagged", () => {
  const rows = buildVerifyList(
    [
      raw({ pcid: "P9", first: "Dual", last: "Student", program: "UNDERG", degree: "BARTS", session: "01" }),
      raw({
        pcid: "P9",
        first: "Dual",
        last: "Student",
        program: "GRAD",
        degree: "MARTS",
        session: "01LuxMundi",
        fullPart: "HALF",
        credits: 8,
      }),
    ],
    [],
    [],
    [],
  );
  assert.equal(rows.filter((r) => r.issue === "UG and graduate programs").length, 1);
});

test("intervening graduate still on registration is flagged", () => {
  const rows = buildVerifyList(
    [raw({ pcid: "P4", first: "Grad", last: "StillHere" })],
    [],
    [{ pcid: "P4", year: 2026, term: "SPRING", program: "UNDERG" }],
    [],
  );
  assert.equal(rows[0]?.issue, "Graduate still registered");
});
