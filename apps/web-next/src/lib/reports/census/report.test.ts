import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FILTERS,
  buildReport,
  filterStudents,
  projectReportStudents,
  type ReportStudent,
} from "./report";
import type { CensusRawStudent } from "./lists";

function raw(partial: Partial<CensusRawStudent>): CensusRawStudent {
  return {
    pcid: "P1",
    first: "A",
    last: "B",
    incomingReturning: "Incoming",
    state: "FL",
    religion: "Catholic",
    cathGroup: "Catholic",
    ethnicity: "WHITE",
    gender: "Female",
    program: "UNDERG",
    collegeAttend: "FTCA",
    curriculum: "BIOLOG",
    curriculumName: "Biology",
    classLevel: "Freshman",
    fullPart: "FULL",
    city: "Naples",
    credits: 15,
    gpa: "",
    earnedCredits: 0,
    residency: "Resident",
    sport: "",
    athlete: "Non-Athlete",
    honors: "",
    fsp: "",
    household: "",
    institute: "",
    marines: "",
    appDecision: "ACCT",
    session: "01",
    degree: "BARTS",
    email: "",
    citizenship: "",
    visa: "",
    ...partial,
  };
}

function set(rows: CensusRawStudent[]): ReportStudent[] {
  return projectReportStudents(rows);
}

test("default degree filter is UG degree-seeking, dual enrollment is out", () => {
  const rows = set([
    raw({ pcid: "1" }),
    raw({ pcid: "2", collegeAttend: "DUAL", degree: "HSDE", program: "UNDERG" }),
    raw({ pcid: "3", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", classLevel: "GRAD" }),
  ]);
  const ug = filterStudents(rows, DEFAULT_FILTERS);
  assert.equal(ug.length, 1);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "all" }).length, 3);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "grad" }).length, 1);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "dual" }).length, 1);
});

test("excluding a sport removes those students from every table", () => {
  const rows = set([
    raw({ pcid: "1", athlete: "Athlete", sport: "Football", gender: "Male" }),
    raw({ pcid: "2", athlete: "Athlete", sport: "Volleyball", gender: "Female" }),
    raw({ pcid: "3", athlete: "Non-Athlete", sport: "" }),
  ]);
  const filtered = filterStudents(rows, { ...DEFAULT_FILTERS, excludedSports: ["Football"] });
  assert.equal(filtered.length, 2);
  const rpt = buildReport(filtered);
  assert.equal(rpt.n, 2);
  assert.equal(rpt.sports.some((s) => s.label === "Football"), false);
  assert.equal(rpt.gender.find((g) => g.label === "Male")?.n, undefined);
});

test("gender, athlete, and major filters stack", () => {
  const rows = set([
    raw({ gender: "Female", athlete: "Athlete", sport: "Softball", curriculumName: "Biology" }),
    raw({ gender: "Female", athlete: "Non-Athlete", curriculumName: "Biology" }),
    raw({ gender: "Male", athlete: "Athlete", sport: "Baseball", curriculumName: "Business" }),
  ]);
  const filtered = filterStudents(rows, {
    ...DEFAULT_FILTERS,
    gender: "Female",
    athlete: "Athlete",
    majors: ["Biology"],
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].sport, "Softball");
});

test("class level includes incoming; residency splits male/female", () => {
  const rows = set([
    raw({ gender: "Female", classLevel: "Freshman", incomingReturning: "Incoming", residency: "Resident" }),
    raw({ gender: "Male", classLevel: "Senior", incomingReturning: "Returning", residency: "Commuter", fullPart: "FULL" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  const fr = rpt.classLevel.find((r) => r.label === "Freshman");
  assert.equal(fr?.incoming, 1);
  const res = rpt.residency.find((r) => r.label === "Resident");
  assert.equal(res?.female, 1);
  assert.equal(res?.male, 0);
});

test("country percentages are of international students, like the FA25 sheet", () => {
  const rows = set([
    raw({ pcid: "1", citizenship: "" }),
    raw({ pcid: "2", citizenship: "CAN" }),
    raw({ pcid: "3", citizenship: "CAN" }),
    raw({ pcid: "4", citizenship: "SPAIN" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  const canada = rpt.countries.find((r) => r.label === "Canada");
  assert.equal(canada?.n, 2);
  assert.equal(canada?.pct, 2 / 3);
});

test("sports are A–Z; athlete tables list Athlete before Non-Athlete", () => {
  const rows = set([
    raw({ pcid: "1", athlete: "Athlete", sport: "Volleyball" }),
    raw({ pcid: "2", athlete: "Athlete", sport: "Football" }),
    raw({ pcid: "3", athlete: "Non-Athlete", sport: "" }),
    raw({ pcid: "4", athlete: "Non-Athlete", sport: "" }),
    raw({ pcid: "5", athlete: "Non-Athlete", sport: "" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  assert.deepEqual(
    rpt.sports.map((r) => r.label),
    ["Football", "Volleyball"],
  );
  assert.deepEqual(
    rpt.athlete.map((r) => r.label),
    ["Athlete", "Non-Athlete"],
  );
});

test("B.A. vs B.S. degree type", () => {
  const rows = set([
    raw({ degree: "BARTS" }),
    raw({ degree: "BSCIEN", curriculumName: "Biology" }),
  ]);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "BA" }).length, 1);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "BS" }).length, 1);
});
