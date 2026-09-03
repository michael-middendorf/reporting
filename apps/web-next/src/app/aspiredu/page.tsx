"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import {
  GAP_WORKBOOK_FILENAME,
  buildPowerCampusGapWorkbook,
  buildSssMasterWorkbook,
  triggerXlsxDownload,
} from "@/lib/aspiredu-exact-reports";
import { loadAllCourses } from "@/lib/aspiredu-load-courses";
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
    desc: "Course-level AspireDU rows whose term looks like Summer 1 / SU 1.",
  },
  {
    href: "/aspiredu/provisional/athletics",
    title: "Athletics Provisional",
    desc: "All courses in the latest AspireDU statistics file.",
  },
  {
    href: "/aspiredu/eot/spring",
    title: "Spring EOT Grade Report",
    desc: "Spring course rows plus a letter-grade distribution from AspireDU numeric grades.",
  },
  {
    href: "/aspiredu/students",
    title: "Student follow-up",
    desc: "Student search grouped from the same statistics snapshot.",
  },
];

export default function AcademicAffairsHubPage() {
  const [latest, setLatest] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Summary[]>([]);
  const [status, setStatus] = useState("Loading daily risk summary…");
  const [downloadStatus, setDownloadStatus] = useState("");

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

  function downloadGap() {
    triggerXlsxDownload(GAP_WORKBOOK_FILENAME, buildPowerCampusGapWorkbook());
  }

  async function downloadSss() {
    setDownloadStatus("Loading current AspireDU course rows…");
    try {
      const result = await loadAllCourses();
      if (result.mfaRequired) {
        setDownloadStatus("Authentication required. Sign in again.");
        return;
      }
      triggerXlsxDownload(
        "Student Support Services Internal Master Sheet.xlsx",
        buildSssMasterWorkbook(result.courses),
      );
      setDownloadStatus("");
    } catch (error) {
      setDownloadStatus(error instanceof Error ? error.message : "Unable to build the SSS workbook.");
    }
  }

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Academic Affairs" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <h1>Academic Affairs</h1>
          <p className={styles.notice}>
            Deidentified totals below. Signed-in Academic Affairs users can open student and course reports. Excel
            templates keep every original column. Dropout Detective fields fill from this AspireDU feed. PowerCampus
            values (sport, GPA, credits, and the rest) stay blank until those extracts are supplied.
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
          <section className={styles.panel}>
            <h2>Template downloads</h2>
            <p className={styles.meta}>
              The SSS Internal Master uses current AspireDU rows only (no historical dated tabs). The PowerCampus
              workbook is schema only: no student rows.
            </p>
            <div className={styles.toolbar}>
              <button className={styles.button} type="button" onClick={() => void downloadSss()}>
                Download SSS Internal Master
              </button>
              <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={downloadGap}>
                Download PowerCampus fields needed
              </button>
              <a className={`${styles.button} ${styles.secondary}`} href="/settings/security">Security</a>
            </div>
            {downloadStatus && <p>{downloadStatus}</p>}
          </section>
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
