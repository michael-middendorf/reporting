import { SimpleXlsx, type CellValue, triggerXlsxDownload } from "./aspiredu-xlsx";

export { triggerXlsxDownload };
export type { CellValue };

export type CourseRow = {
  studentKey: string;
  studentHmac?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  studentSisId?: string;
  course?: string;
  courseSisId?: string;
  sectionSisId?: string;
  courseTerm?: string;
  courseGrade?: number;
  courseRiskScore?: number;
  courseRiskTrend?: number;
  risk?: number;
  riskTrend?: number;
  missingAssignments?: number;
  zeroAssignments?: number;
  courseLda?: string;
  courseLastAccess?: string;
  latestAttendance?: string;
  lastLogin?: string;
};

export const LETTERS = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"] as const;
export type LetterGrade = (typeof LETTERS)[number];

export function letterFromPercent(grade: number): LetterGrade | undefined {
  if (grade >= 93) return "A";
  if (grade >= 90) return "A-";
  if (grade >= 87) return "B+";
  if (grade >= 83) return "B";
  if (grade >= 80) return "B-";
  if (grade >= 77) return "C+";
  if (grade >= 73) return "C";
  if (grade >= 70) return "C-";
  if (grade >= 67) return "D+";
  if (grade >= 63) return "D";
  if (grade >= 60) return "D-";
  if (grade >= 0) return "F";
  return undefined;
}

export type GapStatus =
  | "filled from Dropout Detective"
  | "blank: grab from PowerCampus"
  | "kept blank: DD file not ingested"
  | "SSS operational"
  | "not generated (Microsoft Form)";

export type ColumnDef = {
  header: string;
  status: GapStatus;
  from?: (row: CourseRow) => CellValue;
};

export type GapRow = {
  report: string;
  sheet: string;
  column: string;
  status: string;
};

export type SheetKind = "course" | "student" | "professor" | "empty" | "headers-only";

export type SheetDef = {
  name: string;
  kind: SheetKind;
  columns: ColumnDef[];
};

export type ReportDef = {
  id: string;
  title: string;
  filename: string;
  sheets: SheetDef[];
  extraGapRows?: GapRow[];
};

const DD = "filled from Dropout Detective" as const;
const PC = "blank: grab from PowerCampus" as const;
const NOFILE = "kept blank: DD file not ingested" as const;
const SSS = "SSS operational" as const;

