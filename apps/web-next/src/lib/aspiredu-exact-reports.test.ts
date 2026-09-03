import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATHLETICS_GRADE_COLUMNS,
  ATHLETICS_PROVISIONAL_COLUMNS,
  GAP_HEADERS,
  SPRING_EOT,
  SPRING_EOT_COURSE_COLUMNS,
  SPRING_EOT_OVERVIEW_COLUMNS,
  SPRING_EOT_PROFESSOR_COLUMNS,
  SSS_ALL_CLASSES_COLUMNS,
  SSS_ATTENDANCE_COLUMNS,
  SSS_DATA_COLUMNS,
  SSS_DD_REPORT_COLUMNS,
  SSS_FULL_NOTES_COLUMNS,
  SSS_MASTER,
  SUMMER1_PROVISIONAL_COLUMNS,
  allGapRows,
  buildAthleticsGradeWorkbook,
  buildAthleticsProvisionalWorkbook,
  buildPowerCampusGapWorkbook,
  buildSpringEotWorkbook,
  courseIdPlus,
  gapRowsFor,
  headersOf,
  isSpringTerm,
  letterFromPercent,
  mapRows,
  professorGradeRows,
  springTermRows,
  uniqueStudents,
  type CourseRow,
} from "./aspiredu-exact-reports";
import { crc32, unzipStore } from "./aspiredu-xlsx";

function row(partial: Partial<CourseRow> & { studentKey: string }): CourseRow {
  return partial;
}

const ADA: CourseRow = row({
  studentKey: "stu-ada",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.edu",
  studentSisId: "1001",
  course: "Analytical Engine",
  courseSisId: "MATH 101",
  sectionSisId: "01",
  courseTerm: "2026/SP",
  courseGrade: 94,
  risk: 2,
  missingAssignments: 1,
  zeroAssignments: 0,
  latestAttendance: "2026-03-01T12:00:00Z",
});

const ADA_SECOND: CourseRow = row({
  studentKey: "stu-ada",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.edu",
  studentSisId: "1001",
  course: "Notes",
  courseSisId: "ENG 200",
  sectionSisId: "02",
  courseTerm: "2026/SP",
  courseGrade: 88,
  risk: 2,
});

const CHARLES: CourseRow = row({
  studentKey: "stu-charles",
  firstName: "Charles",
  lastName: "Babbage",
  email: "charles@example.edu",
  studentSisId: "1002",
  course: "Difference Engine",
  courseSisId: "MATH 101",
  sectionSisId: "01",
  courseTerm: "2026/SP",
  courseGrade: 71,
  risk: 5,
});

