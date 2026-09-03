import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FILTERS,
  buildReport,
  describeFilters,
  filterCensusRaw,
  filtersActive,
  filtersForCensusRaw,
  filterStudents,
  filterUnretained,
  parseReportFilters,
  projectReportStudents,
  projectUnretained,
  type ReportStudent,
} from "./report";
import type { UnretainedStudent } from "./lists-core";
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
    athleticType: "",
    rosterStatus: "",
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

test("GRAD program with a bachelor's degree is UG, not graduate", () => {
  const rows = set([
    raw({ pcid: "1", program: "GRAD", collegeAttend: "GRAD", degree: "BARTS" }),
    raw({ pcid: "2", program: "GRAD", collegeAttend: "GRAD", degree: "MBA" }),
  ]);
  assert.equal(filterStudents(rows, DEFAULT_FILTERS).length, 1);
  assert.equal(filterStudents(rows, DEFAULT_FILTERS)[0]?.pcid, "1");
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "grad" }).length, 1);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "grad" })[0]?.pcid, "2");
});

test("census raw includes graduate rows when the default degree filter is UG", () => {
  const rows = [
    raw({ pcid: "1", program: "UNDERG", collegeAttend: "FTCA", degree: "BARTS" }),
    raw({ pcid: "2", program: "GRAD", collegeAttend: "GRAD", degree: "MARTS" }),
  ];
  const ugOnly = filterCensusRaw(rows, DEFAULT_FILTERS);
  assert.equal(ugOnly.length, 1);
  assert.equal(ugOnly[0]?.pcid, "1");
  const rawList = filterCensusRaw(rows, filtersForCensusRaw(DEFAULT_FILTERS));
  assert.equal(rawList.length, 2);
  assert.ok(rawList.some((s) => s.program === "GRAD"));
});

test("filterCensusRaw drops hidden sports from the raw list", () => {
  const rows = [
    raw({ pcid: "1", athlete: "Athlete", sport: "Football", gender: "Male" }),
    raw({ pcid: "2", athlete: "Athlete", sport: "Ireland", gender: "Female" }),
  ];
  const out = filterCensusRaw(rows, { ...DEFAULT_FILTERS, excludedSports: ["Football"] });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.pcid, "2");
});

test("including a sport keeps only those students", () => {
  const rows = set([
    raw({ pcid: "1", athlete: "Athlete", sport: "Football", gender: "Male" }),
    raw({ pcid: "2", athlete: "Athlete", sport: "Volleyball", gender: "Female" }),
    raw({ pcid: "3", athlete: "Non-Athlete", sport: "" }),
  ]);
  const filtered = filterStudents(rows, { ...DEFAULT_FILTERS, includedSports: ["Volleyball"] });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.sport, "Volleyball");
  const rpt = buildReport(filtered);
  assert.equal(rpt.n, 1);
  assert.deepEqual(rpt.sports.map((s) => s.label), ["Volleyball"]);
});

