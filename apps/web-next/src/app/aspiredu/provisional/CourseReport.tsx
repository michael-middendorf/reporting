"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import {
  LETTERS,
  courseIdPlus,
  letterFromPercent,
  triggerXlsxDownload,
  type CourseRow,
  type ExcelDownloadSpec,
} from "@/lib/aspiredu-exact-reports";
import { loadAllCourses } from "@/lib/aspiredu-load-courses";
import styles from "../aspiredu.module.css";

export type { CourseRow };

const CSV_COLUMNS: { key: keyof CourseRow; header: string }[] = [
  { key: "firstName", header: "Stu First Name" },
  { key: "lastName", header: "Stu Last Name" },
  { key: "email", header: "EMAIL ADDRESS" },
  { key: "studentSisId", header: "Student SIS ID" },
  { key: "course", header: "Course" },
  { key: "courseSisId", header: "Course SIS ID" },
  { key: "sectionSisId", header: "Section" },
  { key: "courseTerm", header: "Term" },
  { key: "courseGrade", header: "Course grade" },
  { key: "courseRiskScore", header: "Course risk" },
  { key: "courseRiskTrend", header: "Course risk trend" },
  { key: "risk", header: "Overall risk" },
  { key: "riskTrend", header: "Overall risk trend" },
  { key: "missingAssignments", header: "Missing assignments" },
  { key: "zeroAssignments", header: "Zero assignments" },
  { key: "courseLda", header: "Last day of attendance" },
  { key: "courseLastAccess", header: "Last access" },
  { key: "latestAttendance", header: "Latest attendance" },
  { key: "lastLogin", header: "Last login" },
];

function csvCell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function formatWhen(value?: string) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function studentName(row: CourseRow) {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unnamed";
}

function gradeDistribution(rows: CourseRow[]) {
  const byCourse = new Map<string, Record<(typeof LETTERS)[number], number>>();
  for (const row of rows) {
    if (row.courseGrade === undefined) continue;
    const letter = letterFromPercent(row.courseGrade);
    if (!letter) continue;
    const course = courseIdPlus(row) || "Unknown course";
    const current =
      byCourse.get(course) ||
      (Object.fromEntries(LETTERS.map((key) => [key, 0])) as Record<(typeof LETTERS)[number], number>);
    current[letter] += 1;
    byCourse.set(course, current);
  }
  return [...byCourse.entries()].sort(([a], [b]) => a.localeCompare(b));
}

type TermGroup = "summer1" | "spring" | "fall";

function termGroupLabel(termGroup?: TermGroup) {
  if (termGroup === "fall") return "Fall terms";
  if (termGroup === "summer1") return "Summer 1 terms";
  if (termGroup === "spring") return "Spring terms";
  return "All terms";
}

function emptyTermStatus(termGroup: TermGroup | undefined, hasTerms: boolean, empty: boolean) {
  if (!empty || !hasTerms || !termGroup) return "";
  if (termGroup === "fall") {
    return "No Fall course term in the latest AspireDU file. Use Athletics Provisional for all terms, or pick a vendor term below.";
  }
  if (termGroup === "summer1") {
    return "No Summer 1 course term in the latest AspireDU file. Use Athletics Provisional for all terms, or pick a vendor term below.";
  }
  return "No Spring course term in the latest AspireDU file. Use Athletics Provisional for all terms, or pick a vendor term below.";
}