describe("template header order", () => {
  it("matches Athletics Provisional", () => {
    assert.deepEqual(headersOf(ATHLETICS_PROVISIONAL_COLUMNS), [
      "PCID",
      "Stu Last Name",
      "Stu First Name",
      "Stu Middle Name",
      "SESSION",
      "GENDER",
      "class level",
      "SSS Advisor",
      "Association",
      "Mid Term GPA",
      "Cumulative Attempted Credits",
      "Cumulative Earned Credits",
      "Cumulative GPA",
      "Course ID",
      "Section",
      "ROOM TYPE",
      "Course Type",
      "Course Desc",
      "Repeated",
      "PCID+",
      "MID GRADE",
      "PCID+",
      "FINAL GRADE",
      "PROGRAM",
      "CURRICULUM",
      "CREDITS",
      "ADDS",
      "PCT %",
      "ADDRESS LINE 1",
      "CITY",
      "STATE",
      "ZIP CODE",
      "COUNTRY",
      "EMAIL ADDRESS",
      "Instructor ID",
      "Instr Last Name",
      "Instr First Name",
    ]);
  });

  it("matches Summer 1 Athletic Provisional", () => {
    assert.deepEqual(headersOf(SUMMER1_PROVISIONAL_COLUMNS), [
      "PCID",
      "Stu Last Name",
      "Stu First Name",
      "Stu Middle Name",
      "SESSION",
      "GENDER",
      "class level",
      "Mid Term GPA",
      "Cumulative Attempted Credits",
      "Cumulative Earned Credits",
      "Cumulative GPA",
      "association",
      "Course ID",
      "Section",
      "ROOM TYPE",
      "Course Type",
      "Course Desc",
      "Repeated",
      "MID GRADE",
      "FINAL GRADE",
      "PROGRAM",
      "CURRICULUM",
      "CREDITS",
      "ADDS",
      "PCT %",
      "ADDRESS LINE 1",
      "CITY",
      "STATE",
      "ZIP CODE",
      "COUNTRY",
      "EMAIL ADDRESS",
      "Instructor ID",
      "Instr Last Name",
      "Instr First Name",
    ]);
  });

  it("matches Athletics Grade Report including trailing spaces", () => {
    assert.deepEqual(headersOf(ATHLETICS_GRADE_COLUMNS), [
      "PCID",
      "Stu Last Name",
      "Stu First Name",
      "Stu Middle Name",
      "SESSION",
      "GENDER",
      "class level",
      "Mid Term GPA",
      "F25 Attempted",
      "F25 Earned",
      "SP26 Attempted",
      "SP26 Earned ",
      "AY 2025-2026 Credits",
      "Cumulative Attempted Credits",
      "Cumulative Earned Credits",
      "Cumulative GPA",
      "association",
      "Course ID",
      "Section",
      "ROOM TYPE",
      "Course Type",
      "Course Desc",
      "Repeated",
      "MID GRADE",
      "FINAL GRADE",
      "PROGRAM",
      "CURRICULUM",
      "CREDITS",
      "ADDS",
      "PCT %",
      "ADDRESS LINE 1",
      "CITY",
      "STATE",
      "ZIP CODE",
      "COUNTRY",
      "EMAIL ADDRESS",
      "Instructor ID",
      "Instr Last Name",
      "Instr First Name",
      "PCID+",
    ]);
  });

  it("matches Spring EOT sheets", () => {
    assert.deepEqual(headersOf(SPRING_EOT_OVERVIEW_COLUMNS), [
      "PCID",
      "Last Name",
      "First Name",
      "Year",
      "Term",
      "Session",
      "Athletic Association",
      "Institute",
      "Primary Flag",
      "Program",
      "Visa",
      "Degree",
      "Curriculum",
      "FT/PT",
      "Gender",
      "Ethnicity",
      "Class Level",
      "Honors",
      "GPA",
      "Cumulative Earned Credits",
      "# of Class Absences",
      "SSS Meetings",
      "SSS Outreach ",
      "Missed SSS Meeting ",
      "Sport",
      "Advisor",
      "Advisor Email",
      "Email",
      "Athlete+",
      "Athlete",
      "GPA BIN",
    ]);
    assert.deepEqual(headersOf(SPRING_EOT_COURSE_COLUMNS), [
      "PCID",
      "Stu Last Name",
      "Stu First Name",
      "Stu Middle Name",
      "SESSION",
      "GENDER",
      "class level",
      "Mid Term GPA",
      "Cumulative Attempted Credits",
      "Cumulative Earned Credits",
      "Cumulative GPA",
      "association",
      "Institute",
      "Course ID",
      "Section",
      "ROOM TYPE",
      "Course Type",
      "Course Desc",
      "Repeated",
      "MID GRADE",
      "FINAL GRADE",
      "PROGRAM",
      "CURRICULUM",
      "CREDITS",
      "ADDS",
      "PCT %",
      "ADDRESS LINE 1",
      "CITY",
      "STATE",
      "ZIP CODE",
      "COUNTRY",
      "EMAIL ADDRESS",
      "Instructor ID",
      "Instr Last Name",
      "Instr First Name",
      "PCID+",
      "FACULTY PCID+",
      "COURSE ID+",
    ]);
    assert.deepEqual(headersOf(SPRING_EOT_PROFESSOR_COLUMNS), [
      "COURSE ID+",
      "A",
      "A-",
      "B+",
      "B",
      "B-",
      "C+",
      "C",
      "C-",
      "D+",
      "D",
      "D-",
      "F",
      "I",
      "W",
    ]);
    assert.equal(SPRING_EOT.sheets[2].name, "Tables By GPA");
    assert.equal(SPRING_EOT.sheets[2].kind, "empty");
  });

  it("matches SSS current tabs including the empty All Classes header", () => {
    assert.deepEqual(headersOf(SSS_FULL_NOTES_COLUMNS), [
      "ID",
      "Last Name",
      "First Name",
      "Middle Name",
      "Curriculum",
      "Class",
      "ASO",
      "ID",
      "SSS Advisor",
      "ID",
      "Athletic Association",
      "DSO",
      "ID",
      "Institute",
      "DD Score",
      "Total Absences",
      "# SSS Meetings",
      "# SSS Outreach",
      "Mid-GPA",
      "SSS Notes",
      "Full Part Time",
      "Credits",
      "ID",
      "Cumulative GPA",
      "Gender",
      "Ethnicity",
      "Address Line 1",
      "Address Line 2",
      "City",
      "State",
      "Zip",
      "Phone Number",
      "Email",
    ]);
    assert.equal(SSS_ALL_CLASSES_COLUMNS.length, 41);
    assert.equal(SSS_ALL_CLASSES_COLUMNS[21].header, "");
    assert.deepEqual(headersOf(SSS_ALL_CLASSES_COLUMNS), [
      "PCID",
      "Stu Last Name",
      "Stu First Name",
      "Stu Middle Name",
      "SESSION",
      "GENDER",
      "class level",
      "SSS Advisor",
      "Association",
      "Institute",
      "DD-Score",
      "Grade",
      "Letter Grade",
      "Classes Absences 03.16.26",
      "Missing Assignments 03.16.26",
      "Zero Assignments 03.16.26",
      "# of DD Notes",
      "Course ID",
      "Section",
      "ROOM TYPE",
      "Course Type",
      "",
      "Course Desc",
      "Repeated",
      "MID GRADE",
      "FINAL GRADE",
      "PROGRAM",
      "CURRICULUM",
      "CREDITS",
      "ADDS",
      "PCID+",
      "PCT %",
      "ADDRESS LINE 1",
      "CITY",
      "STATE",
      "ZIP CODE",
      "COUNTRY",
      "EMAIL ADDRESS",
      "Instructor ID",
      "Instr Last Name",
      "Instr First Name",
    ]);
    assert.deepEqual(headersOf(SSS_DD_REPORT_COLUMNS), [
      "student",
      "student_sis_id",
      "email",
      "student_sis_id",
      "risk",
      "student_sis_id",
      "course 1 course_sis_id",
      "course 1",
      "course 1 term",
      "PCID+",
      "course 1 grade",
      "PCID+",
      "course 1 missing assignments",
      "PCID+",
      "course 1 zero assignments",
    ]);
    assert.deepEqual(headersOf(SSS_ATTENDANCE_COLUMNS), [
      "Course ID",
      "SIS Student ID",
      "SIS Course ID",
      "SIS Section ID",
      "Course Code",
      "Course Name",
      "Teacher ID",
      "SIS Teacher ID",
      "Teacher Name",
      "Student ID",
      "SIS Student ID",
      "Student Name",
      "Class Date",
      "SIS Student ID",
      "PCID+",
      "Attendance",
      "Timestamp",
    ]);
    assert.deepEqual(headersOf(SSS_DATA_COLUMNS), ["Grade", "GPA"]);
    assert.equal(SSS_MASTER.sheets.some((sheet) => /9\.8\.25|F25|1\.26\.26/.test(sheet.name)), false);
  });
});