function text(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

function num(value: unknown): CellValue {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return "";
}

export function courseIdPlus(row: CourseRow): string {
  return text(row.courseSisId) || text(row.course);
}

function sisId(row: CourseRow): string {
  return text(row.studentSisId);
}

function studentDisplay(row: CourseRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ");
}

function letterOf(row: CourseRow): string {
  if (typeof row.courseGrade !== "number") return "";
  return letterFromPercent(row.courseGrade) || "";
}

function dd(header: string, from: (row: CourseRow) => CellValue): ColumnDef {
  return { header, status: DD, from };
}

function pc(header: string): ColumnDef {
  return { header, status: PC };
}

function nofile(header: string, from?: (row: CourseRow) => CellValue): ColumnDef {
  return { header, status: NOFILE, from };
}

function sss(header: string): ColumnDef {
  return { header, status: SSS };
}

function lastName() {
  return dd("Stu Last Name", (row) => text(row.lastName));
}
function firstName() {
  return dd("Stu First Name", (row) => text(row.firstName));
}
function emailAddress() {
  return dd("EMAIL ADDRESS", (row) => text(row.email));
}
function session() {
  return dd("SESSION", (row) => text(row.courseTerm));
}
function courseId() {
  return dd("Course ID", (row) => courseIdPlus(row));
}
function section() {
  return dd("Section", (row) => text(row.sectionSisId));
}
function courseDesc() {
  return dd("Course Desc", (row) => text(row.course));
}
function finalGrade() {
  return dd("FINAL GRADE", (row) => num(row.courseGrade));
}
function pcid() {
  return dd("PCID", (row) => sisId(row));
}

const COURSE_TAIL = [
  pc("ROOM TYPE"),
  pc("Course Type"),
  courseDesc(),
  pc("Repeated"),
] as const;

const ADDRESS_INSTRUCTOR = [
  pc("ADDRESS LINE 1"),
  pc("CITY"),
  pc("STATE"),
  pc("ZIP CODE"),
  pc("COUNTRY"),
  emailAddress(),
  pc("Instructor ID"),
  pc("Instr Last Name"),
  pc("Instr First Name"),
] as const;

const CREDITS_BLOCK = [
  pc("PROGRAM"),
  pc("CURRICULUM"),
  pc("CREDITS"),
  pc("ADDS"),
] as const;

export const ATHLETICS_PROVISIONAL_COLUMNS: ColumnDef[] = [
  pcid(),
  lastName(),
  firstName(),
  pc("Stu Middle Name"),
  session(),
  pc("GENDER"),
  pc("class level"),
  sss("SSS Advisor"),
  pc("Association"),
  pc("Mid Term GPA"),
  pc("Cumulative Attempted Credits"),
  pc("Cumulative Earned Credits"),
  pc("Cumulative GPA"),
  courseId(),
  section(),
  ...COURSE_TAIL,
  pc("PCID+"),
  pc("MID GRADE"),
  pc("PCID+"),
  finalGrade(),
  ...CREDITS_BLOCK,
  pc("PCT %"),
  ...ADDRESS_INSTRUCTOR,
];

export const SUMMER1_PROVISIONAL_COLUMNS: ColumnDef[] = [
  pcid(),
  lastName(),
  firstName(),
  pc("Stu Middle Name"),
  session(),
  pc("GENDER"),
  pc("class level"),
  pc("Mid Term GPA"),
  pc("Cumulative Attempted Credits"),
  pc("Cumulative Earned Credits"),
  pc("Cumulative GPA"),
  pc("association"),
  courseId(),
  section(),
  ...COURSE_TAIL,
  pc("MID GRADE"),
  finalGrade(),
  ...CREDITS_BLOCK,
  pc("PCT %"),
  ...ADDRESS_INSTRUCTOR,
];

export const ATHLETICS_GRADE_COLUMNS: ColumnDef[] = [
  pcid(),
  lastName(),
  firstName(),
  pc("Stu Middle Name"),
  session(),
  pc("GENDER"),
  pc("class level"),
  pc("Mid Term GPA"),
  pc("F25 Attempted"),
  pc("F25 Earned"),
  pc("SP26 Attempted"),
  pc("SP26 Earned "),
  pc("AY 2025-2026 Credits"),
  pc("Cumulative Attempted Credits"),
  pc("Cumulative Earned Credits"),
  pc("Cumulative GPA"),
  pc("association"),
  courseId(),
  section(),
  ...COURSE_TAIL,
  pc("MID GRADE"),
  finalGrade(),
  ...CREDITS_BLOCK,
  pc("PCT %"),
  ...ADDRESS_INSTRUCTOR,
  pc("PCID+"),
];

export const SPRING_EOT_OVERVIEW_COLUMNS: ColumnDef[] = [
  pcid(),
  dd("Last Name", (row) => text(row.lastName)),
  dd("First Name", (row) => text(row.firstName)),
  pc("Year"),
  pc("Term"),
  dd("Session", (row) => text(row.courseTerm)),
  pc("Athletic Association"),
  pc("Institute"),
  pc("Primary Flag"),
  pc("Program"),
  pc("Visa"),
  pc("Degree"),
  pc("Curriculum"),
  pc("FT/PT"),
  pc("Gender"),
  pc("Ethnicity"),
  pc("Class Level"),
  pc("Honors"),
  pc("GPA"),
  pc("Cumulative Earned Credits"),
  nofile("# of Class Absences"),
  sss("SSS Meetings"),
  sss("SSS Outreach "),
  sss("Missed SSS Meeting "),
  pc("Sport"),
  pc("Advisor"),
  pc("Advisor Email"),
  dd("Email", (row) => text(row.email)),
  pc("Athlete+"),
  pc("Athlete"),
  pc("GPA BIN"),
];

export const SPRING_EOT_COURSE_COLUMNS: ColumnDef[] = [
  pcid(),
  lastName(),
  firstName(),
  pc("Stu Middle Name"),
  session(),
  pc("GENDER"),
  pc("class level"),
  pc("Mid Term GPA"),
  pc("Cumulative Attempted Credits"),
  pc("Cumulative Earned Credits"),
  pc("Cumulative GPA"),
  pc("association"),
  pc("Institute"),
  courseId(),
  section(),
  ...COURSE_TAIL,
  pc("MID GRADE"),
  finalGrade(),
  ...CREDITS_BLOCK,
  pc("PCT %"),
  ...ADDRESS_INSTRUCTOR,
  pc("PCID+"),
  pc("FACULTY PCID+"),
  dd("COURSE ID+", (row) => courseIdPlus(row)),
];

export const SPRING_EOT_PROFESSOR_COLUMNS: ColumnDef[] = [
  dd("COURSE ID+", (row) => courseIdPlus(row)),
  ...LETTERS.map((letter) => dd(letter, () => "")),
  nofile("I"),
  nofile("W"),
];

export const SSS_FULL_NOTES_COLUMNS: ColumnDef[] = [
  dd("ID", (row) => sisId(row)),
  dd("Last Name", (row) => text(row.lastName)),
  dd("First Name", (row) => text(row.firstName)),
  pc("Middle Name"),
  pc("Curriculum"),
  pc("Class"),
  pc("ASO"),
  dd("ID", (row) => sisId(row)),
  sss("SSS Advisor"),
  dd("ID", (row) => sisId(row)),
  pc("Athletic Association"),
  pc("DSO"),
  dd("ID", (row) => sisId(row)),
  pc("Institute"),
  dd("DD Score", (row) => num(row.risk)),
  nofile("Total Absences"),
  sss("# SSS Meetings"),
  sss("# SSS Outreach"),
  pc("Mid-GPA"),
  sss("SSS Notes"),
  pc("Full Part Time"),
  pc("Credits"),
  dd("ID", (row) => sisId(row)),
  pc("Cumulative GPA"),
  pc("Gender"),
  pc("Ethnicity"),
  pc("Address Line 1"),
  pc("Address Line 2"),
  pc("City"),
  pc("State"),
  pc("Zip"),
  pc("Phone Number"),
  dd("Email", (row) => text(row.email)),
];

export const SSS_ALL_CLASSES_COLUMNS: ColumnDef[] = [
  pcid(),
  lastName(),
  firstName(),
  pc("Stu Middle Name"),
  session(),
  pc("GENDER"),
  pc("class level"),
  sss("SSS Advisor"),
  pc("Association"),
  pc("Institute"),
  dd("DD-Score", (row) => num(row.risk)),
  dd("Grade", (row) => num(row.courseGrade)),
  dd("Letter Grade", (row) => letterOf(row)),
  nofile("Classes Absences 03.16.26"),
  dd("Missing Assignments 03.16.26", (row) => num(row.missingAssignments)),
  dd("Zero Assignments 03.16.26", (row) => num(row.zeroAssignments)),
  nofile("# of DD Notes"),
  courseId(),
  section(),
  pc("ROOM TYPE"),
  pc("Course Type"),
  pc(""),
  courseDesc(),
  pc("Repeated"),
  pc("MID GRADE"),
  pc("FINAL GRADE"),
  ...CREDITS_BLOCK,
  pc("PCID+"),
  pc("PCT %"),
  ...ADDRESS_INSTRUCTOR,
];

export const SSS_DD_REPORT_COLUMNS: ColumnDef[] = [
  dd("student", (row) => studentDisplay(row)),
  dd("student_sis_id", (row) => sisId(row)),
  dd("email", (row) => text(row.email)),
  dd("student_sis_id", (row) => sisId(row)),
  dd("risk", (row) => num(row.risk)),
  dd("student_sis_id", (row) => sisId(row)),
  dd("course 1 course_sis_id", (row) => text(row.courseSisId)),
  dd("course 1", (row) => text(row.course)),
  dd("course 1 term", (row) => text(row.courseTerm)),
  pc("PCID+"),
  dd("course 1 grade", (row) => num(row.courseGrade)),
  pc("PCID+"),
  dd("course 1 missing assignments", (row) => num(row.missingAssignments)),
  pc("PCID+"),
  dd("course 1 zero assignments", (row) => num(row.zeroAssignments)),
];

export const SSS_ATTENDANCE_COLUMNS: ColumnDef[] = [
  dd("Course ID", (row) => courseIdPlus(row)),
  dd("SIS Student ID", (row) => sisId(row)),
  dd("SIS Course ID", (row) => text(row.courseSisId)),
  dd("SIS Section ID", (row) => text(row.sectionSisId)),
  dd("Course Code", (row) => courseIdPlus(row)),
  dd("Course Name", (row) => text(row.course)),
  nofile("Teacher ID"),
  nofile("SIS Teacher ID"),
  nofile("Teacher Name"),
  dd("Student ID", (row) => sisId(row)),
  dd("SIS Student ID", (row) => sisId(row)),
  dd("Student Name", (row) => studentDisplay(row)),
  nofile("Class Date"),
  dd("SIS Student ID", (row) => sisId(row)),
  pc("PCID+"),
  dd("Attendance", (row) => text(row.latestAttendance)),
  nofile("Timestamp"),
];

export const SSS_DATA_COLUMNS: ColumnDef[] = [pc("Grade"), pc("GPA")];

export const GAP_HEADERS = ["Report", "Sheet", "Column", "Status"] as const;

export const ATHLETICS_PROVISIONAL: ReportDef = {
  id: "athletics-provisional",
  title: "Athletics Provisional",
  filename: "Athletics Provisional Report.xlsx",
  sheets: [{ name: "Sheet1", kind: "course", columns: ATHLETICS_PROVISIONAL_COLUMNS }],
};

export const SUMMER1_PROVISIONAL: ReportDef = {
  id: "summer1-provisional",
  title: "Summer 1 Athletic Provisional",
  filename: "SU 1 Athletic Provisional report.xlsx",
  sheets: [{ name: "Sheet1", kind: "course", columns: SUMMER1_PROVISIONAL_COLUMNS }],
};

export const ATHLETICS_GRADE: ReportDef = {
  id: "athletics-grade",
  title: "Athletics Grade Report",
  filename: "Athletics Grade Report.xlsx",
  sheets: [{ name: "Athletics EOT SP26", kind: "course", columns: ATHLETICS_GRADE_COLUMNS }],
};

export const SPRING_EOT: ReportDef = {
  id: "spring-eot",
  title: "Spring EOT Grade Report",
  filename: "Spring EOT Grade report.xlsx",
  sheets: [
    { name: "SP 26' Overview", kind: "student", columns: SPRING_EOT_OVERVIEW_COLUMNS },
    { name: "EOT by Course with Mid 05.13.26", kind: "course", columns: SPRING_EOT_COURSE_COLUMNS },
    { name: "Tables By GPA", kind: "empty", columns: [] },
    { name: "Tables by Professor", kind: "professor", columns: SPRING_EOT_PROFESSOR_COLUMNS },
  ],
  extraGapRows: [
    {
      report: "Spring EOT Grade Report",
      sheet: "Tables By GPA",
      column: "(no header row)",
      status: "original header row was empty; sheet kept with zero student rows",
    },
  ],
};

export const SSS_MASTER: ReportDef = {
  id: "sss-master",
  title: "Student Support Services Internal Master",
  filename: "Student Support Services Internal Master Sheet.xlsx",
  sheets: [
    { name: "Full Notes", kind: "student", columns: SSS_FULL_NOTES_COLUMNS },
    { name: "All Classes", kind: "course", columns: SSS_ALL_CLASSES_COLUMNS },
    { name: "DD Report", kind: "course", columns: SSS_DD_REPORT_COLUMNS },
    { name: "Attendance", kind: "course", columns: SSS_ATTENDANCE_COLUMNS },
    { name: "DATA", kind: "headers-only", columns: SSS_DATA_COLUMNS },
  ],
  extraGapRows: [
    {
      report: "Student Support Services Internal Master",
      sheet: "(not generated)",
      column: "Fall Semester Tutoring Interest Form",
      status: "not generated (Microsoft Form)",
    },
  ],
};

export const ALL_REPORTS: ReportDef[] = [
  ATHLETICS_PROVISIONAL,
  SUMMER1_PROVISIONAL,
  ATHLETICS_GRADE,
  SPRING_EOT,
  SSS_MASTER,
];

export const GAP_WORKBOOK_FILENAME = "PowerCampus fields needed.xlsx";

export function headersOf(columns: ColumnDef[]): string[] {
  return columns.map((column) => column.header);
}

export function mapRows(columns: ColumnDef[], rows: CourseRow[]): CellValue[][] {
  return rows.map((row) =>
    columns.map((column) => {
      if (!column.from) return "";
      const value = column.from(row);
      if (value === undefined || value === null) return "";
      return value;
    }),
  );
}

export function uniqueStudents(rows: CourseRow[]): CourseRow[] {
  const seen = new Set<string>();
  const out: CourseRow[] = [];
  for (const row of rows) {
    const key = row.studentSisId || row.studentKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function professorGradeRows(rows: CourseRow[]): CellValue[][] {
  const letters = [...LETTERS, "I", "W"] as const;
  const byCourse = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const id = courseIdPlus(row);
    if (!id) continue;
    if (!byCourse.has(id)) {
      byCourse.set(id, Object.fromEntries(letters.map((letter) => [letter, 0])));
    }
    if (typeof row.courseGrade !== "number") continue;
    const letter = letterFromPercent(row.courseGrade);
    if (!letter) continue;
    byCourse.get(id)![letter] += 1;
  }
  return [...byCourse.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, counts]) => [
      id,
      ...LETTERS.map((letter) => counts[letter] || 0),
      counts.I || 0,
      counts.W || 0,
    ]);
}

