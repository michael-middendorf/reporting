"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import { triggerXlsxDownload } from "@/lib/aspiredu-xlsx";
import type { HonorsReportData, HonorsStudent } from "@/lib/reports/aspiredu/honors-report";
import s from "./honors.module.css";
import styles from "../aspiredu.module.css";

const FALLBACK_FILENAME = "Honors-College-Freshmen-Midterm-GPA-FA2026.xlsx";

function filenameFrom(disposition: string | null): string {
  const match = /filename="([^"]+\.xlsx)"/i.exec(disposition || "");
  return match ? match[1]! : FALLBACK_FILENAME;
}

function gpaClass(gpa: number | null): string {
  if (gpa === null) return "";
  if (gpa >= 3.5) return s.gpaHigh;
  if (gpa >= 3.0) return s.gpaMid;
  return s.gpaLow;
}

function formatGpa(gpa: number | null): string {
  return gpa !== null ? gpa.toFixed(2) : "-";
}

function formatPct(pct: number | null): string {
  return pct !== null ? `${pct.toFixed(1)}%` : "-";
}

function DownloadButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/aspiredu/api/honors/export", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          response.status === 401
            ? "Your session has expired. Return to Reports and sign in again."
            : body?.error || "Unable to build the spreadsheet.",
        );
        return;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      triggerXlsxDownload(filenameFrom(response.headers.get("Content-Disposition")), bytes);
    } catch {
      setError("Unable to reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className={s.downloadButton} type="button" disabled={busy} onClick={() => void download()}>
        {busy ? "Building Excel…" : "Download Excel"}
      </button>
      {error && <p className={s.errorMessage} role="alert">{error}</p>}
    </div>
  );
}

type FilterType = "all" | "gte38" | "gte35" | "lt35" | "lt30" | "missing";

