import assert from "node:assert/strict";
import { test } from "node:test";
import snapshot from "./snapshot.json";
import { presentSnapshot } from "./present";
import { applyHousingOverlay } from "./overlay";
import { censusFileName, buildCensusWorkbook, buildListsWorkbook, listsFileName, crosstabCells } from "./workbook";
import { DEFAULT_FILTERS } from "./report";
import { S26_LOA_ROSTER } from "./lists-core";
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
  assert.ok(data.ug.residency.some((r) => r.label === "On Campus" || r.label === "Ireland" || r.label === "Mount Melleray Abbey"));
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
        {
          pcid: "P4",
          first: "Abbey",
          last: "Student",
          incomingReturning: "Returning",
          state: "FL",
          religion: "Catholic",
          cathGroup: "Catholic",
          ethnicity: "WHITE",
          gender: "Female",
          program: "UNDERG",
          collegeAttend: "FTCA",
          curriculum: "BIOLOG",
          curriculumName: "Biology",
          classLevel: "Sophomore",
          fullPart: "FULL",
          city: "Naples",
          credits: 15,
          gpa: "",
          earnedCredits: 0,
          residency: "Ireland",
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
          session: "03Ireland",
          degree: "BARTS",
          email: "abbey@avemaria.edu",
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
      loa: [],
      loaFall: [],
    },
  );
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const files = unzipEntries(buf);
  const names = [...files["xl/workbook.xml"].matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, [
    "Summary",
    "Historical",
    "FA26 Census Report",
    "FA26 Census Report no Football",
    "FA26 Graduate Enrollment",
    "FA25 FTCA Cohort Attrition",
    "FA25 FTCA Attrition no Football",
    "F25-F26 FTCA Retention Raw Data",
    "FA26 Census Raw Data",
    "All Not Retained",
    "Verify (temporary)",
    "S26 LOA",
    "FA26 LOA",
    "FA26 Housing (eRez)",
    "Sources",
  ]);
  assert.match(files["xl/styles.xml"], /style="thin"/);
  assert.match(files["xl/styles.xml"], /1A3F6F/);
  assert.doesNotMatch(files["xl/styles.xml"], /B8922E/);
  assert.match(files["xl/worksheets/sheet1.xml"], /Fall 2026 Census/);
  assert.match(files["xl/worksheets/sheet1.xml"], /Total Degree-Seeking/);
  assert.match(files["xl/worksheets/sheet1.xml"], /MA Philosophy/);
  assert.match(files["xl/worksheets/sheet1.xml"], /MA Theology/);
  assert.match(files["xl/worksheets/sheet1.xml"], /PhD Theology/);
  assert.match(files["xl/worksheets/sheet1.xml"], /M\. Education/);
  assert.match(files["xl/worksheets/sheet1.xml"], /MA CRW/);
  assert.match(files["xl/worksheets/sheet1.xml"], /Mount Melleray Abbey/);
  assert.doesNotMatch(files["xl/worksheets/sheet1.xml"], /Chesterton DE/);
  assert.doesNotMatch(files["xl/worksheets/sheet1.xml"], />Ireland</);
  const histXml = files["xl/worksheets/sheet2.xml"];
  assert.match(histXml, /Graduate Phil/);
  assert.match(histXml, /Graduate MA Students:/);
  assert.match(histXml, /Graduate PhD Students:/);
  assert.match(histXml, /Graduate MBA Students:/);
  assert.match(histXml, /Graduate MEdCl/);
  assert.match(histXml, /Graduate MA Comm/);
  assert.match(histXml, /Lux Mundi Non-Degree-Seeking \/ Personal Enrichment/);
  assert.doesNotMatch(histXml, /Ireland/);
  assert.doesNotMatch(histXml, /Mont Mallary/);
  assert.doesNotMatch(histXml, /Chesterton/);
  assert.doesNotMatch(histXml, /MA Philosophy/);
  assert.match(histXml, /1343 \(1334 Full Time\)/);
  const reportXml = files["xl/worksheets/sheet3.xml"];
  assert.match(reportXml, /Undergraduate Statistics/);
  assert.match(reportXml, /Incoming/);
  assert.match(reportXml, /Student Residency/);
  assert.match(reportXml, /Ireland/);
  assert.match(files["xl/worksheets/sheet1.xml"], /Mount Melleray Abbey/);
  assert.match(reportXml, /FA26 Majors/);
  assert.match(reportXml, /Other\(THRE\)/);
  assert.match(reportXml, /Row Labels/);
  assert.match(reportXml, /Athletic Retention/);
  assert.match(reportXml, /Application Decisions Retention/);
  assert.match(reportXml, /Committee admits and admin overrides/);
  assert.match(reportXml, /Admit type/);
  assert.doesNotMatch(reportXml, /Universe/);
  assert.match(reportXml, /Catholic\/Non-Catholic/);
  assert.match(reportXml, /Residence Type/);
  assert.match(reportXml, /Association Retention/);
  assert.match(reportXml, /Needs data/);
  const noFbReportXml = files["xl/worksheets/sheet4.xml"];
  assert.match(noFbReportXml, /Football removed/);
  assert.match(noFbReportXml, /Undergraduate Statistics/);
  const gradXml = files["xl/worksheets/sheet5.xml"];
  assert.match(gradXml, /Graduate Enrollment/);
  assert.match(gradXml, /Athlete \/ Non-Athlete/);
  assert.match(gradXml, /External \/ Alumni admits/);
  assert.match(gradXml, /Incoming \/ Returning/);
  assert.match(gradXml, /Catholic \/ Non-Catholic/);
  const attritionXml = files["xl/worksheets/sheet6.xml"];
  assert.doesNotMatch(attritionXml, /Athletic Retention/);
  assert.match(attritionXml, /Incoming FTCA/);
  assert.match(attritionXml, /HS GPA Ranges/);
  assert.match(attritionXml, /ACT Converted/);
  assert.match(attritionXml, /Test Score/);
  assert.match(attritionXml, /Needs data/);
  const noFbFtcaXml = files["xl/worksheets/sheet7.xml"];
  assert.match(noFbFtcaXml, /Football removed/);
  assert.match(noFbFtcaXml, /Incoming FTCA/);
  const ftcaRawXml = files["xl/worksheets/sheet8.xml"];
  assert.match(ftcaRawXml, /DOB \(Needs data\)/);
  assert.match(ftcaRawXml, /HS GPA \(Needs data\)/);
  assert.match(ftcaRawXml, /Religious Affiliation/);
  const rawXml = files["xl/worksheets/sheet9.xml"];
  assert.match(rawXml, /Religion/);
  assert.match(rawXml, /Application Decision/);
  assert.match(rawXml, /Citizenship/);
  assert.match(rawXml, /HS GPA/);
  assert.match(rawXml, /GRAD/);
  assert.match(rawXml, /MARTS/);
  assert.match(rawXml, /01LuxMundi/);
  assert.match(rawXml, /Institute/);
  assert.match(rawXml, /Scholar/);
  const unretainedXml = files["xl/worksheets/sheet10.xml"];
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

