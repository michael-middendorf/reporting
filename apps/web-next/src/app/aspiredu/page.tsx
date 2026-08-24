"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import styles from "./aspiredu.module.css";

type Summary = {
  asOf?: string;
  studentCount?: number;
  courseCount?: number;
  riskBands?: Record<string, number>;
  riskScores?: Record<string, number>;
};

const REPORTS = [
  {
    href: "/aspiredu/provisional/summer-1",
    title: "Summer 1 Athletic Provisional",
    desc: "Course-level AspireDU rows whose term looks like Summer 1 / SU 1. MFA required.",
  },
  {
    href: "/aspiredu/provisional/athletics",
    title: "Athletics Provisional",
    desc: "All courses in the latest AspireDU statistics file. MFA required.",
  },
  {
    href: "/aspiredu/students",
    title: "Student follow-up",
    desc: "MFA student search grouped from the same statistics snapshot.",
  },
];

export default function AcademicAffairsHubPage() {
  const [latest, setLatest] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Summary[]>([]);
  const [status, setStatus] = useState("Loading daily risk summary…");

  useEffect(() => {
    apiFetch("/aspiredu/api/summary", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load Academic Affairs summary");
        return response.json();
      })
      .then((body) => {
        setLatest(body.latest || null);
        setHistory(body.history || []);
        setStatus(body.latest ? "" : "Awaiting the first AspireDU statistics delivery.");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Unable to load summary"));
  }, []);

  const risk = latest?.riskScores || latest?.riskBands || {};

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Academic Affairs" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <h1>Academic Affairs</h1>
          <p className={styles.notice}>
            Deidentified totals below. Student names and course rows require a separate MFA session. These reports use AspireDU statistics only — sport, GPA, and credits are not in this feed.
          </p>
          {status && <p>{status}</p>}
          {latest && (
            <div className={styles.grid}>
              <div className={styles.metric}><span>Students in latest snapshot</span><strong>{latest.studentCount ?? 0}</strong></div>
              {latest.courseCount !== undefined && (
                <div className={styles.metric}><span>Course rows</span><strong>{latest.courseCount}</strong></div>
              )}
              {Object.entries(risk).map(([band, count]) => (
                <div className={styles.metric} key={band}><span>Risk {band}</span><strong>{count}</strong></div>
              ))}
            </div>
          )}
          <div className={styles.cardGrid}>
            {REPORTS.map((report) => (
              <Link key={report.href} href={report.href} className={styles.card}>
                <h2>{report.title}</h2>
                <p>{report.desc}</p>
                <span>Open →</span>
              </Link>
            ))}
          </div>
          {history.length > 0 && (
            <section className={styles.panel}>
              <h2>Recent snapshots</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>As of</th><th>Students</th><th>Risk distribution</th></tr></thead>
                  <tbody>{history.map((item, index) => (
                    <tr key={`${item.asOf || "snapshot"}-${index}`}>
                      <td>{item.asOf ? new Date(item.asOf).toLocaleString() : "Unknown"}</td>
                      <td>{item.studentCount ?? 0}</td>
                      <td>{Object.entries(item.riskScores || item.riskBands || {}).map(([band, count]) => `${band}: ${count}`).join(" · ") || "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
    </AccessGate>
  );
}