export function CourseReport({
  heading,
  termGroup,
  showGradeDistribution = false,
  excelDownloads = [],
}: {
  heading: string;
  termGroup?: TermGroup;
  showGradeDistribution?: boolean;
  excelDownloads?: ExcelDownloadSpec[];
}) {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [courseCount, setCourseCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);

  const load = useCallback(async () => {
    setError("");
    setStatus("Loading…");
    try {
      const result = await loadAllCourses({ query, term, termGroup });
      if (result.mfaRequired) {
        setError("Authentication required. Return to Reports and sign in again.");
        setStatus("");
        return;
      }
      setCourses(result.courses);
      setTerms(result.terms);
      setCourseCount(result.courseCount);
      setStudentCount(result.studentCount);
      if (result.delivery === "awaiting_first_delivery") {
        setStatus("Awaiting the first AspireDU statistics delivery.");
      } else if (emptyTermStatus(termGroup, result.terms.length > 0, result.courses.length === 0)) {
        setStatus(emptyTermStatus(termGroup, result.terms.length > 0, result.courses.length === 0));
      } else if (result.courses.length === 0) {
        setStatus("No matching classes in the latest AspireDU statistics file.");
      } else {
        setStatus("");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load course records.");
      setStatus("");
    }
  }, [query, term, termGroup]);

  useEffect(() => {
    void load();
  }, [load]);

  const csvHref = useMemo(() => {
    const lines = [CSV_COLUMNS.map((column) => csvCell(column.header)).join(",")];
    for (const course of courses) {
      lines.push(CSV_COLUMNS.map((column) => csvCell(course[column.key])).join(","));
    }
    return URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  }, [courses]);

  useEffect(() => () => URL.revokeObjectURL(csvHref), [csvHref]);

  function downloadExcel(spec: ExcelDownloadSpec) {
    triggerXlsxDownload(spec.filename, spec.build(courses));
  }

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Academic Affairs" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <h1>{heading}</h1>
          <p className={styles.notice}>
            Excel downloads keep every original template column. Dropout Detective fields fill from this AspireDU feed.
            PowerCampus values (sport, GPA, credits, and the rest) stay blank until those extracts are supplied. The
            compact table below is still AspireDU-only.
          </p>
          <section className={styles.panel}>
              <div className={styles.toolbar}>
                <input aria-label="Search student or course" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Student, email, or course" />
                <select aria-label="Course term" value={term} onChange={(event) => setTerm(event.target.value)}>
                  <option value="">{termGroupLabel(termGroup)}</option>
                  {terms.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <button className={styles.button} type="button" onClick={() => void load()}>Search</button>
                <a className={`${styles.button} ${styles.secondary}`} href={csvHref} download={`${heading.replaceAll(" ", "-").toLowerCase()}.csv`}>Download CSV</a>
                {excelDownloads.map((spec) => (
                  <button
                    key={spec.filename}
                    className={`${styles.button} ${styles.secondary}`}
                    type="button"
                    onClick={() => downloadExcel(spec)}
                  >
                    {spec.label}
                  </button>
                ))}
              </div>
              <p className={styles.meta}>{studentCount} students · {courseCount} courses</p>
              {error && <p className={styles.error}>{error}</p>}
              {status && <p>{status}</p>}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Email</th>
                      <th>Course</th>
                      <th>Term</th>
                      <th>Grade</th>
                      <th>Course risk</th>
                      <th>Overall risk</th>
                      <th>Missing</th>
                      <th>Last access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((course, index) => (
                      <tr key={`${course.studentKey}-${course.courseSisId || course.course || index}-${course.sectionSisId || ""}`}>
                        <td>{studentName(course)}</td>
                        <td>{course.email || "—"}</td>
                        <td>{course.course || "—"}</td>
                        <td>{course.courseTerm || "—"}</td>
                        <td>{course.courseGrade ?? "—"}</td>
                        <td>{course.courseRiskScore ?? "—"}</td>
                        <td>{course.risk ?? "—"}</td>
                        <td>{course.missingAssignments ?? "—"}</td>
                        <td>{formatWhen(course.courseLastAccess)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          {showGradeDistribution && courses.length > 0 && (
            <section className={styles.panel}>
              <h2>Grade distribution by course</h2>
              <p className={styles.meta}>Letter bins from AspireDU numeric course grade. Incomplete (I) and withdraw (W) are not in this feed.</p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Course</th>
                      {LETTERS.map((letter) => (
                        <th key={letter}>{letter}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gradeDistribution(courses).map(([course, counts]) => (
                      <tr key={course}>
                        <td>{course}</td>
                        {LETTERS.map((letter) => (
                          <td key={letter}>{counts[letter] || ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
    </AccessGate>
  );
}