test("Census Report retention crosstabs append a Total row", () => {
  const app = crosstabCells(
    [
      { label: "ACCT", students: 1310, notRetained: 156, graduated: 0, retentionPct: 0.881 },
      { label: "ADM", students: 9, notRetained: 3, graduated: 0, retentionPct: 0.667 },
      { label: "COMM", students: 9, notRetained: 2, graduated: 0, retentionPct: 0.778 },
    ],
    false,
    true,
  );
  assert.deepEqual(app.at(-1)?.slice(0, 3), ["Total", 1328, 161]);
  const gender = crosstabCells(
    [
      { label: "Athlete", label2: "Female", students: 243, notRetained: 24, graduated: 0, retentionPct: 0.901 },
      { label: "Athlete", label2: "Male", students: 387, notRetained: 64, graduated: 0, retentionPct: 0.835 },
      { label: "Non-Athlete", label2: "Female", students: 469, notRetained: 47, graduated: 0, retentionPct: 0.9 },
      { label: "Non-Athlete", label2: "Male", students: 244, notRetained: 31, graduated: 0, retentionPct: 0.873 },
    ],
    true,
    true,
  );
  assert.equal(gender.at(-1)?.[0], "Total");
  assert.equal(gender.at(-1)?.[2], 1343);
  assert.equal(gender.at(-1)?.[3], 166);
  const maleFl = crosstabCells(
    [
      { label: "Catholic", label2: "Athlete", students: 31, notRetained: 11, graduated: 0, retentionPct: 0.645 },
      { label: "Catholic", label2: "Non-Athlete", students: 20, notRetained: 4, graduated: 0, retentionPct: 0.8 },
    ],
    true,
    true,
  );
  assert.deepEqual(maleFl.at(-1)?.slice(0, 4), ["Total", "", 51, 15]);
});

test("filtered list export includes Unretained and Sports sheets", async () => {
  const data = draft();
  const buf = await buildListsWorkbook(
    data,
    { students: [], unretained: [], prior: [], graduates: [], loa: [], loaFall: [] },
    [],
    [],
    { ...DEFAULT_FILTERS, retention: "unretained", includedSports: ["Football"] },
    "filtered",
  );
  const files = unzipEntries(buf);
  const workbook = files["xl/workbook.xml"];
  assert.match(workbook, /All Not Retained/);
  assert.match(workbook, /Sports/);
  assert.match(workbook, /Census Raw/);
  assert.match(workbook, /S26 LOA/);
  assert.match(workbook, /FA26 LOA/);
  assert.match(files["xl/worksheets/sheet1.xml"], /Unretained/);
  assert.equal(listsFileName("unretained", data, new Date("2026-08-31T12:00:00Z")), "FA26_Census_Unretained_2026-08-31.xlsx");
  assert.equal(listsFileName("loa", data, new Date("2026-08-31T12:00:00Z")), "FA26_Census_LOA_2026-08-31.xlsx");
});

test("LOA list export writes Spring and Fall sheets separately", async () => {
  const cedeno = S26_LOA_ROSTER.find((s) => s.pcid === "P000380481");
  assert.ok(cedeno);
  const buf = await buildListsWorkbook(
    draft(),
    {
      students: [],
      unretained: [],
      prior: [],
      graduates: [],
      loa: S26_LOA_ROSTER,
      loaFall: [{ ...cedeno, first: "Alexander", last: "Earnhardt", pcid: "P000341593", term: "Fall 2026" }],
    },
    [],
    [],
    DEFAULT_FILTERS,
    "loa",
  );
  const files = unzipEntries(buf);
  const names = [...files["xl/workbook.xml"].matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Filters", "S26 LOA", "FA26 LOA"]);
  assert.match(files["xl/worksheets/sheet2.xml"], /Cedeno/);
  assert.doesNotMatch(files["xl/worksheets/sheet2.xml"], /Earnhardt/);
  assert.match(files["xl/worksheets/sheet3.xml"], /Earnhardt/);
  assert.match(files["xl/worksheets/sheet3.xml"], /Fall 2026/);
  assert.doesNotMatch(files["xl/worksheets/sheet3.xml"], /Cedeno/);
});
