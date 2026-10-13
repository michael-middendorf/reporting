/**
 * Honors College Freshmen Midterm (provisional) GPA for FA2026 (DST-3065).
 *
 * Computes unweighted provisional GPA on the standard 4.0 scale from AspireDU
 * course percent grades, matches against the 92 freshmen PCIDs from
 * Honors College Freshmen _PCIDs_.xlsx, joins Census curriculum data, and
 * generates the downloadable Excel workbook.
 */
import {
  gpaPointsFromPercent,
  letterFromPercent,
  normalizePcid,
} from "../athletics-coaching/academics";
import type { CensusRawStudent } from "../census/lists-core";
import { XlsxWorkbook, type CellStyle, type XlsxSheet } from "../census/xlsx";
import { HONORS_FA2026_FRESHMEN_PCIDS, isHonorsFreshmanPcid } from "./honors-roster";

export type HonorsCourse = {
  course: string;
  courseSisId: string | null;
  sectionSisId: string | null;
  term: string | null;
  grade: number | null;
  letter: string;
  gpaPoints: number | null;
  missingAssignments: number;
  timesAbsent: number | null;
  timesPresent: number | null;
  latestAttendance: string | null;
  courseLastAccess: string | null;
};

export type HonorsStudent = {
  pcid: string;
  studentKey: string | null;
  firstName: string;
  lastName: string;
  name: string;
  email: string | null;
  curriculum: string | null;
  gpaEstimate: number | null;
  avgGrade: number | null;
  gradedCourses: number;
  totalCourses: number;
  missingAssignments: number;
  overallRisk: number | null;
  totalAbsences: number | null;
  pulseBand: string | null;
  courses: HonorsCourse[];
};

export type HonorsCohortSummary = {
  asOf: string | null;
  studentCount: number;
  matchedCount: number;
  cohortGpa: number | null;
  cohortAvgGrade: number | null;
  totalCourses: number;
  totalGradedCourses: number;
  studentsAbove38: number;
  studentsAbove35: number;
  studentsBelow30: number;
  studentsWithMissingWork: number;
  totalMissingAssignments: number;
};

export type HonorsReportData = {
  summary: HonorsCohortSummary;
  students: HonorsStudent[];
};

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

