"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import styles from "../aspiredu.module.css";

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

const LETTERS = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"] as const;

function letterFromPercent(grade: number): (typeof LETTERS)[number] | undefined {
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

function gradeDistribution(rows: CourseRow[]) {
  const byCourse = new Map<string, Record<(typeof LETTERS)[number], number>>();
  for (const row of rows) {
    if (row.courseGrade === undefined) continue;
    const letter = letterFromPercent(row.courseGrade);
    if (!letter) continue;
    const course = row.course || "Unknown course";
    const current = byCourse.get(course) || Object.fromEntries(LETTERS.map((key) => [key, 0])) as Record<(typeof LETTERS)[number], number>;
    current[letter] += 1;
    byCourse.set(course, current);
  }
  return [...byCourse.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function termGroupLabel(termGroup?: "summer1" | "spring") {
  if (termGroup === "summer1") return "Summer 1 terms";
  if (termGroup === "spring") return "Spring terms";
  return "All terms";
}

function emptyTermStatus(termGroup: "summer1" | "spring" | undefined, hasTerms: boolean, empty: boolean) {
  if (!empty || !hasTerms || !termGroup) return "";
  if (termGroup === "summer1") {
    return "No Summer 1 course term in the latest AspireDU file. Use Athletics Provisional for all terms, or pick a vendor term below.";
  }
  return "No Spring course term in the latest AspireDU file. Use Athletics Provisional for all terms, or pick a vendor term below.";
}

export function CourseReport({
  heading,
  termGroup,
  showGradeDistribution = false,
}: {
  heading: string;
  termGroup?: "summer1" | "spring";
  showGradeDistribution?: boolean;
}) {
  const [mfa, setMfa] = useState<"checking" | "required" | "ok">("checking");
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [courseCount, setCourseCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);

  useEffect(() => {
    apiFetch("/aspiredu/api/auth/status", { cache: "no-store" })
      .then((response) => setMfa(response.ok ? "ok" : "required"))
      .catch(() => setMfa("required"));
  }, []);

  const load = useCallback(async () => {
    setError("");
    setStatus("Loading…");
    const collected: CourseRow[] = [];
    let cursor: string | undefined;
    let nextTerms: string[] = [];
    let nextCourseCount = 0;
    let nextStudentCount = 0;
    let delivery = "";
    try {
      for (let page = 0; page < 200; page += 1) {
        const params = new URLSearchParams();
        if (query.trim()) params.set("query", query.trim());
        if (term) params.set("term", term);
        if (termGroup) params.set("termGroup", termGroup);
        if (cursor) params.set("cursor", cursor);
        const response = await apiFetch(`/aspiredu/api/courses?${params}`, { cache: "no-store" });
        if (response.status === 401) {
          setMfa("required");
          setStatus("");
          return;
        }
        if (!response.ok) throw new Error("Unable to load course records.");
        const body = await response.json();
        delivery = body.status || "";
        collected.push(...(body.courses || []));
        nextTerms = body.terms || nextTerms;
        nextCourseCount = body.courseCount ?? collected.length;
        nextStudentCount = body.studentCount ?? nextStudentCount;
        if (!body.cursor) break;
        cursor = body.cursor;
      }
      setCourses(collected);
      setTerms(nextTerms);
      setCourseCount(nextCourseCount);
      setStudentCount(nextStudentCount);
      if (delivery === "awaiting_first_delivery") {
        setStatus("Awaiting the first AspireDU statistics delivery.");
      } else if (emptyTermStatus(termGroup, nextTerms.length > 0, collected.length === 0)) {
        setStatus(emptyTermStatus(termGroup, nextTerms.length > 0, collected.length === 0));
      } else if (collected.length === 0) {
        setStatus("No matching course rows in the latest AspireDU statistics file.");
      } else {
        setStatus("");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load course records.");
      setStatus("");
    }
  }, [query, term, termGroup]);

  useEffect(() => {
    if (mfa === "ok") void load();
  }, [mfa, load]);

  async function endMfa() {
    await apiFetch("/aspiredu/api/auth/logout", { method: "POST" });
    setMfa("required");
    setCourses([]);
  }

  const csvHref = useMemo(() => {
    const lines = [CSV_COLUMNS.map((column) => csvCell(column.header)).join(",")];
    for (const row of courses) {
      lines.push(CSV_COLUMNS.map((column) => csvCell(row[column.key])).join(","));
    }
    return URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  }, [courses]);

  useEffect(() => () => URL.revokeObjectURL(csvHref), [csvHref]);

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Academic Affairs" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <h1>{heading}</h1>
          <p className={styles.notice}>
            Every student in the latest AspireDU statistics file. Sport, GPA, credits, and other Colleague fields are not in this feed.
          </p>
          {mfa === "checking" && <p>Checking MFA session…</p>}
          {mfa === "required" && (
            <section className={styles.panel}>
              <h2>Authenticator required</h2>
              <p>Student names and course records need a 6-digit authenticator code on top of your reporting email link. There is no second password.</p>
              <a className={styles.linkButton} href="/aspiredu/mfa">Continue</a>
            </section>
          )}
          {mfa === "ok" && (
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
                <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => void endMfa()}>End MFA session</button>
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
                    {courses.map((row) => (
                      <tr key={row.studentKey}>
                        <td>{studentName(row)}</td>
                        <td>{row.email || "—"}</td>
                        <td>{row.course || "—"}</td>
                        <td>{row.courseTerm || "—"}</td>
                        <td>{row.courseGrade ?? "—"}</td>
                        <td>{row.courseRiskScore ?? "—"}</td>
                        <td>{row.risk ?? "—"}</td>
                        <td>{row.missingAssignments ?? "—"}</td>
                        <td>{formatWhen(row.courseLastAccess)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {mfa === "ok" && showGradeDistribution && courses.length > 0 && (
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
