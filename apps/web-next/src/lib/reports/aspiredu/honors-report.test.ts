import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HONORS_FA2026_FRESHMEN_PCIDS,
  isHonorsFreshmanPcid,
} from "./honors-roster";
import {
  buildHonorsReportData,
  buildHonorsWorkbook,
  type HonorsReportData,
} from "./honors-report";
import type { CensusRawStudent } from "../census/lists-core";

describe("Honors Freshmen Roster (DST-3065)", () => {
  it("contains exactly 92 unique freshmen PCIDs", () => {
    assert.equal(HONORS_FA2026_FRESHMEN_PCIDS.length, 92);
    for (const pcid of HONORS_FA2026_FRESHMEN_PCIDS) {
      assert.match(pcid, /^P\d{9}$/);
      assert.equal(isHonorsFreshmanPcid(pcid), true);
      assert.equal(isHonorsFreshmanPcid(pcid.toLowerCase()), true);
      assert.equal(isHonorsFreshmanPcid(pcid.replace(/^P0*/, "")), true);
    }
  });

  it("rejects non-freshmen or non-honors PCIDs", () => {
    assert.equal(isHonorsFreshmanPcid("P999999999"), false);
    assert.equal(isHonorsFreshmanPcid(""), false);
    assert.equal(isHonorsFreshmanPcid(null), false);
  });
});

describe("buildHonorsReportData", () => {
  const sampleLambdaStudents = [
    {
      pcid: "P000000001",
      studentKey: "key-1",
      firstName: "Jane",
      lastName: "Doe",
      name: "Jane Doe",
      email: "jane.doe@avemaria.edu",
      overallRisk: 12,
      courses: [
        {
          course: "Honors Western Civ I",
          courseSisId: "HON-101-01",
          sectionSisId: "2026FA-HON-101-01",
          grade: 95.5,
          missingAssignments: 0,
          timesAbsent: 0,
          timesPresent: 14,
        },
        {
          course: "Honors Literature I",
          courseSisId: "HON-103-01",
          sectionSisId: "2026FA-HON-103-01",
          grade: 88.0,
          missingAssignments: 1,
          timesAbsent: 1,
          timesPresent: 13,
        },
        {
          course: "Composition",
          courseSisId: "ENG-101-02",
          sectionSisId: "2026FA-ENG-101-02",
          grade: null,
          missingAssignments: 0,
          timesAbsent: 0,
          timesPresent: 10,
        },
      ],
    },
    {
      pcid: "P000000002",
      studentKey: "key-2",
      firstName: "John",
      lastName: "Smith",
      name: "John Smith",
      email: "john.smith@avemaria.edu",
      overallRisk: 45,
      courses: [
        {
          course: "Honors Biology",
          courseSisId: "BIO-101-01",
          sectionSisId: "2026FA-BIO-101-01",
          grade: 76.0,
          missingAssignments: 2,
          timesAbsent: 2,
          timesPresent: 12,
        },
      ],
    },
  ];

  const sampleCensus: CensusRawStudent[] = [
    {
      pcid: "P000000001",
      curriculum: "HUMANITIES",
      honors: "Hons",
      term: "2026FA",
    },
    {
      pcid: "P000000002",
      curriculum: "BIOLOGY",
      honors: "Hons",
      term: "2026FA",
    },
  ];

  it("computes provisional GPA, average percent, and joins census curriculum", () => {
    const report = buildHonorsReportData(
      sampleLambdaStudents,
      sampleCensus,
      "2026-10-12T12:00:00Z",
      ["P000000001", "P000000002"],
    );

    assert.equal(report.students.length, 2);

    const jane = report.students.find((s) => s.pcid === "P000000001")!;
    assert.ok(jane);
    assert.equal(jane.name, "Jane Doe");
    assert.equal(jane.curriculum, "HUMANITIES");
    assert.equal(jane.gradedCourses, 2);
    assert.equal(jane.totalCourses, 3);
    // 95.5% is A (4.0), 88.0% is B+ (3.3) -> average is 3.65
    assert.equal(jane.gpaEstimate, 3.65);
    // (95.5 + 88.0) / 2 = 91.75 -> rounded to 91.8
    assert.equal(jane.avgGrade, 91.8);
    assert.equal(jane.missingAssignments, 1);
    assert.equal(jane.totalAbsences, 1);

    const john = report.students.find((s) => s.pcid === "P000000002")!;
    assert.ok(john);
    assert.equal(john.curriculum, "BIOLOGY");
    assert.equal(john.gradedCourses, 1);
    // 76.0% is C (2.0)
    assert.equal(john.gpaEstimate, 2.0);
    assert.equal(john.avgGrade, 76.0);
    assert.equal(john.missingAssignments, 2);
  });

  it("calculates cohort summary statistics accurately", () => {
    const report = buildHonorsReportData(
      sampleLambdaStudents,
      sampleCensus,
      "2026-10-12T12:00:00Z",
      ["P000000001", "P000000002"],
    );
    const summary = report.summary;

    assert.equal(summary.studentCount, 2);
    assert.equal(summary.matchedCount, 2);
    // (3.65 + 2.0) / 2 = 2.825 -> 2.83
    assert.equal(summary.cohortGpa, 2.83);
    // (91.8 + 76.0) / 2 = 83.9
    assert.equal(summary.cohortAvgGrade, 83.9);
    assert.equal(summary.totalCourses, 4);
    assert.equal(summary.totalGradedCourses, 3);
    assert.equal(summary.studentsAbove38, 0);
    assert.equal(summary.studentsAbove35, 1);
    assert.equal(summary.studentsBelow30, 1);
    assert.equal(summary.studentsWithMissingWork, 2);
    assert.equal(summary.totalMissingAssignments, 3);
  });
});

