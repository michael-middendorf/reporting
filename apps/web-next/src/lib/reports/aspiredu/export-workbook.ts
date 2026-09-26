/**
 * Academic Affairs "Download spreadsheet": one Excel workbook with a Students
 * sheet (one row per AspireDU student) and a Classes sheet (one row per
 * student per class). Pure: takes the AspireDU `courses` rows plus the loaded
 * roster, housing, and census sources, and returns the xlsx bytes.
 *
 * Population is AspireDU students only. Roster, housing, and census are joined
 * with the same keys and tiers as the student profile (PCID, then SIS id, then
 * email), and census columns come from census-fields.ts.
 */
import { letterFromPercent, normalizePcid } from "../athletics-coaching/academics";
import { normalizeRosterRow } from "../athletics-coaching/enrollment";
import { XlsxWorkbook, cellRef, type CellStyle, type CellValue, type XlsxSheet } from "../census/xlsx";
import { CENSUS_FIELDS } from "./census-fields";
import {
  athleticsFromHits,
  buildJoinIndex,
  censusCandidate,
  censusFromHits,
  gradeKpis,
  housingFromHits,
  profileJoinKeys,
  residentCandidate,
  rosterCandidate,
  type ProfileSources,
} from "./student-profile";

/* ---------- AspireDU courses rows ---------- */

/** One row of the Lambda `courses` action (CourseRecord). No attendance counts. */
export type ExportCourse = {
  studentHmac: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  studentSisId: string | null;
  course: string;
  courseSisId: string | null;
  sectionSisId: string | null;
  term: string | null;
  grade: number | null;
  missing: number | null;
  zero: number | null;
  risk: number | null;
  courseRisk: number | null;
  lda: string | null;
  lastAccess: string | null;
  latestAttendance: string | null;
  lastLogin: string | null;
};

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

export function normalizeExportCourse(value: unknown): ExportCourse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const studentHmac = str(r.studentHmac) ?? str(r.studentKey);
  if (!studentHmac) return null;
  return {
    studentHmac,
    firstName: str(r.firstName),
    lastName: str(r.lastName),
    email: str(r.email),
    studentSisId: str(r.studentSisId),
    course: str(r.course) ?? str(r.courseSisId) ?? "",
    courseSisId: str(r.courseSisId),
    sectionSisId: str(r.sectionSisId),
    term: str(r.courseTerm),
    grade: num(r.courseGrade),
    missing: num(r.missingAssignments),
    zero: num(r.zeroAssignments),
    risk: num(r.risk),
    courseRisk: num(r.courseRiskScore),
    lda: str(r.courseLda),
    lastAccess: str(r.courseLastAccess),
    latestAttendance: str(r.latestAttendance),
    lastLogin: str(r.lastLogin),
  };
}

export type ExportStudent = {
  studentHmac: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  studentSisId: string | null;
  courses: ExportCourse[];
};

/** Groups course rows by studentHmac, keeping first-seen order within a student. */
export function groupCourseRows(rows: unknown[]): ExportStudent[] {
  const byStudent = new Map<string, ExportStudent>();
  for (const raw of rows) {
    const row = normalizeExportCourse(raw);
    if (!row) continue;
    let student = byStudent.get(row.studentHmac);
    if (!student) {
      student = {
        studentHmac: row.studentHmac,
        firstName: null,
        lastName: null,
        email: null,
        studentSisId: null,
        courses: [],
      };
      byStudent.set(row.studentHmac, student);
    }
    student.firstName ??= row.firstName;
    student.lastName ??= row.lastName;
    student.email ??= row.email;
    student.studentSisId ??= row.studentSisId;
    student.courses.push(row);
  }
  return [...byStudent.values()];
}

function laterIso(left: string | null, right: string | null): string | null {
  if (!right) return left;
  if (!left) return right;
  const l = Date.parse(left);
  const r = Date.parse(right);
  if (Number.isNaN(r)) return left;
  if (Number.isNaN(l)) return right;
  return r > l ? right : left;
}

function maxOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? Math.max(...present) : null;
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** Date part as written (no timezone shift); other parseable values as a UTC date. */
export function dateCell(value: string | null): string | null {
  if (!value) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (iso) return iso[1]!;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString().slice(0, 10);
}

/* ---------- sheet columns ---------- */

type Column = { header: string; width: number; numFmt?: CellStyle["numFmt"] };

const STUDENT_LEAD: Column[] = [
  { header: "Last name", width: 18 },
  { header: "First name", width: 16 },
  { header: "Email", width: 32 },
  { header: "PCID or SIS id", width: 14 },
  { header: "GPA estimate", width: 12, numFmt: "dec2" },
  { header: "Average grade %", width: 14 },
  { header: "Classes", width: 10 },
  { header: "Below A/B", width: 11 },
  { header: "Missing work", width: 13 },
  { header: "Risk", width: 8 },
  { header: "Last activity", width: 13 },
  { header: "Roster sport", width: 20 },
  { header: "Roster 2nd sport", width: 18 },
  { header: "AMU status", width: 14 },
  { header: "Housing hall", width: 20 },
  { header: "Housing room", width: 12 },
  { header: "Housing residency", width: 16 },
];

const CENSUS_WIDTHS: Record<string, number> = {
  "Census email": 32,
  "Curriculum name": 24,
  "Declared majors": 28,
  "High school": 28,
  "Application major": 22,
  "AC comments": 48,
};

export const STUDENT_COLUMNS: Column[] = [
  ...STUDENT_LEAD,
  ...CENSUS_FIELDS.map((f) => ({ header: f.header, width: CENSUS_WIDTHS[f.header] ?? 14 })),
  { header: "Census match", width: 16 },
];

export const CLASS_COLUMNS: Column[] = [
  { header: "Last name", width: 18 },
  { header: "First name", width: 16 },
  { header: "PCID or SIS id", width: 14 },
  { header: "Class", width: 34 },
  { header: "Section", width: 22 },
  { header: "Term", width: 16 },
  { header: "Grade %", width: 10 },
  { header: "Letter", width: 8 },
  { header: "Missing", width: 10 },
  { header: "Zero", width: 8 },
  { header: "Latest attendance", width: 16 },
  { header: "LDA", width: 12 },
  { header: "Last access", width: 13 },
];

/* ---------- model ---------- */

export type ExportModel = {
  students: CellValue[][];
  classes: CellValue[][];
  counts: { students: number; classes: number; censusMatched: number };
};

function byName(a: ExportStudent, b: ExportStudent): number {
  return (
    (a.lastName || "").localeCompare(b.lastName || "") ||
    (a.firstName || "").localeCompare(b.firstName || "") ||
    a.studentHmac.localeCompare(b.studentHmac)
  );
}

