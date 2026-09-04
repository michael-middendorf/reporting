import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRegistrationTotals, buildGraduateEnrollment, meanPositive, summerGraduateCounts, sumCredits, summaryFromStudents } from "./from-lists";
import { markSpringAdmitsReturning, promoteFormerDualFtca } from "./lists";
import snapshot from "./snapshot.json";
import type { CensusRawStudent } from "./lists-core";
import { applyCensusVerifyNotes } from "./verify-notes";

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

test("credit totals and Catholic % ignore Non-Catholic labels", () => {
  const rows = [
    s({ pcid: "1", religion: "Catholic", cathGroup: "Catholic", credits: 15 }),
    s({ pcid: "2", religion: "Christian", cathGroup: "Non-Catholic", credits: 16, incomingReturning: "Returning" }),
    s({ pcid: "3", religion: "Eastern Rite Catholic", cathGroup: "Catholic", credits: 12, incomingReturning: "Returning" }),
    s({ pcid: "4", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", credits: 6, religion: "Catholic" }),
  ];
  assert.equal(sumCredits(rows), 49);
  const data = applyRegistrationTotals(structuredClone(snapshot), rows);
  assert.equal(data.kpis.pctCatholic, 2 / 3);
  assert.equal(data.kpis.ugCredits, 43);
  assert.equal(data.kpis.totalCredits, 49);
});

test("all-student total is every registration row; UG DS excludes dual", () => {
  const rows = [
    s({ pcid: "1" }),
    s({ pcid: "2", incomingReturning: "Returning", collegeAttend: "FTCA" }),
    s({ pcid: "3", program: "NDEG", collegeAttend: "DUAL", degree: "HSDE", fullPart: "" }),
    s({ pcid: "4", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", classLevel: "GRAD" }),
    s({ pcid: "5", program: "GRAD", collegeAttend: "GRAD", degree: "MARTS", session: "01LuxMundi" }),
    s({ pcid: "6", incomingReturning: "Returning", session: "03Ireland", residency: "Ireland" }),
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
  assert.equal(sum.gradMa.headcount, 0, "Lux Mundi MA is not also in campus MA Theology");
  assert.equal(sum.totalUndergraduate.headcount, 4);
});

test("Snyder college note is Incoming FTCA, not Other", () => {
  const rows = applyCensusVerifyNotes([
    s({ pcid: "P000384840", collegeAttend: "", incomingReturning: "Incoming", classLevel: "Freshman" }),
    s({ pcid: "P2", collegeAttend: "TRAN", incomingReturning: "Incoming" }),
  ]);
  const sum = summaryFromStudents(rows);
  assert.equal(sum.ftca.headcount, 1);
  assert.equal(sum.tran.headcount, 1);
  assert.equal(sum.newOther?.headcount, 0);
  assert.equal(sum.newStudents.headcount, 2);
});

test("Summary FTCA is Incoming+FTCA any class and excludes spring admits", () => {
  const rows = markSpringAdmitsReturning([
    s({ pcid: "P1", collegeAttend: "FTCA", classLevel: "Sophomore", incomingReturning: "Incoming" }),
    s({ pcid: "P2", collegeAttend: "FTCA", classLevel: "Freshman", incomingReturning: "Incoming", admitTerm: "Spring 2026" }),
    s({ pcid: "P3", collegeAttend: "TRAN", classLevel: "Freshman", incomingReturning: "Incoming" }),
    s({ pcid: "P4", collegeAttend: "FTCA", classLevel: "Freshman", incomingReturning: "Returning" }),
  ]);
  const sum = summaryFromStudents(rows);
  assert.equal(sum.ftca.headcount, 1);
  assert.equal(sum.newStudents.headcount, 2);
  assert.equal(sum.returning.headcount, 2);
  assert.equal(sum.tran.headcount, 1);
});

test("Summary FTCA includes freshman who were dual enrollment last year", () => {
  const rows = promoteFormerDualFtca(
    [
      s({ pcid: "P1", collegeAttend: "FTCA", classLevel: "Freshman", incomingReturning: "Incoming" }),
      s({ pcid: "P2", collegeAttend: "FTCA", classLevel: "Freshman", incomingReturning: "Returning" }),
      s({ pcid: "P3", incomingReturning: "Returning", collegeAttend: "FTCA", classLevel: "Sophomore" }),
    ],
    [
      s({ pcid: "P2", program: "NDEG", collegeAttend: "DUAL", degree: "HSDE", incomingReturning: "Incoming" }),
      s({ pcid: "P3", collegeAttend: "FTCA", classLevel: "Freshman", incomingReturning: "Incoming" }),
    ],
  );
  const sum = summaryFromStudents(rows);
  assert.equal(sum.ftca.headcount, 2);
  assert.equal(sum.newStudents.headcount, 2);
  assert.equal(sum.returning.headcount, 1);
});

test("graduate summary splits Philosophy, Theology, PhD, MBA, M.Ed, and CRW", () => {
  const rows = [
    s({ pcid: "P1", program: "GRAD", collegeAttend: "GRAD", degree: "MARTS", curriculum: "MAPHIL", curriculumName: "M.A. in Philosophy" }),
    s({ pcid: "P2", program: "GRAD", collegeAttend: "GRAD", degree: "MARTS", curriculum: "MATHEO", curriculumName: "M.A. in Theology" }),
    s({ pcid: "P3", program: "GRAD", collegeAttend: "GRAD", degree: "PHD", curriculum: "PHDTHE", curriculumName: "Ph.D Theo" }),
    s({ pcid: "P4", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", curriculum: "MNGTCO" }),
    s({ pcid: "P5", program: "GRAD", collegeAttend: "GRAD", degree: "MEDCL", curriculum: "EDUC", curriculumName: "Education" }),
    s({ pcid: "P6", program: "GRAD", collegeAttend: "GRAD", degree: "MARTS", curriculum: "MACOMM", curriculumName: "M.A. in Communicatio" }),
    s({
      pcid: "P7",
      program: "GRAD",
      collegeAttend: "GRAD",
      degree: "MARTS",
      curriculum: "MATHEO",
      curriculumName: "M.A. in Theology",
      session: "01LuxMundi",
    }),
  ];
  const sum = summaryFromStudents(rows);
  assert.equal(sum.gradMaPhil.headcount, 1);
  assert.equal(sum.gradMa.headcount, 1, "campus MATHEO only");
  assert.equal(sum.gradPhd.headcount, 1);
  assert.equal(sum.gradMba.headcount, 1);
  assert.equal(sum.gradMedcl.headcount, 1);
  assert.equal(sum.gradMaCrw.headcount, 1);
  assert.equal(sum.luxMundiGrad.headcount, 1);
  assert.equal(sum.totalGraduate.headcount, 7);
});

test("GRAD program with BARTS is UG, not Other on the graduate tab", () => {
  const rows = [
    s({ pcid: "P1", program: "GRAD", collegeAttend: "GRAD", degree: "BARTS", curriculum: "THE", curriculumName: "Theology", incomingReturning: "Incoming" }),
    s({ pcid: "P2", program: "GRAD", collegeAttend: "GRAD", degree: "BARTS", curriculum: "BUS", classLevel: "Senior", incomingReturning: "Returning" }),
    s({ pcid: "P3", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", incomingReturning: "Incoming" }),
  ];
  const sum = summaryFromStudents(rows);
  assert.equal(sum.degreeSeeking.headcount, 2);
  assert.equal(sum.newStudents.headcount, 1);
  assert.equal(sum.newOther?.headcount, 1, "incoming dual-BA is Other, not FTCA/TRAN/READ/SECB");
  assert.equal(sum.returning.headcount, 1);
  assert.equal(sum.totalGraduate.headcount, 1);
  assert.equal(sum.gradMba.headcount, 1);
  const blocks = buildGraduateEnrollment(rows);
  assert.equal(blocks[0]?.n, 1);
  assert.equal(blocks.some((b) => b.program === "Other"), false);
});

test("graduate enrollment stats split overall and programs; alumni vs external admits", () => {
  const rows = [
    s({ pcid: "A1", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", incomingReturning: "Incoming", athlete: "Athlete", religion: "Catholic", cathGroup: "Catholic" }),
    s({ pcid: "A2", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", incomingReturning: "Incoming", athlete: "Non-Athlete", religion: "Christian", cathGroup: "Non-Catholic" }),
    s({ pcid: "A3", program: "GRAD", collegeAttend: "GRAD", degree: "MARTS", curriculum: "MAPHIL", incomingReturning: "Returning", athlete: "Non-Athlete", religion: "Catholic", cathGroup: "Catholic" }),
    s({ pcid: "UG1", program: "UNDERG", collegeAttend: "FTCA" }),
  ];
  const prior = [s({ pcid: "A1", program: "UNDERG", collegeAttend: "FTCA" })];
  const blocks = buildGraduateEnrollment(rows, prior);
  assert.equal(blocks[0]?.program, "Overall");
  assert.equal(blocks[0]?.n, 3);
  const mba = blocks.find((b) => b.program === "MBA");
  assert.equal(mba?.n, 2);
  assert.equal(mba?.athlete, 1);
  assert.equal(mba?.alumniAdmits, 1);
  assert.equal(mba?.externalAdmits, 1);
  assert.equal(mba?.amuAlumni, 1);
  assert.equal(mba?.incoming, 2);
  const phil = blocks.find((b) => b.program === "MA Philosophy");
  assert.equal(phil?.n, 1);
  assert.equal(phil?.returning, 1);
});

test("graduate Athlete includes Post Grad team players and Associated band", () => {
  const rows = [
    s({
      pcid: "P1",
      program: "GRAD",
      collegeAttend: "GRAD",
      degree: "MBA",
      athlete: "Athlete",
      sport: "Tennis-Men",
      athleticType: "Varsity",
      rosterStatus: "Roster - Athlete Post Grad",
    }),
    s({
      pcid: "P2",
      program: "GRAD",
      collegeAttend: "GRAD",
      degree: "MBA",
      athlete: "Non-Athlete",
      sport: "Band",
      rosterStatus: "Roster - Athletic Associated",
    }),
    s({ pcid: "P3", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", athlete: "Non-Athlete" }),
  ];
  const mba = buildGraduateEnrollment(rows).find((b) => b.program === "MBA");
  assert.equal(mba?.n, 3);
  assert.equal(mba?.athlete, 2);
  assert.equal(mba?.nonAthlete, 1);
});

test("graduate alumni admits include AMU bachelor's from Graduated All, not only last fall UG", () => {
  const rows = [
    s({ pcid: "NEW1", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", incomingReturning: "Incoming" }),
    s({ pcid: "EXT1", program: "GRAD", collegeAttend: "GRAD", degree: "MBA", incomingReturning: "Incoming" }),
  ];
  const blocks = buildGraduateEnrollment(rows, [], [
    { pcid: "NEW1", year: "2024", term: "SPRING", program: "UNDERG" },
  ]);
  const mba = blocks.find((b) => b.program === "MBA");
  assert.equal(mba?.alumniAdmits, 1);
  assert.equal(mba?.externalAdmits, 1);
  assert.equal(mba?.amuAlumni, 1);
});

test("Ireland and Mont Mallary are not On Campus; DE is DUAL not Chesterton", () => {
  const rows = [
    s({ pcid: "1", residency: "On Campus", incomingReturning: "Returning" }),
    s({ pcid: "2", session: "03Ireland", residency: "Ireland", incomingReturning: "Returning" }),
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
  assert.equal(sum.chestertonDual.headcount, 1, "Early College is Chesterton; a Chesterton major is not");
  assert.equal(sum.chesterton.headcount, 1);
  assert.equal(sum.nonDegree.headcount, 0, "EACO is Chesterton, not non-degree");
  assert.equal(sum.dualEnrollment.fte, 1); // 4/12 + 8/12
});

test("Early College (EACO/EACOL) is the Chesterton Summary line", () => {
  const rows = [
    s({ pcid: "1", program: "EACOL", collegeAttend: "EACO", degree: "BARTS", incomingReturning: "Incoming" }),
    s({ pcid: "2", program: "EACOL", collegeAttend: "EACO", degree: "NONDEG", incomingReturning: "Incoming", credits: 4 }),
    s({ pcid: "3", program: "NDEG", collegeAttend: "DUAL", degree: "HSDE" }),
  ];
  const sum = summaryFromStudents(rows);
  assert.equal(sum.chestertonDual.headcount, 2);
  assert.equal(sum.dualEnrollment.headcount, 1);
  assert.equal(sum.nonDegree.headcount, 0, "Chesterton is not Non-Degree");
  assert.equal(sum.totalUndergraduate.headcount, 3);
});

test("Chesterton is not inside dual enrollment", () => {
  const rows = [
    s({ pcid: "1", program: "NDEG", collegeAttend: "DUAL", degree: "HSDE", credits: 6, fullPart: "", deType: "Chesterton" }),
    s({ pcid: "2", program: "NDEG", collegeAttend: "DUAL", degree: "HSDE", credits: 6, fullPart: "" }),
    s({ pcid: "3", program: "NDEG", collegeAttend: "ND", degree: "PENRIC" }),
  ];
  const sum = summaryFromStudents(rows);
  assert.equal(sum.dualEnrollment.headcount, 1);
  assert.equal(sum.chestertonDual.headcount, 1);
  assert.equal(sum.nonDegree.headcount, 1);
  assert.equal(sum.totalUndergraduate.headcount, 3);
});

test("meanPositive treats 0 as missing and floors SAT below 400", () => {
  const rows = [
    s({ pcid: "1", hsGpa: 3.5, act: 20, sat: 1200, clt: 90 }),
    s({ pcid: "2", hsGpa: 3.7, act: 26, sat: 35, clt: 0 }),
    s({ pcid: "3", hsGpa: "", act: 24, sat: 1100, clt: 80 }),
    s({ pcid: "4", hsGpa: 3.2, act: 28, sat: 1300, clt: 100 }),
    s({ pcid: "5", hsGpa: 3.6, act: 22, sat: 1250, clt: 85 }),
    s({ pcid: "7", hsGpa: 3.4, act: 25, sat: 1180, clt: 88 }),
    s({ pcid: "6", incomingReturning: "Returning", hsGpa: 4.0, act: 36, sat: 1600, clt: 120 }),
  ];
  const incoming = rows.filter((r) => r.incomingReturning === "Incoming");
  assert.equal(meanPositive(incoming, (r) => r.hsGpa, 2), 3.48);
  assert.equal(meanPositive(incoming, (r) => r.act, 1), 24.2);
  assert.equal(meanPositive(incoming, (r) => r.sat, 0, 5, 400), 1206);
  assert.equal(meanPositive(incoming, (r) => r.clt, 1), 88.6);
  const data = applyRegistrationTotals(structuredClone(snapshot), rows);
  assert.equal(data.kpis.incomingHsGpa, 3.48);
  assert.equal(data.kpis.avgSat, 1206);
  assert.equal(
    data.pending.some((p) => /Incoming SAT \/ ACT \/ CLT \/ HS GPA/i.test(p)),
    false,
  );
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

test("summer graduate counts include every Summer 2026 degree", () => {
  const rows = summerGraduateCounts([
    { pcid: "G1", year: "2026", term: "SUMMER", program: "GRAD", degree: "MBA" },
    { pcid: "G2", year: "2026", term: "SUMMER", program: "GRAD", degree: "MBA" },
    { pcid: "G3", year: "2026", term: "SUMMER", program: "GRAD", degree: "MARTS" },
    { pcid: "U1", year: "2026", term: "SUMMER", program: "UNDERG", degree: "BARTS" },
    { pcid: "U2", year: "2026", term: "SUMMER", program: "UNDERG", degree: "BSCIEN" },
    { pcid: "G4", year: "2026", term: "SPRING", program: "GRAD", degree: "MBA" },
  ]);
  assert.deepEqual(
    rows,
    [
      { program: "B.A.", n: 1 },
      { program: "B.S.", n: 1 },
      { program: "MA Theology on-campus", n: 1 },
      { program: "MBA", n: 2 },
    ],
  );
});
