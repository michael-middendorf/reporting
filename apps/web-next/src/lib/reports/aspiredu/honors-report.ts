/**
 * Honors College Freshmen Midterm (provisional) GPA for FA2026 (DST-3065).
 *
 * Computes provisional GPA on the standard 4.0 scale from PowerCampus
 * TRANSCRIPTDETAIL faculty submitted midterm grades (and credit weighting),
 * falling back to Canvas LMS percentage scores when PowerCampus entries are
 * pending. Joins Census curriculum data and generates the downloadable Excel workbook.
 */
import {
  gpaPointsFromPercent,
  letterFromPercent,
  normalizePcid,
} from "../athletics-coaching/academics";
import type { CensusRawStudent } from "../census/lists-core";
import { XlsxWorkbook, type CellStyle, type XlsxSheet } from "../census/xlsx";
import { HONORS_FA2026_FRESHMEN_PCIDS } from "./honors-roster";
import type { PowerCampusTranscriptDetailRow } from "./profile-sources";

export const AMU_GRADE_POINTS: Record<string, number> = {
  "A+": 4.0,
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  "C-": 1.7,
  "D+": 1.3,
  D: 1.0,
  "D-": 0.7,
  F: 0.0,
};

export type HonorsCourse = {
  course: string;
  courseSisId: string | null;
  sectionSisId: string | null;
  term: string | null;
  credits: number | null;
  midtermGrade: string | null;
  grade: number | null;
  letter: string;
  gpaPoints: number | null;
  qualityPoints: number | null;
  source: "powercampus" | "canvas";
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
  totalCredits: number;
  gradedCredits: number;
  missingAssignments: number;
  overallRisk: number | null;
  totalAbsences: number | null;
  pulseBand: string | null;
  gradeSource: "powercampus" | "canvas" | "none";
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
  totalCredits: number;
  powercampusMatchedCount: number;
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
  pcDetailsOrAsOf?: PowerCampusTranscriptDetailRow[] | string | null,
  asOfOrTargetPcids?: string | readonly string[] | null,
  targetPcids: readonly string[] = HONORS_FA2026_FRESHMEN_PCIDS,
): HonorsReportData {
  let pcDetails: PowerCampusTranscriptDetailRow[] | null = null;
  let asOf: string | null = null;
  let actualTargetPcids = targetPcids;

  if (typeof pcDetailsOrAsOf === "string") {
    asOf = pcDetailsOrAsOf;
    if (Array.isArray(asOfOrTargetPcids)) {
      actualTargetPcids = asOfOrTargetPcids;
    }
  } else {
    pcDetails = pcDetailsOrAsOf ?? null;
    asOf = typeof asOfOrTargetPcids === "string" ? asOfOrTargetPcids : null;
    if (Array.isArray(targetPcids)) {
      actualTargetPcids = targetPcids;
    }
  }

  const censusByPcid = new Map<string, CensusRawStudent>();
  if (Array.isArray(censusStudents)) {
    for (const c of censusStudents) {
      const pcid = normalizePcid(c.pcid || "");
      if (pcid && !censusByPcid.has(pcid)) {
        censusByPcid.set(pcid, c);
      }
    }
  }

  // Index PowerCampus transcriptdetail rows by normalized PCID for Fall 2026
  const pcRowsByPcid = new Map<string, PowerCampusTranscriptDetailRow[]>();
  if (Array.isArray(pcDetails)) {
    for (const row of pcDetails) {
      const pcid = normalizePcid(row.PEOPLE_CODE_ID || "");
      if (!pcid) continue;
      const yr = (row.ACADEMIC_YEAR || "").trim();
      const term = (row.ACADEMIC_TERM || "").trim().toUpperCase();
      const status = (row.ADD_DROP_WAIT || "A").trim().toUpperCase();
      // Look for Fall 2026 active course registrations
      if (yr === "2026" && term === "FALL" && (status === "A" || status === "")) {
        const list = pcRowsByPcid.get(pcid) || [];
        list.push(row);
        pcRowsByPcid.set(pcid, list);
      }
    }
  }

  const studentMap = new Map<string, HonorsStudent>();

  // Initialize with target PCIDs in order
  for (const pcid of actualTargetPcids) {
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
      totalCredits: 0,
      gradedCredits: 0,
      missingAssignments: 0,
      overallRisk: null,
      totalAbsences: null,
      pulseBand: null,
      gradeSource: "none",
      courses: [],
    });
  }

  // Populate Canvas and engagement data from AspireDU lambda
  const canvasByPcid = new Map<string, Record<string, unknown>>();
  for (const raw of lambdaStudents) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const rawPcid =
      normalizePcid(strOrNull(item.studentSisId) || "") ||
      normalizePcid(strOrNull(item.pcid) || "") ||
      normalizePcid(strOrNull(item.sisId) || "");
    if (!rawPcid || !studentMap.has(rawPcid)) continue;
    canvasByPcid.set(rawPcid, item);
  }

  let powercampusMatchedCount = 0;

  for (const pcid of actualTargetPcids) {
    const student = studentMap.get(pcid)!;
    const canvasItem = canvasByPcid.get(pcid);
    const pcRows = pcRowsByPcid.get(pcid);

    if (canvasItem) {
      student.firstName = strOrNull(canvasItem.firstName) || student.firstName;
      student.lastName = strOrNull(canvasItem.lastName) || student.lastName;
      student.name = [student.firstName, student.lastName].filter(Boolean).join(" ") || student.pcid;
      student.email = strOrNull(canvasItem.email) || student.email;
      student.studentKey = strOrNull(canvasItem.studentKey) || strOrNull(canvasItem.studentHmac) || student.studentKey;
      student.overallRisk = numOrNull(canvasItem.overallRisk ?? canvasItem.risk);

      const pulse = canvasItem.pulse as Record<string, unknown> | undefined;
      if (pulse) {
        student.pulseBand = strOrNull(pulse.band) || null;
        if (typeof pulse.absent === "number") student.totalAbsences = pulse.absent;
      }
    }

    // Helper to find matching Canvas course
    const canvasCourses = (canvasItem && Array.isArray(canvasItem.courses) ? canvasItem.courses : []) as Record<string, unknown>[];
    function matchCanvasCourse(eventId?: string, courseName?: string): Record<string, unknown> | undefined {
      if (!eventId && !courseName) return undefined;
      const cleanEvent = (eventId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      return canvasCourses.find((cc) => {
        const sis = String(cc.courseSisId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        const cTitle = String(cc.course || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        return (cleanEvent && (sis.includes(cleanEvent) || cTitle.includes(cleanEvent)));
      });
    }

    if (pcRows && pcRows.length > 0) {
      // PowerCampus official course registrations & midterm grades
      powercampusMatchedCount += 1;
      const courses: HonorsCourse[] = [];
      let totalQualityPts = 0;
      let gradedCredits = 0;
      let totalCredits = 0;
      let studentMissing = 0;
      let studentAbsences = 0;
      let hasPowercampusGrades = false;

      for (const row of pcRows) {
        const credits = numOrNull(row.CREDITS) ?? 3.0;
        totalCredits += credits;

        const eventId = strOrNull(row.EVENT_ID) || "Course";
        const eventName = strOrNull(row.EVENT_MED_NAME) || "";
        const courseTitle = eventName ? `${eventId} - ${eventName}` : eventId;
        const midterm = strOrNull(row.MID_TERM_GRADE);
        const finalG = strOrNull(row.FINAL_GRADE);
        const letter = midterm || finalG || "-";
        const gpaPoints = letter in AMU_GRADE_POINTS ? AMU_GRADE_POINTS[letter]! : null;
        const qualityPoints = gpaPoints !== null && credits > 0 ? Number((gpaPoints * credits).toFixed(2)) : null;

        if (midterm && gpaPoints !== null) {
          hasPowercampusGrades = true;
          gradedCredits += credits;
          totalQualityPts += gpaPoints * credits;
        }

        const matchedCanvas = matchCanvasCourse(eventId, eventName);
        const missing = numOrNull(matchedCanvas?.missingAssignments ?? matchedCanvas?.missing) ?? 0;
        const absent = numOrNull(matchedCanvas?.timesAbsent);
        const present = numOrNull(matchedCanvas?.timesPresent);
        const lmsGrade = numOrNull(matchedCanvas?.courseGrade ?? matchedCanvas?.grade);

        if (absent !== null) studentAbsences += absent;
        studentMissing += missing;

        courses.push({
          course: courseTitle,
          courseSisId: eventId,
          sectionSisId: strOrNull(row.SECTION) || strOrNull(row.EVENT_SUB_KEY),
          term: `${strOrNull(row.ACADEMIC_TERM) || "FALL"} ${strOrNull(row.ACADEMIC_YEAR) || "2026"}`,
          credits,
          midtermGrade: midterm,
          grade: lmsGrade,
          letter,
          gpaPoints,
          qualityPoints,
          source: "powercampus",
          missingAssignments: missing,
          timesAbsent: absent,
          timesPresent: present,
          latestAttendance: strOrNull(matchedCanvas?.latestAttendance),
          courseLastAccess: strOrNull(matchedCanvas?.courseLastAccess ?? matchedCanvas?.lastAccess),
        });
      }

      student.courses = courses;
      student.totalCourses = courses.length;
      student.totalCredits = Number(totalCredits.toFixed(1));
      student.gradedCredits = Number(gradedCredits.toFixed(1));
      student.missingAssignments = studentMissing;
      if (student.totalAbsences === null && courses.some((c) => c.timesAbsent !== null)) {
        student.totalAbsences = studentAbsences;
      }

      if (hasPowercampusGrades && gradedCredits > 0) {
        student.gpaEstimate = Number((totalQualityPts / gradedCredits).toFixed(2));
        student.gradedCourses = courses.filter((c) => c.midtermGrade !== null && c.gpaPoints !== null).length;
        student.gradeSource = "powercampus";
      } else {
        // Fall back to Canvas course percent grades if PowerCampus midterm grades are still pending
        const gradedCanvas = courses.filter((c) => c.grade !== null);
        if (gradedCanvas.length > 0) {
          const canvasPoints = gradedCanvas.map((c) => gpaPointsFromPercent(c.grade!));
          student.gpaEstimate = Number((canvasPoints.reduce((s, p) => s + p, 0) / canvasPoints.length).toFixed(2));
          student.avgGrade = Number((gradedCanvas.reduce((s, c) => s + c.grade!, 0) / gradedCanvas.length).toFixed(1));
          student.gradedCourses = gradedCanvas.length;
          student.gradeSource = "canvas";
        }
      }
    } else if (canvasCourses.length > 0) {
      // Fallback: Populate purely from Canvas / AspireDU courses
      const courses: HonorsCourse[] = [];
      let studentAbsences = 0;
      let studentMissing = 0;

      for (const cItem of canvasCourses) {
        if (!cItem || typeof cItem !== "object") continue;
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
          credits: 3.0,
          midtermGrade: null,
          grade,
          letter,
          gpaPoints,
          qualityPoints: gpaPoints !== null ? Number((gpaPoints * 3.0).toFixed(2)) : null,
          source: "canvas",
          missingAssignments: missing,
          timesAbsent: absent,
          timesPresent: present,
          latestAttendance: strOrNull(cItem.latestAttendance),
          courseLastAccess: strOrNull(cItem.courseLastAccess ?? cItem.lastAccess),
        });
      }

      student.courses = courses;
      student.totalCourses = courses.length;
      student.totalCredits = courses.length * 3;
      student.missingAssignments = studentMissing;
      if (student.totalAbsences === null && courses.some((c) => c.timesAbsent !== null)) {
        student.totalAbsences = studentAbsences;
      }

      const graded = courses.filter((c): c is HonorsCourse & { grade: number; gpaPoints: number } => c.grade !== null && c.gpaPoints !== null);
      student.gradedCourses = graded.length;
      student.gradedCredits = graded.length * 3;
      if (graded.length > 0) {
        student.gpaEstimate = Number((graded.reduce((s, c) => s + c.gpaPoints, 0) / graded.length).toFixed(2));
        student.avgGrade = Number((graded.reduce((s, c) => s + c.grade, 0) / graded.length).toFixed(1));
        student.gradeSource = "canvas";
      }
    }
  }

  const students = [...studentMap.values()].sort((a, b) => {
    return (a.lastName || "").localeCompare(b.lastName || "") || (a.firstName || "").localeCompare(b.firstName || "");
  });

  const gradedStudents = students.filter((s): s is HonorsStudent & { gpaEstimate: number } => s.gpaEstimate !== null);
  const avgGradeStudents = students.filter((s): s is HonorsStudent & { avgGrade: number } => s.avgGrade !== null);

  const totalCourses = students.reduce((sum, s) => sum + s.totalCourses, 0);
  const totalGradedCourses = students.reduce((sum, s) => sum + s.gradedCourses, 0);
  const totalCredits = students.reduce((sum, s) => sum + s.totalCredits, 0);
  const totalMissingAssignments = students.reduce((sum, s) => sum + s.missingAssignments, 0);

  const cohortGpa = gradedStudents.length
    ? Number((gradedStudents.reduce((sum, s) => sum + s.gpaEstimate, 0) / gradedStudents.length).toFixed(2))
    : null;
  const cohortAvgGrade = avgGradeStudents.length
    ? Number((avgGradeStudents.reduce((sum, s) => sum + s.avgGrade, 0) / avgGradeStudents.length).toFixed(1))
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
    totalCredits,
    powercampusMatchedCount,
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
    `Ave Maria University Academic Affairs : ${data.summary.studentCount} Students : Data as of ${data.summary.asOf || "current snapshot"}`,
    SUBTITLE,
  );

  setHeaders(ws1, 4, [
    "PCID",
    "Last Name",
    "First Name",
    "Email",
    "Curriculum / Major",
    "Midterm GPA",
    "Grade Source",
    "Graded Credits",
    "Total Credits",
    "Graded Classes",
    "Total Classes",
    "Missing Work",
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
    ws1.set(r, 7, s.gradeSource === "powercampus" ? "PowerCampus Midterm" : s.gradeSource === "canvas" ? "Canvas LMS" : "Pending");
    ws1.set(r, 8, s.gradedCredits, DEC1);
    ws1.set(r, 9, s.totalCredits, DEC1);
    ws1.set(r, 10, s.gradedCourses, INT);
    ws1.set(r, 11, s.totalCourses, INT);
    ws1.set(r, 12, s.missingAssignments, INT);
    ws1.set(r, 13, s.totalAbsences !== null ? s.totalAbsences : "", INT);
    r += 1;
  }

  // Summary footer
  ws1.set(r, 1, "Cohort Average / Total", TOTAL);
  ws1.set(r, 2, "", TOTAL);
  ws1.set(r, 3, "", TOTAL);
  ws1.set(r, 4, "", TOTAL);
  ws1.set(r, 5, `${data.summary.studentCount} Students`, TOTAL);
  ws1.set(r, 6, data.summary.cohortGpa !== null ? data.summary.cohortGpa : "", TOTAL_DEC2);
  ws1.set(r, 7, "", TOTAL);
  ws1.set(r, 8, "", TOTAL);
  ws1.set(r, 9, data.summary.totalCredits, TOTAL_DEC1);
  ws1.set(r, 10, data.summary.totalGradedCourses, TOTAL_INT);
  ws1.set(r, 11, data.summary.totalCourses, TOTAL_INT);
  ws1.set(r, 12, data.summary.totalMissingAssignments, TOTAL_INT);
  ws1.set(r, 13, "", TOTAL);

  // Sheet 2: Classes Breakdown
  const ws2 = wb.addSheet("Honors Freshmen Classes");
  ws2.set(1, 1, "Honors College Freshmen Course-Level Midterm Grades (FA2026)", TITLE);
  ws2.set(2, 1, "Course rows from PowerCampus TRANSCRIPTDETAIL and Canvas LMS engagement.", SUBTITLE);

  setHeaders(ws2, 4, [
    "PCID",
    "Last Name",
    "First Name",
    "Class / Course",
    "Course Code",
    "Section",
    "Term",
    "Credits",
    "Midterm Grade",
    "Grade Points",
    "Quality Points",
    "Grade Source",
    "LMS Grade %",
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
      ws2.set(r2, 5, c.courseSisId || "");
      ws2.set(r2, 6, c.sectionSisId || "");
      ws2.set(r2, 7, c.term || "");
      ws2.set(r2, 8, c.credits !== null ? c.credits : "", DEC1);
      ws2.set(r2, 9, c.midtermGrade || c.letter);
      ws2.set(r2, 10, c.gpaPoints !== null ? c.gpaPoints : "", DEC2);
      ws2.set(r2, 11, c.qualityPoints !== null ? c.qualityPoints : "", DEC2);
      ws2.set(r2, 12, c.source === "powercampus" ? "PowerCampus" : "Canvas");
      ws2.set(r2, 13, c.grade !== null ? c.grade : "", DEC1);
      ws2.set(r2, 14, c.missingAssignments, INT);
      ws2.set(r2, 15, c.timesAbsent !== null ? c.timesAbsent : "", INT);
      ws2.set(r2, 16, c.latestAttendance || "");
      ws2.set(r2, 17, c.courseLastAccess || "");
      r2 += 1;
    }
  }

  return wb.writeBuffer();
}
