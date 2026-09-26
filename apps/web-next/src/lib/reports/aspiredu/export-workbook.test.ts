import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipEntries } from "../census/xlsx";
import type { Resident } from "../housing/types";
import { CENSUS_FIELDS } from "./census-fields";
import {
  CLASS_COLUMNS,
  STUDENT_COLUMNS,
  buildExportModel,
  buildExportWorkbook,
  dateCell,
  exportFileName,
  groupCourseRows,
} from "./export-workbook";
import { fakeCensus, fakeCourse, sheetGrid } from "./export-test-fixtures";
import type { ProfileSources } from "./student-profile";

const NO_SOURCES: ProfileSources = { roster: null, housing: null, census: null };

function col(header: string): number {
  const i = STUDENT_COLUMNS.findIndex((c) => c.header === header);
  assert.ok(i >= 0, header);
  return i;
}

describe("groupCourseRows", () => {
  it("groups course rows by studentHmac and keeps the first non-empty identity", () => {
    const students = groupCourseRows([
      fakeCourse({ studentHmac: "h1", firstName: null, course: "A" }),
      fakeCourse({ studentHmac: "h2", firstName: "Blair", lastName: "Sample", course: "B" }),
      fakeCourse({ studentHmac: "h1", firstName: "Alex", course: "C" }),
      { junk: true },
      null,
    ]);
    assert.equal(students.length, 2);
    assert.equal(students[0]!.firstName, "Alex");
    assert.deepEqual(
      students[0]!.courses.map((c) => c.course),
      ["A", "C"],
    );
  });

  it("formats dates as written without a timezone shift", () => {
    assert.equal(dateCell("2026-09-21T23:30:00-04:00"), "2026-09-21");
    assert.equal(dateCell(null), null);
    assert.equal(dateCell("not a date"), "not a date");
  });
});

describe("buildExportModel", () => {
  it("computes KPIs like the profile and the list (risk and last activity fallbacks)", () => {
    const model = buildExportModel(
      [
        fakeCourse({ course: "THEO 101", courseGrade: 95, missingAssignments: 1, risk: null, courseRiskScore: 4 }),
        fakeCourse({ course: "MATH 150", courseGrade: 72.5, missingAssignments: 2, risk: null, courseRiskScore: 6, lastLogin: "2026-09-25T08:00:00Z" }),
        fakeCourse({ course: "HIST 201", courseGrade: null, missingAssignments: null, risk: null, courseRiskScore: null }),
      ],
      NO_SOURCES,
    );
    const row = model.students[0]!;
    assert.equal(row[col("PCID or SIS id")], "P000000111");
    assert.equal(row[col("GPA estimate")], 2.85);
    assert.equal(row[col("Average grade %")], 83.8);
    assert.equal(row[col("Classes")], 3);
    assert.equal(row[col("Below A/B")], 1);
    assert.equal(row[col("Missing work")], 3);
    assert.equal(row[col("Risk")], 6);
    assert.equal(row[col("Last activity")], "2026-09-25");
    assert.equal(row[col("Census match")], "Census unavailable");
    assert.equal(model.classes.length, 3);
    assert.deepEqual(model.counts, { students: 1, classes: 3, censusMatched: 0 });
  });

  it("joins census by PCID before SIS id before email, and roster and housing too", () => {
    const byEmail = fakeCensus({ pcid: "P000999999", email: "alex.example@avemaria.edu", classLevel: "Freshman" });
    const byPcid = fakeCensus({ pcid: "P000000111", email: "other@avemaria.edu", classLevel: "Junior", dob: "2005-01-01" });
    const sources: ProfileSources = {
      census: { students: [byEmail, byPcid], asOf: null },
      roster: { rows: [{ pcid: "P000000111", currentsport: "Ultimate Frisbee" }], asOf: null },
      housing: {
        residents: [{ pcid: "P000000111", building: "JPII", room: "204" } as Resident],
        asOf: null,
      },
    };
    const model = buildExportModel(
      [fakeCourse(), fakeCourse({ studentHmac: "h2", studentSisId: "NOPE", email: "alex.example@my.avemaria.edu", lastName: "Zed" })],
      sources,
    );
    const [first, second] = model.students;
    assert.equal(first![col("Class level")], "Junior");
    assert.equal(first![col("Date of birth")], "2005-01-01");
    assert.equal(first![col("Census match")], "Matched");
    assert.equal(first![col("Roster sport")], "Ultimate Frisbee");
    assert.equal(first![col("Housing hall")], "St. John Paul II Hall");
    // Second student only matches by email (the my.avemaria.edu twin).
    assert.equal(second![col("Class level")], "Freshman");
    assert.equal(second![col("PCID or SIS id")], "NOPE");
    assert.equal(model.counts.censusMatched, 2);
  });

  it("never joins another student's census row by a shared email when PCIDs disagree", () => {
    const wrong = fakeCensus({ pcid: "P000999999", email: "alex.example@avemaria.edu", dob: "1999-09-09" });
    const model = buildExportModel([fakeCourse()], { ...NO_SOURCES, census: { students: [wrong], asOf: null } });
    const row = model.students[0]!;
    assert.equal(row[col("Census match")], "Not found");
    assert.equal(row[col("Date of birth")], null);
    assert.equal(model.counts.censusMatched, 0);
  });

  it("writes Census PCID in the same P + 9 digit form as the AspireDU id", () => {
    const model = buildExportModel([fakeCourse()], {
      ...NO_SOURCES,
      census: { students: [fakeCensus({ pcid: "111" })], asOf: null },
    });
    assert.equal(model.students[0]![col("Census PCID")], "P000000111");
    assert.equal(model.students[0]![col("PCID or SIS id")], "P000000111");
  });

  it("marks unmatched students when the census loaded", () => {
    const model = buildExportModel([fakeCourse()], { ...NO_SOURCES, census: { students: [], asOf: null } });
    assert.equal(model.students[0]![col("Census match")], "Not found");
  });
});