export function gapRowsFor(report: ReportDef): GapRow[] {
  const rows: GapRow[] = [];
  for (const sheet of report.sheets) {
    for (const column of sheet.columns) {
      rows.push({
        report: report.title,
        sheet: sheet.name,
        column: column.header === "" ? "(empty header)" : column.header,
        status: column.status,
      });
    }
  }
  if (report.extraGapRows) rows.push(...report.extraGapRows);
  return rows;
}

export function allGapRows(): GapRow[] {
  return ALL_REPORTS.flatMap(gapRowsFor);
}

function gapSheetRows(rows: GapRow[]): CellValue[][] {
  return [
    [...GAP_HEADERS],
    ...rows.map((row) => [row.report, row.sheet, row.column, row.status]),
  ];
}

function sheetRows(sheet: SheetDef, rows: CourseRow[]): CellValue[][] {
  if (sheet.kind === "empty") return [];
  if (sheet.kind === "headers-only") return [headersOf(sheet.columns)];
  if (sheet.kind === "student") {
    return [headersOf(sheet.columns), ...mapRows(sheet.columns, uniqueStudents(rows))];
  }
  if (sheet.kind === "professor") {
    return [headersOf(sheet.columns), ...professorGradeRows(rows)];
  }
  return [headersOf(sheet.columns), ...mapRows(sheet.columns, rows)];
}