describe("buildHonorsWorkbook", () => {
  it("builds a valid Excel workbook buffer with summary and classes sheets", () => {
    const dummyData: HonorsReportData = {
      summary: {
        asOf: "2026-10-12T12:00:00Z",
        studentCount: 1,
        matchedCount: 1,
        cohortGpa: 3.85,
        cohortAvgGrade: 95.0,
        totalCourses: 2,
        totalGradedCourses: 2,
        studentsAbove38: 1,
        studentsAbove35: 1,
        studentsBelow30: 0,
        studentsWithMissingWork: 0,
        totalMissingAssignments: 0,
      },
      students: [
        {
          pcid: "P000000001",
          studentKey: "key-1",
          firstName: "Jane",
          lastName: "Doe",
          name: "Jane Doe",
          email: "jane.doe@avemaria.edu",
          curriculum: "HUMANITIES",
          gpaEstimate: 3.85,
          avgGrade: 95.0,
          gradedCourses: 2,
          totalCourses: 2,
          missingAssignments: 0,
          overallRisk: 10,
          totalAbsences: 0,
          pulseBand: "green",
          courses: [
            {
              course: "Honors Western Civ I",
              courseSisId: "HON-101-01",
              sectionSisId: "2026FA-HON-101-01",
              term: "2026FA",
              grade: 96.0,
              letter: "A",
              gpaPoints: 4.0,
              missingAssignments: 0,
              timesAbsent: 0,
              timesPresent: 14,
              latestAttendance: "Present",
              courseLastAccess: "2026-10-12",
            },
          ],
        },
      ],
    };

    const buffer = buildHonorsWorkbook(dummyData);
    assert.ok(buffer instanceof Uint8Array);
    assert.ok(buffer.length > 500, "Workbook buffer should have valid ZIP/XLSX content");

    // Standard zip magic number is PK\x03\x04
    assert.equal(buffer[0], 0x50);
    assert.equal(buffer[1], 0x4b);
    assert.equal(buffer[2], 0x03);
    assert.equal(buffer[3], 0x04);
  });
});
