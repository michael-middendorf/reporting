"use client";

import { useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import styles from "../aspiredu.module.css";

type Student = {
  studentKey: string;
  firstName?: string;
  lastName?: string;
  riskBand?: string;
  riskScore?: number;
  courseCode?: string;
  courseName?: string;
  lastActivityAt?: string;
};

export default function AspireduStudentsPage() {
  const [mfa, setMfa] = useState<"checking" | "required" | "ok">("checking");
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [query, setQuery] = useState("");
  const [riskBand, setRiskBand] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/aspiredu/api/auth/status", { cache: "no-store" })
      .then((response) => setMfa(response.ok ? "ok" : "required"))
      .catch(() => setMfa("required"));
  }, []);

  async function search(nextCursor?: string) {
    setError("");
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (riskBand) params.set("riskBand", riskBand);
    if (nextCursor) params.set("cursor", nextCursor);
    const response = await apiFetch(`/aspiredu/api/students?${params}`, { cache: "no-store" });
    if (response.status === 401) {
      setMfa("required");
      return;
    }
    if (!response.ok) {
      setError("Unable to load student records.");
      return;
    }
    const body = await response.json();
    setStudents(body.students || []);
    setCursor(body.cursor || null);
  }

  async function openStudent(studentKey: string) {
    setError("");
    const response = await apiFetch(`/aspiredu/api/students/${encodeURIComponent(studentKey)}`, { cache: "no-store" });
    if (!response.ok) {
      setError("Unable to load the student record.");
      return;
    }
    const body = await response.json();
    setSelected(body.student || null);
  }

  async function endMfa() {
    await apiFetch("/aspiredu/api/auth/logout", { method: "POST" });
    setMfa("required");
    setStudents([]);
    setSelected(null);
  }

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Academic Affairs" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <h1>Student follow-up</h1>
          {mfa === "checking" && <p>Checking MFA session…</p>}
          {mfa === "required" && (
            <section className={styles.panel}>
              <h2>Authenticator required</h2>
              <p>Student names and records need a 6-digit authenticator code on top of your reporting email link. There is no second password.</p>
              <a className={styles.linkButton} href="/aspiredu/mfa">Continue</a>
            </section>
          )}
          {mfa === "ok" && (
            <section className={styles.panel}>
              <div className={styles.toolbar}>
                <input aria-label="Search student or course" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Student or course" />
                <input aria-label="Overall risk score" value={riskBand} onChange={(event) => setRiskBand(event.target.value)} placeholder="Overall risk (e.g. 4)" />
                <button className={styles.button} type="button" onClick={() => search()}>Search</button>
                <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={endMfa}>End MFA session</button>
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Student</th><th>Risk</th><th>Score</th><th>Course</th><th>Last activity</th><th></th></tr></thead>
                  <tbody>{students.map((student) => (
                    <tr key={student.studentKey}>
                      <td>{[student.firstName, student.lastName].filter(Boolean).join(" ") || "Unnamed"}</td>
                      <td>{student.riskBand || "—"}</td>
                      <td>{student.riskScore ?? "—"}</td>
                      <td>{student.courseCode || student.courseName || "—"}</td>
                      <td>{student.lastActivityAt ? new Date(student.lastActivityAt).toLocaleString() : "—"}</td>
                      <td><button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => openStudent(student.studentKey)}>View</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {cursor && <button className={styles.button} type="button" onClick={() => search(cursor)}>Next page</button>}
            </section>
          )}
          {selected && (
            <aside className={styles.detail} aria-live="polite">
              <h2>Student detail</h2>
              <dl>
                <dt>Name</dt><dd>{[selected.firstName, selected.lastName].filter(Boolean).join(" ") || "Unnamed"}</dd>
                <dt>Risk band</dt><dd>{selected.riskBand || "—"}</dd>
                <dt>Risk score</dt><dd>{selected.riskScore ?? "—"}</dd>
                <dt>Course</dt><dd>{[selected.courseCode, selected.courseName].filter(Boolean).join(" — ") || "—"}</dd>
                <dt>Last activity</dt><dd>{selected.lastActivityAt ? new Date(selected.lastActivityAt).toLocaleString() : "—"}</dd>
              </dl>
              <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => setSelected(null)}>Close</button>
            </aside>
          )}
        </main>
      </div>
    </AccessGate>
  );
}