export default function HonorsFreshmenGpaPage() {
  const [data, setData] = useState<HonorsReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedPcids, setExpandedPcids] = useState<Set<string>>(new Set());

  useEffect(() => {
    let ignore = false;
    async function fetchHonors() {
      try {
        const res = await apiFetch("/aspiredu/api/honors", { cache: "no-store" });
        if (ignore) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(
            res.status === 401
              ? "Your session has expired. Return to Reports and sign in again."
              : res.status === 403
              ? "You do not have access to Honors student records."
              : body?.error || "Unable to load Honors student data.",
          );
          return;
        }
        const json = (await res.json()) as { ok: boolean } & HonorsReportData;
        if (ignore) return;
        setData(json);
      } catch {
        if (!ignore) setError("Unable to reach the server. Check your connection.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void fetchHonors();
    return () => {
      ignore = true;
    };
  }, []);

  function toggleExpand(pcid: string) {
    setExpandedPcids((prev) => {
      const next = new Set(prev);
      if (next.has(pcid)) next.delete(pcid);
      else next.add(pcid);
      return next;
    });
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
  }

  const allStudents = data?.students ?? [];
  const q = search.trim().toLowerCase();

  const filteredStudents = allStudents.filter((student) => {
    // Filter chip filter
    if (filter === "gte38" && (student.gpaEstimate === null || student.gpaEstimate < 3.8)) return false;
    if (filter === "gte35" && (student.gpaEstimate === null || student.gpaEstimate < 3.5)) return false;
    if (filter === "lt35" && (student.gpaEstimate === null || student.gpaEstimate >= 3.5)) return false;
    if (filter === "lt30" && (student.gpaEstimate === null || student.gpaEstimate >= 3.0)) return false;
    if (filter === "missing" && student.missingAssignments <= 0) return false;

    // Search query filter
    if (!q) return true;
    if (student.name.toLowerCase().includes(q)) return true;
    if (student.pcid.toLowerCase().includes(q)) return true;
    if (student.email && student.email.toLowerCase().includes(q)) return true;
    if (student.curriculum && student.curriculum.toLowerCase().includes(q)) return true;
    if (student.courses.some((c) => c.course.toLowerCase().includes(q) || (c.courseSisId && c.courseSisId.toLowerCase().includes(q)))) {
      return true;
    }
    return false;
  });

  const summary = data?.summary;

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Academic Affairs" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <header className={s.pageHeader}>
            <div>
              <h1>Honors Freshmen Midterm GPA</h1>
              <p>
                Fall 2026 provisional grades for 92 Honors College freshmen (DST-3065)
                {summary?.asOf ? `, data as of ${summary.asOf}` : ""}
              </p>
            </div>
            <DownloadButton />
          </header>

          {error && <p className={s.errorMessage} role="alert">{error}</p>}

          {loading ? (
            <p className={s.statusMessage}>Loading Honors College student records…</p>
          ) : (
            <>
              {summary && (
                <section className={s.kpiGrid} aria-label="Cohort Summary KPIs">
                  <div className={s.kpiCard}>
                    <span className={s.kpiLabel}>Cohort Provisional GPA</span>
                    <span className={s.kpiValue}>{formatGpa(summary.cohortGpa)}</span>
                    <span className={s.kpiSub}>4.0 unweighted scale</span>
                  </div>
                  <div className={s.kpiCard}>
                    <span className={s.kpiLabel}>Cohort Avg Grade</span>
                    <span className={s.kpiValue}>{formatPct(summary.cohortAvgGrade)}</span>
                    <span className={s.kpiSub}>course grade avg</span>
                  </div>
                  <div className={s.kpiCard}>
                    <span className={s.kpiLabel}>Graded Courses</span>
                    <span className={s.kpiValue}>
                      {summary.totalGradedCourses} / {summary.totalCourses}
                    </span>
                    <span className={s.kpiSub}>with current percent</span>
                  </div>
                  <div className={s.kpiCard}>
                    <span className={s.kpiLabel}>GPA &ge; 3.8</span>
                    <span className={s.kpiValue}>{summary.studentsAbove38}</span>
                    <span className={s.kpiSub}>of {summary.studentCount} freshmen</span>
                  </div>
                  <div className={s.kpiCard}>
                    <span className={s.kpiLabel}>GPA &ge; 3.5</span>
                    <span className={s.kpiValue}>{summary.studentsAbove35}</span>
                    <span className={s.kpiSub}>of {summary.studentCount} freshmen</span>
                  </div>
                  <div className={s.kpiCard}>
                    <span className={s.kpiLabel}>GPA &lt; 3.0</span>
                    <span className={s.kpiValue}>{summary.studentsBelow30}</span>
                    <span className={s.kpiSub}>academic attention</span>
                  </div>
                  <div className={s.kpiCard}>
                    <span className={s.kpiLabel}>Missing Work</span>
                    <span className={s.kpiValue}>{summary.totalMissingAssignments}</span>
                    <span className={s.kpiSub}>{summary.studentsWithMissingWork} students</span>
                  </div>
                </section>
              )}

              <section className={s.toolbar}>
                <form className={s.searchForm} onSubmit={handleSearchSubmit} role="search">
                  <input
                    className={s.searchInput}
                    type="search"
                    aria-label="Search Honors freshmen"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by student name, ID, email, major, or course..."
                  />
                </form>

                <div className={s.filterChips} role="group" aria-label="Filter students by GPA or missing assignments">
                  <span className={s.chipLabel}>Filter:</span>
                  <button
                    type="button"
                    className={`${s.chip} ${filter === "all" ? s.chipActive : ""}`}
                    onClick={() => setFilter("all")}
                  >
                    All ({allStudents.length})
                  </button>
                  <button
                    type="button"
                    className={`${s.chip} ${filter === "gte38" ? s.chipActive : ""}`}
                    onClick={() => setFilter("gte38")}
                  >
                    3.8+ GPA ({summary?.studentsAbove38 ?? 0})
                  </button>
                  <button
                    type="button"
                    className={`${s.chip} ${filter === "gte35" ? s.chipActive : ""}`}
                    onClick={() => setFilter("gte35")}
                  >
                    3.5+ GPA ({summary?.studentsAbove35 ?? 0})
                  </button>
                  <button
                    type="button"
                    className={`${s.chip} ${filter === "lt35" ? s.chipActive : ""}`}
                    onClick={() => setFilter("lt35")}
                  >
                    &lt; 3.5 GPA ({allStudents.filter((st) => st.gpaEstimate !== null && st.gpaEstimate < 3.5).length})
                  </button>
                  <button
                    type="button"
                    className={`${s.chip} ${filter === "lt30" ? s.chipActive : ""}`}
                    onClick={() => setFilter("lt30")}
                  >
                    &lt; 3.0 GPA ({summary?.studentsBelow30 ?? 0})
                  </button>
                  <button
                    type="button"
                    className={`${s.chip} ${filter === "missing" ? s.chipActive : ""}`}
                    onClick={() => setFilter("missing")}
                  >
                    Missing Work ({summary?.studentsWithMissingWork ?? 0})
                  </button>
                </div>
              </section>

              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th style={{ width: "32px" }}></th>
                      <th>Student</th>
                      <th>Curriculum</th>
                      <th className={s.num}>Provisional GPA</th>
                      <th className={s.num}>Avg Grade</th>
                      <th className={s.num}>Courses</th>
                      <th className={s.num}>Missing Work</th>
                      <th className={s.num}>Absences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((student) => {
                      const isExpanded = expandedPcids.has(student.pcid);
                      return (
                        <StudentRowGroup
                          key={student.pcid}
                          student={student}
                          isExpanded={isExpanded}
                          onToggle={() => toggleExpand(student.pcid)}
                        />
                      );
                    })}
                    {filteredStudents.length === 0 && (
                      <tr>
                        <td colSpan={8} className={s.statusMessage}>
                          No students match the selected filter or search criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      </div>
    </AccessGate>
  );
}

function StudentRowGroup({
  student,
  isExpanded,
  onToggle,
}: {
  student: HonorsStudent;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const gpaStr = formatGpa(student.gpaEstimate);
  const pillStyle = `${s.gpaPill} ${gpaClass(student.gpaEstimate)}`;

  return (
    <>
      <tr className={s.clickableRow} onClick={onToggle}>
        <td onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          <button
            type="button"
            className={s.expandBtn}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse classes" : "Expand classes"}
          >
            {isExpanded ? "▲" : "▼"}
          </button>
        </td>
        <td>
          {student.studentKey ? (
            <Link
              href={`/aspiredu/students/${encodeURIComponent(student.studentKey)}`}
              className={s.nameLink}
              onClick={(e) => e.stopPropagation()}
            >
              {student.name}
            </Link>
          ) : (
            <strong>{student.name}</strong>
          )}
          <span className={s.subtle}>{student.pcid} {student.email ? `• ${student.email}` : ""}</span>
        </td>
        <td>{student.curriculum || "-"}</td>
        <td className={s.num}>
          <span className={pillStyle}>{gpaStr}</span>
        </td>
        <td className={s.num}>{formatPct(student.avgGrade)}</td>
        <td className={s.num}>
          {student.gradedCourses} / {student.totalCourses}
        </td>
        <td className={s.num}>
          {student.missingAssignments > 0 ? (
            <strong style={{ color: "#9b1c1c" }}>{student.missingAssignments}</strong>
          ) : (
            "0"
          )}
        </td>
        <td className={s.num}>{student.totalAbsences ?? "-"}</td>
      </tr>
      {isExpanded && (
        <tr className={s.courseDetailsRow}>
          <td colSpan={8}>
            <div className={s.courseDetailsContent}>
              <table className={s.courseTable}>
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Code / Section</th>
                    <th className={s.num}>Grade %</th>
                    <th>Letter</th>
                    <th className={s.num}>Points</th>
                    <th className={s.num}>Missing Work</th>
                    <th className={s.num}>Absences</th>
                    <th>Last Access</th>
                  </tr>
                </thead>
                <tbody>
                  {student.courses.map((course, idx) => (
                    <tr key={`${course.courseSisId || course.course}-${idx}`}>
                      <td>{course.course}</td>
                      <td>{course.courseSisId || "-"}</td>
                      <td className={s.num}>{formatPct(course.grade)}</td>
                      <td><strong>{course.letter}</strong></td>
                      <td className={s.num}>{course.gpaPoints !== null ? course.gpaPoints.toFixed(1) : "-"}</td>
                      <td className={s.num}>
                        {course.missingAssignments > 0 ? (
                          <span style={{ color: "#9b1c1c", fontWeight: 600 }}>{course.missingAssignments}</span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className={s.num}>{course.timesAbsent ?? "-"}</td>
                      <td>{course.courseLastAccess || "-"}</td>
                    </tr>
                  ))}
                  {student.courses.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "12px", color: "#666" }}>
                        No courses recorded for this student in the snapshot.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
