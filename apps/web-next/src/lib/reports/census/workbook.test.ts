import assert from "node:assert/strict";
import { test } from "node:test";
import snapshot from "./snapshot.json";
import { presentSnapshot } from "./present";
import { applyHousingOverlay } from "./overlay";
import { censusFileName, buildCensusWorkbook } from "./workbook";
import { unzipEntries } from "./xlsx";
import type { CensusSnapshot } from "./types";
import type { Resident } from "../housing/types";

function draft(): CensusSnapshot {
  return presentSnapshot(structuredClone(snapshot) as CensusSnapshot);
}

test("sports are A–Z on the presented snapshot, like the FA25 sheet", () => {
  const data = draft();
  const labels = data.ug.sports.map((r) => r.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(
    data.ug.athlete.map((r) => r.label),
    ["Athlete", "Non-Athlete"],
  );
});

test("states are A–Z like last year's census report, International last", () => {
  const data = draft();
  const labels = data.ug.states.map((r) => r.label);
  assert.equal(labels[0], "AE");
  assert.equal(labels[labels.length - 1], "International");
  const core = labels.filter((l) => l !== "International");
  assert.deepEqual(core, [...core].sort((a, b) => a.localeCompare(b)));
});

test("country and ethnicity codes expand to census labels", () => {
  const data = draft();
  assert.ok(data.ug.countries.some((r) => r.label === "Canada"));
  assert.ok(data.ug.countries.some((r) => r.label === "Germany"));
  assert.ok(data.ftcaAttrition.byEthnicity.some((r) => r.label === "Hispanic"));
  assert.ok(data.ftcaAttrition.byGpa.some((r) => r.label === "No AMU GPA"));
});

test("eRez overlay fills residency and drops the housing pending line", () => {
  const data = draft();
  assert.ok(data.pending.some((p) => /housing/i.test(p)));
  applyHousingOverlay(data, [
    { pcid: "1", building: "JPII", price_type: "UGDP" },
    { pcid: "2", building: "Commuter", price_type: "NODM" },
  ] as Resident[]);
  assert.equal(data.housing?.source, "erez");
  assert.ok(data.ug.residency.some((r) => r.label === "On Campus" || r.label === "Ireland"));
  assert.ok(data.kpis.ugOnCampusPct != null);
  assert.equal(
    data.pending.some((p) => /housing/i.test(p)),
    false,
  );
});

test("draft workbook has the FA25 sheet set and is a real xlsx", async () => {
  const data = draft();
  const buf = await buildCensusWorkbook(
    data,
    [
      {
        pcid: "P1",
        name: "Test Student",
        email: "test@avemaria.edu",
        building: "JPII",
        room: "101",
        priceType: "UGDP",
        residency: "Resident",
        classStatus: "Freshman",
        studentType: "Incoming",
        includedInCensus: true,
      },
    ],
    {
      prior: [],
      graduates: [],
      students: [
        {
          pcid: "P1",
          first: "Test",
          last: "Student",
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
          institute: "Scholar",
          marines: "",
          appDecision: "ACCT",
          session: "01",
          degree: "BARTS",
          email: "test@avemaria.edu",
          citizenship: "",
          visa: "",
        },
        {
          pcid: "P3",
          first: "Grad",
          last: "Student",
          incomingReturning: "Incoming",
          state: "PA",
          religion: "Catholic",
          cathGroup: "Catholic",
          ethnicity: "WHITE",
          gender: "Male",
          program: "GRAD",
          collegeAttend: "GRAD",
          curriculum: "MATHEO",
          curriculumName: "M.A. in Theology",
          classLevel: "",
          fullPart: "HALF",
          city: "Erie",
          credits: 8,
          gpa: "",
          earnedCredits: 0,
          residency: "Commuter",
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
          session: "01LuxMundi",
          degree: "MARTS",
          email: "grad@avemaria.edu",
          citizenship: "",
          visa: "",
        },
      ],
      unretained: [
        {
          pcid: "P2",
          first: "Left",
          last: "Campus",
          retention: "Not Retained",
          gpa: 2.1,
          fsp: "-",
          household: "-",
          marines: "-",
          honors: "-",
          sport: "Football",
          state: "FL",
          gender: "Male",
          classLevel: "Freshman",
          collegeAttend: "FTCA",
          incomingReturning: "Incoming",
        },
      ],
    },
  );
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const files = unzipEntries(buf);
  const names = [...files["xl/workbook.xml"].matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, [
    "Summary",
    "Historical",
    "FA26 Census Report",
    "FA25 FTCA Cohort Attrition",
    "F25-F26 FTCA Retention Raw Data",
    "FA26 Census Raw Data",
    "All Not Retained",
    "Verify (temporary)",
    "FA26 Housing (eRez)",
    "Sources",
  ]);
  assert.match(files["xl/styles.xml"], /style="thin"/);
  assert.match(files["xl/styles.xml"], /B8922E/);
  assert.match(files["xl/worksheets/sheet1.xml"], /Fall 2026 Census/);
  assert.match(files["xl/worksheets/sheet1.xml"], /Total Degree-Seeking/);
  assert.match(files["xl/worksheets/sheet1.xml"], /Graduate MA Students/);
  const reportXml = files["xl/worksheets/sheet3.xml"];
  assert.match(reportXml, /Undergraduate Statistics/);
  assert.match(reportXml, /Incoming/);
  assert.match(reportXml, /Student Residency/);
  assert.match(reportXml, /FA26 Majors/);
  assert.match(reportXml, /Other\(THRE\)/);
  assert.match(reportXml, /Row Labels/);
  assert.match(reportXml, /Athletic Retention/);
  assert.match(reportXml, /Application Decisions Retention/);
  assert.match(reportXml, /Residence Type/);
  assert.match(reportXml, /Association Retention/);
  assert.match(reportXml, /Needs data/);
  const attritionXml = files["xl/worksheets/sheet4.xml"];
  assert.doesNotMatch(attritionXml, /Athletic Retention/);
  assert.match(attritionXml, /Incoming FTCA/);
  assert.match(attritionXml, /HS GPA Ranges/);
  assert.match(attritionXml, /Needs data/);
  const ftcaRawXml = files["xl/worksheets/sheet5.xml"];
  assert.match(ftcaRawXml, /DOB \(Needs data\)/);
  assert.match(ftcaRawXml, /HS GPA \(Needs data\)/);
  assert.match(ftcaRawXml, /Religious Affiliation/);
  const rawXml = files["xl/worksheets/sheet6.xml"];
  assert.match(rawXml, /Religion/);
  assert.match(rawXml, /Application Decision/);
  assert.match(rawXml, /Citizenship/);
  assert.match(rawXml, /HS GPA/);
  assert.match(rawXml, /GRAD/);
  assert.match(rawXml, /MARTS/);
  assert.match(rawXml, /01LuxMundi/);
  assert.match(rawXml, /Institute/);
  assert.match(rawXml, /Scholar/);
  const unretainedXml = files["xl/worksheets/sheet7.xml"];
  assert.match(unretainedXml, /Religion/);
  assert.doesNotMatch(files["xl/styles.xml"], /vertical="middle"/);
  assert.match(files["xl/styles.xml"], /xfId="0"/);
  const sheet1 = files["xl/worksheets/sheet1.xml"];
  assert.ok(
    sheet1.indexOf("<dimension") < sheet1.indexOf("<sheetViews"),
    "Excel requires dimension before sheetViews",
  );
  assert.equal(censusFileName(data, new Date("2026-08-26T12:00:00Z")), "FA26_Census_DRAFT_2026-08-26.xlsx");
});
