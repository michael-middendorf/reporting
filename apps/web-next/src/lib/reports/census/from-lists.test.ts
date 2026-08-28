import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryFromStudents } from "./from-lists";
import type { CensusRawStudent } from "./lists-core";

function s(partial: Partial<CensusRawStudent>): CensusRawStudent {
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
    city: "",
    credits: 15,
    gpa: "",
    earnedCredits: 0,
    residency: "",
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

test("all-student total is every registration row; UG DS excludes dual", () => {
  const rows = [
    s({ pcid: "1" }),
    s({ pcid: "2", incomingReturning: "Returning", collegeAttend: "FTCA" }),
    s({ pcid: "3", program: "NDEG", collegeAttend: "DUAL", degree: "HSDE", fullPart: "" }),
    s({ pcid: "4", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", classLevel: "GRAD" }),
    s({ pcid: "5", program: "GRAD", collegeAttend: "GRAD", degree: "MARTS", session: "01LuxMundi" }),
    s({ pcid: "6", incomingReturning: "Returning", session: "03Ireland", sport: "Ireland" }),
  ];
  const sum = summaryFromStudents(rows);
  assert.equal(sum.totalEnrollment.headcount, 6);
  assert.equal(sum.degreeSeeking.headcount, 3);
  assert.equal(sum.newStudents.headcount, 1);
  assert.equal(sum.returning.headcount, 2);
  assert.equal(sum.ireland.headcount, 1);
  assert.equal(sum.ftca.headcount, 1);
  assert.equal(sum.dualEnrollment.headcount, 1);
  assert.equal(sum.totalGraduate.headcount, 2);
  assert.equal(sum.gradMba.headcount, 1);
  assert.equal(sum.luxMundiGrad.headcount, 1);
  assert.equal(sum.gradMa.headcount, 0, "Lux Mundi MA is not also in the MA line");
  assert.equal(sum.totalUndergraduate.headcount, 4);
});

test("Ireland and Mont Mallary are not On Campus; DE is DUAL not Chesterton", () => {
  const rows = [
    s({ pcid: "1", residency: "On Campus", incomingReturning: "Returning" }),
    s({ pcid: "2", session: "03Ireland", sport: "Ireland", residency: "Ireland", incomingReturning: "Returning" }),
    s({ pcid: "3", session: "03MM", residency: "Mont Mallary", incomingReturning: "Returning" }),
    s({ pcid: "4", program: "NDEG", collegeAttend: "DUAL", degree: "HSDE", credits: 4, fullPart: "" }),
    s({
      pcid: "5",
      program: "NDEG",
      collegeAttend: "DUAL",
      degree: "HSDE",
      curriculumName: "Chesterton",
      credits: 8,
      fullPart: "",
    }),
    s({ pcid: "6", program: "UNDERG", collegeAttend: "FTCA", curriculumName: "Chesterton", incomingReturning: "Returning" }),
    s({ pcid: "7", program: "EACOL", collegeAttend: "EACO", degree: "NONDEG" }),
  ];
  const sum = summaryFromStudents(rows);
  assert.equal(sum.onCampus.headcount, 1);
  assert.equal(sum.ireland.headcount, 1);
  assert.equal(sum.montMallary.headcount, 1);
  assert.equal(sum.dualEnrollment.headcount, 2);
  assert.equal(sum.chestertonDual.headcount, 1);
  assert.equal(sum.chesterton.headcount, 1);
  assert.equal(sum.nonDegree.headcount, 1, "EACO is not dual enrollment");
  assert.equal(sum.dualEnrollment.fte, 1); // 4/12 + 8/12
});

test("a student in UG and Lux Mundi MA counts in both, once in all-student headcount", () => {
  const rows = [
    s({ pcid: "P9", program: "UNDERG", collegeAttend: "FTCA", degree: "BARTS", session: "01", incomingReturning: "Incoming" }),
    s({
      pcid: "P9",
      program: "GRAD",
      collegeAttend: "GRAD",
      degree: "MARTS",
      session: "01LuxMundi",
      incomingReturning: "Incoming",
      fullPart: "HALF",
    }),
  ];
  const sum = summaryFromStudents(rows);
  assert.equal(sum.degreeSeeking.headcount, 1);
  assert.equal(sum.luxMundiGrad.headcount, 1);
  assert.equal(sum.totalGraduate.headcount, 1);
  assert.equal(sum.totalUndergraduate.headcount, 1);
  assert.equal(sum.totalEnrollment.headcount, 1);
});