test("include and hide sports stack; hide wins on overlap", () => {
  const rows = set([
    raw({ pcid: "1", athlete: "Athlete", sport: "Football" }),
    raw({ pcid: "2", athlete: "Athlete", sport: "Volleyball" }),
    raw({ pcid: "3", athlete: "Athlete", sport: "Ireland" }),
  ]);
  const filtered = filterStudents(rows, {
    ...DEFAULT_FILTERS,
    includedSports: ["Football", "Volleyball"],
    excludedSports: ["Football"],
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.sport, "Volleyball");
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

test("religion filter keeps only those affiliations", () => {
  const rows = set([
    raw({ pcid: "1", religion: "Catholic" }),
    raw({ pcid: "2", religion: "Christian" }),
    raw({ pcid: "3", religion: "Eastern Rite Catholic" }),
  ]);
  const filtered = filterStudents(rows, { ...DEFAULT_FILTERS, religions: ["Catholic"] });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.religion, "Catholic");
});

test("Unretained filter is off by default and counts as an active filter", () => {
  assert.equal(DEFAULT_FILTERS.retention, "enrolled");
  assert.equal(filtersActive(DEFAULT_FILTERS), false);
  assert.equal(filtersActive({ ...DEFAULT_FILTERS, retention: "unretained" }), true);
  assert.match(describeFilters({ ...DEFAULT_FILTERS, retention: "unretained" }), /Unretained/);
});

test("Census Report can be built from the unretained list", () => {
  const rows: UnretainedStudent[] = [
    {
      pcid: "P1",
      first: "A",
      last: "Lost",
      retention: "Not Retained",
      gpa: 2.1,
      fsp: "-",
      household: "-",
      marines: "-",
      honors: "-",
      sport: "Football",
      religion: "Catholic",
      state: "FL",
      gender: "Male",
      classLevel: "Freshman",
      collegeAttend: "FTCA",
      incomingReturning: "Incoming",
      program: "UNDERG",
    },
    {
      pcid: "P2",
      first: "B",
      last: "Gone",
      retention: "Not Retained",
      gpa: 3.4,
      fsp: "-",
      household: "-",
      marines: "-",
      honors: "-",
      sport: "-",
      religion: "Christian",
      state: "TX",
      gender: "Female",
      classLevel: "Sophomore",
      collegeAttend: "FTCA",
      incomingReturning: "Returning",
      program: "UNDERG",
    },
  ];
  const projected = projectUnretained(rows);
  assert.equal(projected[0]?.athlete, "Athlete");
  assert.equal(projected[1]?.athlete, "Non-Athlete");
  const football = filterStudents(projected, { ...DEFAULT_FILTERS, includedSports: ["Football"] });
  assert.equal(football.length, 1);
  assert.equal(football[0]?.pcid, "P1");
  const rpt = buildReport(projected);
  assert.equal(rpt.n, 2);
  assert.equal(rpt.gender.find((g) => g.label === "Male")?.n, 1);
  const onlyUg = filterUnretained(rows, DEFAULT_FILTERS);
  assert.equal(onlyUg.length, 2);
});

test("parseReportFilters reads Unretained and sports from the export POST body", () => {
  const f = parseReportFilters({
    retention: "unretained",
    gender: "Female",
    includedSports: ["Soccer-Women"],
    degree: "all",
  });
  assert.equal(f.retention, "unretained");
  assert.equal(f.gender, "Female");
  assert.deepEqual(f.includedSports, ["Soccer-Women"]);
  assert.equal(f.degree, "all");
  assert.equal(parseReportFilters({ retention: "nope" }).retention, "enrolled");
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

test("religion table uses detailed religion; Non-Catholic is not 100% Catholic", () => {
  const rows = set([
    raw({ pcid: "1", religion: "Catholic", cathGroup: "Catholic", athlete: "Athlete", sport: "Football" }),
    raw({ pcid: "2", religion: "Christian", cathGroup: "Non-Catholic", athlete: "Athlete", sport: "Football" }),
    raw({ pcid: "3", religion: "Eastern Rite Catholic", cathGroup: "Catholic", athlete: "Athlete", sport: "Football" }),
    raw({ pcid: "4", religion: "Other", cathGroup: "Non-Catholic" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  assert.deepEqual(
    rpt.religion.map((r) => r.label),
    ["Catholic", "Christian", "Eastern Rite Catholic", "Other"],
  );
  assert.deepEqual(
    rpt.athleticReligion.map((r) => r.label),
    ["Catholic", "Christian", "Eastern Rite Catholic"],
  );
  const catholicN = rpt.religion.filter((r) => r.label === "Catholic" || r.label === "Eastern Rite Catholic").reduce((s, r) => s + r.n, 0);
  assert.equal(catholicN / rpt.n, 0.5);
  assert.equal(rpt.floridaCatholic.find((r) => r.label === "Catholic")?.n, 2);
  assert.equal(rpt.floridaCatholic.find((r) => r.label === "Non-Catholic")?.n, 2);
});

test("Application Decisions keeps ACCT/ADM/COMM and Not listed, like FA25", () => {
  const rows = set([
    raw({ pcid: "1", appDecision: "AT" }),
    raw({ pcid: "2", appDecision: "ACCT" }),
    raw({ pcid: "3", appDecision: "ADMI" }),
    raw({ pcid: "4", appDecision: "CMRV" }),
    raw({ pcid: "5", appDecision: "" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  const by = Object.fromEntries(rpt.appDecisions.map((r) => [r.label, r.n]));
  assert.equal(by.ACCT, 2);
  assert.equal(by.ADM, 1);
  assert.equal(by.COMM, 1);
  assert.equal(by["Not listed"], 1);
});

test("Florida Catholic table keeps Non-Catholic rows (Christian is not Catholic)", () => {
  const rows = set([
    raw({ pcid: "1", state: "FL", religion: "Catholic", cathGroup: "Catholic" }),
    raw({ pcid: "2", state: "FL", religion: "Christian", cathGroup: "Non-Catholic" }),
    raw({ pcid: "3", state: "FL", religion: "Other", cathGroup: "Non-Catholic" }),
    raw({ pcid: "4", state: "FL", religion: "Eastern Rite Catholic", cathGroup: "Catholic" }),
    raw({ pcid: "5", state: "TX", religion: "Christian", cathGroup: "Non-Catholic" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  assert.equal(rpt.floridaAthlete.reduce((s, r) => s + r.n, 0), 4);
  assert.deepEqual(
    rpt.floridaCatholic.map((r) => [r.label, r.n]),
    [
      ["Catholic", 2],
      ["Non-Catholic", 2],
    ],
  );
  assert.equal(rpt.floridaCatholic[0].n + rpt.floridaCatholic[1].n, 4);
});

test("class level includes incoming; residency splits male/female", () => {
  const rows = set([
    raw({ gender: "Female", classLevel: "Freshman", incomingReturning: "Incoming", residency: "Resident" }),
    raw({ gender: "Male", classLevel: "Senior", incomingReturning: "Returning", residency: "Commuter", fullPart: "FULL" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  const fr = rpt.classLevel.find((r) => r.label === "Freshman");
  assert.equal(fr?.incoming, 1);
  const res = rpt.residency.find((r) => r.label === "On Campus");
  assert.equal(res?.female, 1);
  assert.equal(res?.male, 0);
});

test("Student Residency shows Ireland and Rome as their own lines", () => {
  const rows = set([
    raw({ pcid: "1", residency: "Ireland", gender: "Female" }),
    raw({ pcid: "2", residency: "Mount Melleray Abbey", gender: "Male" }),
    raw({ pcid: "3", residency: "On Campus", gender: "Male" }),
    raw({ pcid: "4", residency: "Rome", gender: "Female" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  const ire = rpt.residency.find((r) => r.label === "Ireland");
  assert.equal(ire?.n, 2);
  assert.equal(rpt.residency.find((r) => r.label === "Rome")?.n, 1);
  assert.equal(rpt.residency.find((r) => r.label === "Mount Melleray Abbey"), undefined);
});

test("country percentages are of international students, like the FA25 sheet", () => {
  const rows = set([
    raw({ pcid: "1", citizenship: "" }),
    raw({ pcid: "2", citizenship: "CAN", visa: "F1" }),
    raw({ pcid: "3", citizenship: "CAN", visa: "F1" }),
    raw({ pcid: "4", citizenship: "SPAIN", visa: "F1" }),
    raw({ pcid: "5", citizenship: "MEX", visa: "F1", state: "FL" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  const canada = rpt.countries.find((r) => r.label === "Canada");
  assert.equal(canada?.n, 2);
  assert.equal(canada?.pct, 2 / 4);
  assert.equal(rpt.countries.find((r) => r.label === "Mexico")?.n, 1);
  assert.equal(rpt.countries.length, 3);
  assert.equal(rpt.states.find((r) => r.label === "International")?.n, 4);
});

test("sport table splits team athletes from athletics associated like S26", () => {
  const rows = set([
    raw({ pcid: "1", sport: "Football", athlete: "Athlete", athleticType: "Varsity" }),
    raw({ pcid: "2", sport: "Football", athlete: "Athlete", athleticType: "Manager/Student Coach" }),
    raw({ pcid: "3", sport: "Band", athlete: "Athlete", athleticType: "" }),
    raw({ pcid: "4", sport: "Ireland", athlete: "Athlete", athleticType: "" }),
    raw({ pcid: "5", athlete: "Non-Athlete", sport: "" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  const fb = rpt.sports.find((r) => r.label === "Football");
  assert.equal(fb?.athletes, 1);
  assert.equal(fb?.associated, 2);
  const band = rpt.sports.find((r) => r.label === "Band");
  assert.equal(band?.athletes, 0);
  assert.equal(band?.associated, 1);
  assert.equal(
    rpt.sports.find((r) => r.label === "Ireland"),
    undefined,
    "Ireland is a campus, not a sport",
  );
  const associated = rpt.sports.reduce((s, r) => s + (r.associated ?? 0), 0);
  assert.equal(rpt.athlete.find((r) => r.label === "Athlete")?.n, associated);
  assert.equal(associated, 3, "Football 2 + Band 1; Ireland is not athletics associated");
});

test("blank athletic type and Athletic Associated are associated, not team athletes", () => {
  const rows = set([
    raw({ pcid: "1", sport: "Football", athlete: "Athlete", athleticType: "" }),
    raw({
      pcid: "2",
      sport: "Football",
      athlete: "Athlete",
      athleticType: "Varsity",
      rosterStatus: "Roster - Athletic Associated",
    }),
    raw({
      pcid: "3",
      sport: "Band",
      athlete: "Athlete",
      athleticType: "Non-Varsity",
      rosterStatus: "Roster - Athletic Associated",
    }),
    raw({ pcid: "4", sport: "Football", athlete: "Athlete", athleticType: "Varsity" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  const fb = rpt.sports.find((r) => r.label === "Football");
  assert.equal(fb?.athletes, 1);
  assert.equal(fb?.associated, 3);
  const band = rpt.sports.find((r) => r.label === "Band");
  assert.equal(band?.athletes, 0);
  assert.equal(band?.associated, 1);
});

test("Rugby-Women folds into Rugby-Men; AMU has no women's rugby", () => {
  const rows = set([
    raw({ pcid: "1", sport: "Rugby-Men", athlete: "Athlete", athleticType: "Non-NAIA", gender: "Male" }),
    raw({ pcid: "2", sport: "Rugby-Women", athlete: "Athlete", athleticType: "Manager/Student Coach", gender: "Female" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  assert.equal(rpt.sports.find((r) => r.label === "Rugby-Women"), undefined);
  const rugby = rpt.sports.find((r) => r.label === "Rugby-Men");
  assert.equal(rugby?.athletes, 1);
  assert.equal(rugby?.associated, 2);
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

test("CTHSTD majors display as Catholic Studies", () => {
  const rows = set([
    raw({ pcid: "1", curriculum: "CTHSTD", curriculumName: "CTHSTD", classLevel: "Junior" }),
    raw({ pcid: "2", curriculum: "BIOLOG", curriculumName: "Biology", classLevel: "Junior" }),
  ]);
  const rpt = buildReport(filterStudents(rows, DEFAULT_FILTERS));
  assert.equal(rpt.majors.some((m) => m.label === "CTHSTD"), false);
  assert.equal(rpt.majors.find((m) => m.label === "Catholic Studies")?.total, 1);
  assert.equal(rpt.majors.find((m) => m.label === "Biology")?.total, 1);
});

test("B.A. vs B.S. degree type", () => {
  const rows = set([
    raw({ degree: "BARTS" }),
    raw({ degree: "BSCIEN", curriculumName: "Biology" }),
  ]);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "BA" }).length, 1);
  assert.equal(filterStudents(rows, { ...DEFAULT_FILTERS, degree: "BS" }).length, 1);
});