describe("mapping", () => {
  it("fills Dropout Detective fields and leaves PowerCampus cells empty", () => {
    const mapped = mapRows(ATHLETICS_PROVISIONAL_COLUMNS, [ADA])[0];
    const byHeader = Object.fromEntries(
      ATHLETICS_PROVISIONAL_COLUMNS.map((column, i) => [`${i}:${column.header}`, mapped[i]]),
    );
    assert.equal(byHeader["0:PCID"], "1001");
    assert.equal(byHeader["1:Stu Last Name"], "Lovelace");
    assert.equal(byHeader["2:Stu First Name"], "Ada");
    assert.equal(byHeader["3:Stu Middle Name"], "");
    assert.equal(byHeader["4:SESSION"], "2026/SP");
    assert.equal(byHeader["5:GENDER"], "");
    assert.equal(byHeader["7:SSS Advisor"], "");
    assert.equal(byHeader["13:Course ID"], "MATH 101");
    assert.equal(byHeader["14:Section"], "01");
    assert.equal(byHeader["17:Course Desc"], "Analytical Engine");
    assert.equal(byHeader["19:PCID+"], "");
    assert.equal(byHeader["20:MID GRADE"], "");
    assert.equal(byHeader["22:FINAL GRADE"], 94);
    assert.equal(byHeader["33:EMAIL ADDRESS"], "ada@example.edu");
    assert.equal(byHeader["34:Instructor ID"], "");
    assert.equal(mapped.includes("MISSING"), false);
  });

  it("does not invent values when a field is absent", () => {
    const sparse = row({ studentKey: "stu-sparse", course: "BIO 101" });
    const mapped = mapRows(SUMMER1_PROVISIONAL_COLUMNS, [sparse])[0];
    assert.equal(mapped[0], "");
    assert.equal(mapped[1], "");
    assert.equal(mapped[12], "BIO 101");
    assert.equal(mapped[16], "BIO 101");
    assert.ok(mapped.every((value) => value === "" || value === "BIO 101"));
  });

  it("keeps All Classes FINAL GRADE blank and fills Grade plus letter", () => {
    const mapped = mapRows(SSS_ALL_CLASSES_COLUMNS, [ADA])[0];
    assert.equal(mapped[11], 94);
    assert.equal(mapped[12], "A");
    assert.equal(mapped[21], "");
    assert.equal(mapped[25], "");
    assert.equal(mapped[14], 1);
    assert.equal(mapped[15], 0);
  });

  it("leaves DD Report PCID+ blank because studentSisId is already in student_sis_id", () => {
    const mapped = mapRows(SSS_DD_REPORT_COLUMNS, [ADA])[0];
    assert.equal(mapped[1], "1001");
    assert.equal(mapped[3], "1001");
    assert.equal(mapped[5], "1001");
    assert.equal(mapped[9], "");
    assert.equal(mapped[11], "");
    assert.equal(mapped[13], "");
  });

  it("leaves SSS Attendance as a blank class code, not latestAttendance", () => {
    const attendanceIndex = SSS_ATTENDANCE_COLUMNS.findIndex((column) => column.header === "Attendance");
    assert.ok(attendanceIndex >= 0);
    assert.equal(SSS_ATTENDANCE_COLUMNS[attendanceIndex].status, "kept blank: DD file not ingested");
    assert.equal(SSS_ATTENDANCE_COLUMNS[attendanceIndex].from, undefined);
    const mapped = mapRows(SSS_ATTENDANCE_COLUMNS, [ADA])[0];
    assert.equal(mapped[attendanceIndex], "");
    assert.equal(mapped.includes("2026-03-01T12:00:00Z"), false);
  });
});

