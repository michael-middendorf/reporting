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

test("B.A. vs B.S. degree type", () => {
  const rows = set([
    raw({ degree: "BARTS" }),
    raw({ degree: "BSCIEN", curriculumName: "Biology" }),
  ]);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "BA" }).length, 1);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "BS" }).length, 1);
});