describe("buildExportWorkbook", () => {
  it("writes Students and Classes sheets with every census column, filters, and frozen headers", () => {
    const { buffer, counts } = buildExportWorkbook(
      [fakeCourse(), fakeCourse({ course: "PHIL 101", sectionSisId: "PHIL101-02" })],
      { ...NO_SOURCES, census: { students: [fakeCensus({ pcid: "P000000111", acComments: "A & B <ok>" })], asOf: null } },
    );
    assert.deepEqual(counts, { students: 1, classes: 2, censusMatched: 1 });
    // A real xlsx (zip) file, not delimited text.
    assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
    const files = unzipEntries(buffer);
    const names = [...files["xl/workbook.xml"]!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(names, ["Students", "Classes"]);

    const students = files["xl/worksheets/sheet1.xml"]!;
    const classes = files["xl/worksheets/sheet2.xml"]!;
    for (const xml of [students, classes]) {
      assert.match(xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
      assert.match(xml, /<autoFilter ref="A1:[A-Z]+\d+"\/>/);
    }

    const sGrid = sheetGrid(students);
    assert.deepEqual(sGrid[0], STUDENT_COLUMNS.map((c) => c.header));
    for (const f of CENSUS_FIELDS) assert.ok(sGrid[0]!.includes(f.header), f.header);
    assert.equal(sGrid[1]![col("AC comments")], "A & B <ok>");
    assert.equal(sGrid[1]![col("Census PCID")], "P000000111");

    const cGrid = sheetGrid(classes);
    assert.deepEqual(cGrid[0], CLASS_COLUMNS.map((c) => c.header));
    assert.equal(cGrid.length, 3);
    assert.deepEqual(cGrid[1], [
      "Example",
      "Alex",
      "P000000111",
      "PHIL 101",
      "PHIL101-02",
      "Fall 2026",
      91,
      "A-",
      1,
      0,
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ]);
    // The student hash never reaches the sheet.
    assert.doesNotMatch(students + classes, /hmac-1/);
  });

  it("names the file for Eastern time", () => {
    assert.equal(exportFileName(new Date("2026-09-27T02:00:00Z")), "academic-affairs-students-2026-09-26.xlsx");
  });
});