describe("letter bins and student grain", () => {
  it("bins numeric grades with the existing scale", () => {
    assert.equal(letterFromPercent(94), "A");
    assert.equal(letterFromPercent(90), "A-");
    assert.equal(letterFromPercent(87), "B+");
    assert.equal(letterFromPercent(83), "B");
    assert.equal(letterFromPercent(71), "C-");
    assert.equal(letterFromPercent(0), "F");
    assert.equal(letterFromPercent(-1), undefined);
  });

  it("groups professor tables by COURSE ID+ and leaves I/W blank", () => {
    const table = professorGradeRows([ADA, ADA_SECOND, CHARLES]);
    assert.deepEqual(
      table.map((entry) => entry[0]),
      ["ENG 200", "MATH 101"],
    );
    const math = table.find((entry) => entry[0] === "MATH 101")!;
    assert.equal(math[1], 1);
    assert.equal(math[8], 1);
    assert.equal(math[13], "");
    assert.equal(math[14], "");
    assert.equal(courseIdPlus(ADA), "MATH 101");
  });

  it("drops a SU1 term row and keeps a Spring term", () => {
    const spring = row({ ...ADA, courseTerm: "2026/SP" });
    const summer = row({ ...CHARLES, courseTerm: "SU1" });
    const filtered = springTermRows([summer, spring]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].courseTerm, "2026/SP");
    const files = unzipStore(buildAthleticsGradeWorkbook([summer, spring]));
    const sheet = files["xl/worksheets/sheet1.xml"];
    assert.ok(sheet.includes(">2026/SP<"));
    assert.equal(sheet.includes("SU1"), false);
  });

  it("keeps vendor 2026/SP and other spring labels, and drops summer and fall", () => {
    for (const term of ["2026/SP", "2026-SP", "SP26", "SP 26", "Spring 2026", "spring"]) {
      assert.equal(isSpringTerm(term), true, term);
    }
    for (const term of ["SU1", "2026/SU1", "Summer 1", "2026/FA", "FA26"]) {
      assert.equal(isSpringTerm(term), false, term);
    }
    const kept = springTermRows([row({ ...ADA, courseTerm: "2026/SP" })]);
    const dropped = springTermRows([row({ ...CHARLES, courseTerm: "2026/SU1" })]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].courseTerm, "2026/SP");
    assert.equal(dropped.length, 0);
    const files = unzipStore(
      buildAthleticsGradeWorkbook([
        row({ ...ADA, courseTerm: "2026/SP" }),
        row({ ...CHARLES, courseTerm: "2026/SU1" }),
      ]),
    );
    const sheet = files["xl/worksheets/sheet1.xml"];
    assert.ok(sheet.includes(">2026/SP<"));
    assert.equal(sheet.includes("SU1"), false);
  });

  it("dedupes student-grain rows by SIS id then studentKey", () => {
    const students = uniqueStudents([ADA, ADA_SECOND, CHARLES]);
    assert.equal(students.length, 2);
    assert.equal(students[0].studentSisId, "1001");
    assert.equal(students[1].studentSisId, "1002");
    const overview = mapRows(SPRING_EOT_OVERVIEW_COLUMNS, students);
    assert.equal(overview.length, 2);
    assert.equal(overview[0][1], "Lovelace");
    assert.equal(overview[0][5], "2026/SP");
    assert.equal(overview[0][3], "");
    assert.equal(overview[0][18], "");
  });
});