export function buildReportWorkbook(report: ReportDef, rows: CourseRow[]): Uint8Array {
  const wb = new SimpleXlsx();
  for (const sheet of report.sheets) {
    wb.addSheet(sheet.name, sheetRows(sheet, rows));
  }
  wb.addSheet("PowerCampus fields needed", gapSheetRows(gapRowsFor(report)));
  return wb.write();
}

export function buildAthleticsProvisionalWorkbook(rows: CourseRow[]): Uint8Array {
  return buildReportWorkbook(ATHLETICS_PROVISIONAL, rows);
}

export function buildSummer1ProvisionalWorkbook(rows: CourseRow[]): Uint8Array {
  return buildReportWorkbook(SUMMER1_PROVISIONAL, rows);
}

export function buildAthleticsGradeWorkbook(rows: CourseRow[]): Uint8Array {
  return buildReportWorkbook(ATHLETICS_GRADE, rows);
}

export function buildSpringEotWorkbook(rows: CourseRow[]): Uint8Array {
  return buildReportWorkbook(SPRING_EOT, rows);
}

export function buildSssMasterWorkbook(rows: CourseRow[]): Uint8Array {
  return buildReportWorkbook(SSS_MASTER, rows);
}

export function buildPowerCampusGapWorkbook(): Uint8Array {
  const wb = new SimpleXlsx();
  wb.addSheet("PowerCampus fields needed", gapSheetRows(allGapRows()));
  return wb.write();
}

export type ExcelDownloadSpec = {
  label: string;
  filename: string;
  build: (rows: CourseRow[]) => Uint8Array;
};