export function buildHonorsReportData(
  lambdaStudents: unknown[],
  censusStudents?: CensusRawStudent[] | null,
  asOf?: string | null,
  targetPcids: readonly string[] = HONORS_FA2026_FRESHMEN_PCIDS,
): HonorsReportData {
  const censusByPcid = new Map<string, CensusRawStudent>();
  if (Array.isArray(censusStudents)) {
    for (const c of censusStudents) {
      const pcid = normalizePcid(c.pcid || "");
      if (pcid && !censusByPcid.has(pcid)) {
        censusByPcid.set(pcid, c);
      }
    }
  }

  const studentMap = new Map<string, HonorsStudent>();

  // Initialize with target PCIDs in order
  for (const pcid of targetPcids) {
    const census = censusByPcid.get(pcid);
    const curriculum = strOrNull(census?.curriculumName) || strOrNull(census?.curriculum) || null;
    studentMap.set(pcid, {
      pcid,
      studentKey: null,
      firstName: "",
      lastName: "",
      name: pcid,
      email: census?.email ? strOrNull(census.email) : null,
      curriculum,
      gpaEstimate: null,
      avgGrade: null,
      gradedCourses: 0,
      totalCourses: 0,
      missingAssignments: 0,
      overallRisk: null,
      totalAbsences: null,
      pulseBand: null,
      courses: [],
    });
  }

  // Populate from AspireDU data
  for (const raw of lambdaStudents) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const rawPcid =
      normalizePcid(strOrNull(item.studentSisId) || "") ||
      normalizePcid(strOrNull(item.pcid) || "") ||
      normalizePcid(strOrNull(item.sisId) || "");
    if (!rawPcid || !studentMap.has(rawPcid)) continue;

    const student = studentMap.get(rawPcid)!;
    student.firstName = strOrNull(item.firstName) || student.firstName;
    student.lastName = strOrNull(item.lastName) || student.lastName;
    student.name = [student.firstName, student.lastName].filter(Boolean).join(" ") || student.pcid;
    student.email = strOrNull(item.email) || student.email;
    student.studentKey = strOrNull(item.studentKey) || strOrNull(item.studentHmac) || student.studentKey;
    student.overallRisk = numOrNull(item.overallRisk ?? item.risk);

    const pulse = item.pulse as Record<string, unknown> | undefined;
    if (pulse) {
      student.pulseBand = strOrNull(pulse.band) || null;
      if (typeof pulse.absent === "number") student.totalAbsences = pulse.absent;
    }

    const rawCourses = Array.isArray(item.courses) ? item.courses : [];
    const courses: HonorsCourse[] = [];
    let studentAbsences = 0;
    let studentMissing = 0;

    for (const c of rawCourses) {
      if (!c || typeof c !== "object") continue;
      const cItem = c as Record<string, unknown>;
      const grade = numOrNull(cItem.courseGrade ?? cItem.grade);
      const letter = letterFromPercent(grade);
      const gpaPoints = grade !== null ? gpaPointsFromPercent(grade) : null;
      const missing = numOrNull(cItem.missingAssignments ?? cItem.missing) ?? 0;
      const absent = numOrNull(cItem.timesAbsent);
      const present = numOrNull(cItem.timesPresent);

      if (absent !== null) studentAbsences += absent;
      studentMissing += missing;

      courses.push({
        course: strOrNull(cItem.course) ?? strOrNull(cItem.courseSisId) ?? "Unknown Course",
        courseSisId: strOrNull(cItem.courseSisId),
        sectionSisId: strOrNull(cItem.sectionSisId),
        term: strOrNull(cItem.courseTerm ?? cItem.term),
        grade,
        letter,
        gpaPoints,
        missingAssignments: missing,
        timesAbsent: absent,
        timesPresent: present,
        latestAttendance: strOrNull(cItem.latestAttendance),
        courseLastAccess: strOrNull(cItem.courseLastAccess ?? cItem.lastAccess),
      });
    }

    student.courses = courses;
    student.totalCourses = courses.length;
    student.missingAssignments = studentMissing;
    if (student.totalAbsences === null && courses.some((c) => c.timesAbsent !== null)) {
      student.totalAbsences = studentAbsences;
    }

    const graded = courses.filter((c): c is HonorsCourse & { grade: number; gpaPoints: number } => c.grade !== null && c.gpaPoints !== null);
    student.gradedCourses = graded.length;
    if (graded.length > 0) {
      student.gpaEstimate = Number((graded.reduce((s, c) => s + c.gpaPoints, 0) / graded.length).toFixed(2));
      student.avgGrade = Number((graded.reduce((s, c) => s + c.grade, 0) / graded.length).toFixed(1));
    }
  }

  const students = [...studentMap.values()].sort((a, b) => {
    return (a.lastName || "").localeCompare(b.lastName || "") || (a.firstName || "").localeCompare(b.firstName || "");
  });

  const gradedStudents = students.filter((s): s is HonorsStudent & { gpaEstimate: number; avgGrade: number } => s.gpaEstimate !== null && s.avgGrade !== null);
  const totalCourses = students.reduce((sum, s) => sum + s.totalCourses, 0);
  const totalGradedCourses = students.reduce((sum, s) => sum + s.gradedCourses, 0);
  const totalMissingAssignments = students.reduce((sum, s) => sum + s.missingAssignments, 0);

  const cohortGpa = gradedStudents.length
    ? Number((gradedStudents.reduce((sum, s) => sum + s.gpaEstimate, 0) / gradedStudents.length).toFixed(2))
    : null;
  const cohortAvgGrade = gradedStudents.length
    ? Number((gradedStudents.reduce((sum, s) => sum + s.avgGrade, 0) / gradedStudents.length).toFixed(1))
    : null;

  const studentsAbove38 = gradedStudents.filter((s) => s.gpaEstimate >= 3.8).length;
  const studentsAbove35 = gradedStudents.filter((s) => s.gpaEstimate >= 3.5).length;
  const studentsBelow30 = gradedStudents.filter((s) => s.gpaEstimate < 3.0).length;
  const studentsWithMissingWork = students.filter((s) => s.missingAssignments > 0).length;

  const summary: HonorsCohortSummary = {
    asOf: asOf || new Date().toISOString(),
    studentCount: students.length,
    matchedCount: students.filter((s) => s.totalCourses > 0).length,
    cohortGpa,
    cohortAvgGrade,
    totalCourses,
    totalGradedCourses,
    studentsAbove38,
    studentsAbove35,
    studentsBelow30,
    studentsWithMissingWork,
    totalMissingAssignments,
  };

  return { summary, students };
}

/* ---------- Workbook Generation ---------- */

const NAVY = "1A3F6F";
const HEAD: CellStyle = { bold: true, color: "FFFFFF", fill: NAVY, hAlign: "center", vAlign: "center", wrap: true };
const HEAD_LEFT: CellStyle = { ...HEAD, hAlign: "left" };
const TITLE: CellStyle = { bold: true, size: 14, color: NAVY };
const SUBTITLE: CellStyle = { italic: true, color: "4A6490" };
const DEC2: CellStyle = { numFmt: "dec2" };
const DEC1: CellStyle = { numFmt: "dec2" };
const INT: CellStyle = { numFmt: "int" };
const TOTAL: CellStyle = { bold: true, fill: "F0F5FF" };
const TOTAL_DEC2: CellStyle = { bold: true, fill: "F0F5FF", numFmt: "dec2" };
const TOTAL_DEC1: CellStyle = { bold: true, fill: "F0F5FF", numFmt: "dec2" };
const TOTAL_INT: CellStyle = { bold: true, fill: "F0F5FF", numFmt: "int" };

