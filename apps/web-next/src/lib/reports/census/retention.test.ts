import assert from "node:assert/strict";
import { test } from "node:test";
import type { CensusRawStudent } from "./lists";
import { buildSportRetention, deriveFtcaRaw } from "./retention";

function prior(partial: Partial<CensusRawStudent>): CensusRawStudent {
  return {
    pcid: "P1",
    first: "A",
    last: "B",
    incomingReturning: "Returning",
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