describe("gap sheet", () => {
  it("lists every PowerCampus column from every template", () => {
    const rows = allGapRows();
    const powerCampus = rows.filter((row) => row.status === "blank: grab from PowerCampus");
    assert.ok(powerCampus.length > 0);
    const headers = new Set(powerCampus.map((row) => row.column));
    for (const required of [
      "GENDER",
      "class level",
      "Mid Term GPA",
      "Cumulative Attempted Credits",
      "Cumulative Earned Credits",
      "Cumulative GPA",
      "Sport",
      "CREDITS",
      "Instructor ID",
      "ADDRESS LINE 1",
      "F25 Attempted",
      "Visa",
      "Ethnicity",
      "GPA BIN",
    ]) {
      assert.ok(headers.has(required), `missing PowerCampus column ${required}`);
    }
    assert.ok(rows.some((row) => row.status === "filled from Dropout Detective"));
    assert.ok(rows.some((row) => row.status === "SSS operational"));
    assert.ok(rows.some((row) => row.status === "kept blank: DD file not ingested"));
    assert.ok(rows.some((row) => row.column === "Fall Semester Tutoring Interest Form"));
    assert.ok(
      rows.some(
        (row) =>
          row.column === "latestAttendance" &&
          row.sheet === "Attendance" &&
          row.status === "not mapped into this template's Attendance column",
      ),
    );
    assert.ok(
      rows.some(
        (row) =>
          row.column === "Attendance" &&
          row.sheet === "Attendance" &&
          row.status === "kept blank: DD file not ingested",
      ),
    );
    assert.ok(rows.some((row) => row.sheet === "Tables By GPA"));
    assert.deepEqual([...GAP_HEADERS], ["Report", "Sheet", "Column", "Status"]);
  });

  it("includes each template column on the report gap sheet", () => {
    const spring = gapRowsFor(SPRING_EOT);
    for (const header of headersOf(SPRING_EOT_COURSE_COLUMNS)) {
      assert.ok(
        spring.some((row) => row.sheet === "EOT by Course with Mid 05.13.26" && row.column === header),
        header,
      );
    }
  });

  it("writes a schema-only PowerCampus workbook with no student rows", () => {
    const files = unzipStore(buildPowerCampusGapWorkbook());
    const sheet = files["xl/worksheets/sheet1.xml"];
    assert.ok(sheet);
    assert.equal((sheet.match(/<row r="/g) || []).length, allGapRows().length + 1);
    assert.equal(sheet.includes("Ada"), false);
    assert.equal(sheet.includes("Lovelace"), false);
    assert.equal(sheet.includes("ada@"), false);
  });
});

describe("xlsx writer", () => {
  it("crc32 matches the common check value", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  });

  it("embeds exact headers including trailing spaces", () => {
    const files = unzipStore(buildAthleticsProvisionalWorkbook([ADA]));
    const sheet = files["xl/worksheets/sheet1.xml"];
    assert.ok(sheet.includes(">PCID<"));
    assert.ok(sheet.includes(">Stu Last Name<"));
    assert.ok(sheet.includes(">Lovelace<"));
    const gap = files["xl/worksheets/sheet2.xml"];
    assert.ok(gap.includes("PowerCampus"));
    const spring = unzipStore(buildSpringEotWorkbook([ADA, ADA_SECOND]));
    assert.ok(spring["xl/workbook.xml"].includes("SP 26&apos; Overview") || spring["xl/workbook.xml"].includes("SP 26' Overview"));
    assert.ok(spring["xl/worksheets/sheet3.xml"]);
    const prof = spring["xl/worksheets/sheet4.xml"];
    assert.ok(prof.includes("COURSE ID+"));
  });
});