function setHeaders(ws: XlsxSheet, row: number, labels: string[]) {
  labels.forEach((label, idx) => ws.set(row, idx + 1, label, idx === 0 ? HEAD_LEFT : HEAD));
}

export function buildHonorsWorkbook(data: HonorsReportData): Uint8Array {
  const wb = new XlsxWorkbook();

  // Sheet 1: Honors Freshmen Summary
  const ws1 = wb.addSheet("Honors Freshmen Summary");
  ws1.set(1, 1, "Honors College Freshmen Midterm (provisional) GPA for FA2026", TITLE);
  ws1.set(
    2,
    1,
    `Ave Maria University Academic Affairs · ${data.summary.studentCount} Students · Data as of ${data.summary.asOf || "current snapshot"}`,
    SUBTITLE,
  );

  setHeaders(ws1, 4, [
    "PCID",
    "Last Name",
    "First Name",
    "Email",
    "Curriculum / Major",
    "Provisional GPA",
    "Average Grade %",
    "Graded Classes",
    "Total Classes",
    "Missing Work",
    "Overall Risk",
    "Absences",
  ]);

  let r = 5;
  for (const s of data.students) {
    ws1.set(r, 1, s.pcid);
    ws1.set(r, 2, s.lastName);
    ws1.set(r, 3, s.firstName);
    ws1.set(r, 4, s.email || "");
    ws1.set(r, 5, s.curriculum || "");
    ws1.set(r, 6, s.gpaEstimate !== null ? s.gpaEstimate : "", DEC2);
    ws1.set(r, 7, s.avgGrade !== null ? s.avgGrade : "", DEC1);
    ws1.set(r, 8, s.gradedCourses, INT);
    ws1.set(r, 9, s.totalCourses, INT);
    ws1.set(r, 10, s.missingAssignments, INT);
    ws1.set(r, 11, s.overallRisk !== null ? s.overallRisk : "", INT);
    ws1.set(r, 12, s.totalAbsences !== null ? s.totalAbsences : "", INT);
    r += 1;
  }

  // Summary footer
  ws1.set(r, 1, "Cohort Average / Total", TOTAL);
  ws1.set(r, 2, "", TOTAL);
  ws1.set(r, 3, "", TOTAL);
  ws1.set(r, 4, "", TOTAL);
  ws1.set(r, 5, `${data.summary.studentCount} Students`, TOTAL);
  ws1.set(r, 6, data.summary.cohortGpa !== null ? data.summary.cohortGpa : "", TOTAL_DEC2);
  ws1.set(r, 7, data.summary.cohortAvgGrade !== null ? data.summary.cohortAvgGrade : "", TOTAL_DEC1);
  ws1.set(r, 8, data.summary.totalGradedCourses, TOTAL_INT);
  ws1.set(r, 9, data.summary.totalCourses, TOTAL_INT);
  ws1.set(r, 10, data.summary.totalMissingAssignments, TOTAL_INT);
  ws1.set(r, 11, "", TOTAL);
  ws1.set(r, 12, "", TOTAL);

  // Sheet 2: Classes Breakdown
  const ws2 = wb.addSheet("Honors Freshmen Classes");
  ws2.set(1, 1, "Honors College Freshmen Course-Level Midterm Grades (FA2026)", TITLE);
  ws2.set(2, 1, "Course rows from AspireDU statistics. Letter bins computed from course grade %.", SUBTITLE);

  setHeaders(ws2, 4, [
    "PCID",
    "Last Name",
    "First Name",
    "Class / Course",
    "Course Code / Section",
    "Term",
    "Midterm Grade %",
    "Letter Grade",
    "GPA Points",
    "Missing",
    "Absences",
    "Latest Attendance",
    "Last Course Access",
  ]);

  let r2 = 5;
  for (const s of data.students) {
    for (const c of s.courses) {
      ws2.set(r2, 1, s.pcid);
      ws2.set(r2, 2, s.lastName);
      ws2.set(r2, 3, s.firstName);
      ws2.set(r2, 4, c.course);
      ws2.set(r2, 5, c.courseSisId || c.sectionSisId || "");
      ws2.set(r2, 6, c.term || "");
      ws2.set(r2, 7, c.grade !== null ? c.grade : "", DEC1);
      ws2.set(r2, 8, c.letter);
      ws2.set(r2, 9, c.gpaPoints !== null ? c.gpaPoints : "", DEC2);
      ws2.set(r2, 10, c.missingAssignments, INT);
      ws2.set(r2, 11, c.timesAbsent !== null ? c.timesAbsent : "", INT);
      ws2.set(r2, 12, c.latestAttendance || "");
      ws2.set(r2, 13, c.courseLastAccess || "");
      r2 += 1;
    }
  }

  return wb.writeBuffer();
}