export function buildExportModel(rows: unknown[], sources: ProfileSources): ExportModel {
  const students = groupCourseRows(rows).sort(byName);

  // Build each index once; the profile's per-student scans would be O(n * m) here.
  const rosterIndex = sources.roster
    ? buildJoinIndex(sources.roster.rows.map(normalizeRosterRow), rosterCandidate)
    : null;
  const housingIndex = sources.housing ? buildJoinIndex(sources.housing.residents, residentCandidate) : null;
  const censusIndex = sources.census ? buildJoinIndex(sources.census.students, censusCandidate) : null;

  const studentRows: CellValue[][] = [];
  const classRows: CellValue[][] = [];
  let censusMatched = 0;

  for (const student of students) {
    const keys = profileJoinKeys(student);
    const athletics = rosterIndex ? athleticsFromHits(rosterIndex.lookup(keys), null) : null;
    const housing = housingIndex ? housingFromHits(housingIndex.lookup(keys), null) : null;
    const census = censusIndex ? censusFromHits(censusIndex.lookup(keys), null) : null;
    if (census) censusMatched += 1;

    // PCID when the SIS id is one; otherwise the raw SIS id (kept as text).
    const id = keys.pcid ?? student.studentSisId ?? (census ? normalizePcid(census.record.pcid || "") : null);
    const grades = gradeKpis(student.courses.map((c) => c.grade));
    let lastActivity: string | null = null;
    for (const course of student.courses) {
      lastActivity = laterIso(lastActivity, course.lastAccess);
      lastActivity = laterIso(lastActivity, course.lastLogin);
    }
    // Same fallback as the student list: student risk, else the highest class risk.
    const risk = maxOrNull(student.courses.map((c) => c.risk)) ?? maxOrNull(student.courses.map((c) => c.courseRisk));

    studentRows.push([
      student.lastName,
      student.firstName,
      student.email,
      id,
      grades.gpaEstimate,
      grades.avgGrade,
      student.courses.length,
      grades.belowAbCount,
      sumOrNull(student.courses.map((c) => c.missing)),
      risk,
      dateCell(lastActivity),
      athletics?.primarySport ?? null,
      athletics?.secondSport ?? null,
      athletics?.amuStatus ?? null,
      housing?.hall ?? null,
      housing?.room ?? null,
      housing?.residency ?? null,
      ...CENSUS_FIELDS.map((f) => (census ? f.get(census.record) : null)),
      sources.census ? (census ? "Matched" : "Not found") : "Census unavailable",
    ]);

    const courses = [...student.courses].sort(
      (a, b) => a.course.localeCompare(b.course) || (a.term || "").localeCompare(b.term || ""),
    );
    for (const course of courses) {
      classRows.push([
        student.lastName,
        student.firstName,
        id,
        course.course,
        course.sectionSisId ?? course.courseSisId,
        course.term,
        course.grade,
        course.grade === null ? null : letterFromPercent(course.grade),
        course.missing,
        course.zero,
        dateCell(course.latestAttendance),
        dateCell(course.lda),
        dateCell(course.lastAccess),
      ]);
    }
  }

  return {
    students: studentRows,
    classes: classRows,
    counts: { students: studentRows.length, classes: classRows.length, censusMatched },
  };
}

/* ---------- workbook ---------- */

const NAVY = "1A3F6F";
const HEADER_STYLE: CellStyle = {
  bold: true,
  size: 10,
  color: "FFFFFF",
  fill: NAVY,
  vAlign: "center",
  hAlign: "center",
  wrap: true,
  border: { b: { s: "medium", c: NAVY } },
};

function writeTable(sheet: XlsxSheet, columns: Column[], rows: CellValue[][]) {
  sheet.gridLines = true;
  columns.forEach((col, i) => {
    sheet.width(i + 1, col.width);
    sheet.set(1, i + 1, col.header, HEADER_STYLE);
  });
  sheet.height(1, 30);
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      const fmt = columns[c]?.numFmt;
      sheet.set(r + 2, c + 1, value, fmt && typeof value === "number" ? { numFmt: fmt } : {});
    });
  });
  sheet.freezeRows = 1;
  sheet.autoFilter = `A1:${cellRef(Math.max(rows.length, 1) + 1, columns.length)}`;
}

export function buildExportWorkbook(rows: unknown[], sources: ProfileSources): {
  buffer: Buffer;
  counts: ExportModel["counts"];
} {
  const model = buildExportModel(rows, sources);
  const wb = new XlsxWorkbook();
  writeTable(wb.addSheet("Students"), STUDENT_COLUMNS, model.students);
  writeTable(wb.addSheet("Classes"), CLASS_COLUMNS, model.classes);
  return { buffer: wb.writeBuffer(), counts: model.counts };
}

/** academic-affairs-students-YYYY-MM-DD.xlsx, dated in Eastern time. */
export function exportFileName(at: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return `academic-affairs-students-${day}.xlsx`;
}
