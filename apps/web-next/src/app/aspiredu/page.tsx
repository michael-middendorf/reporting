"use client";

import { useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import styles from "./aspiredu.module.css";

type Summary = {
  asOf?: string;
  studentCount?: number;
  riskBands?: Record<string, number>;
};

export default function AspireduSummaryPage() {
  const [latest, setLatest] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Summary[]>([]);
  const [status, setStatus] = useState("Loading daily risk summary…");

  useEffect(() => {
    apiFetch("/aspiredu/api/summary", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load AspireDU summary");
        return response.json();
      })
      .then((body) => {
        setLatest(body.latest || null);
        setHistory(body.history || []);
        setStatus(body.latest ? "" : "Awaiting the first approved AspireDU delivery.");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Unable to load summary"));
  }, []);

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="AspireDU Student Risk" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <h1>Daily risk summary</h1>
          <p className={styles.notice}>This page contains deidentified aggregate information. Student names and records require a separate MFA session.</p>
          {status && <p>{status}</p>}
          {latest && (
            <>
              <div className={styles.grid}>
                <div className={styles.metric}><span>Students in latest snapshot</span><strong>{latest.studentCount ?? 0}</strong></div>
                {Object.entries(latest.riskBands || {}).map(([band, count]) => (
                  <div className={styles.metric} key={band}><span>{band} risk</span><strong>{count}</strong></div>
                ))}
              </div>
              <section className={styles.panel}>
                <h2>Recent snapshots</h2>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>As of</th><th>Students</th><th>Risk distribution</th></tr></thead>
                    <tbody>{history.map((item, index) => (
                      <tr key={`${item.asOf || "snapshot"}-${index}`}>
                        <td>{item.asOf ? new Date(item.asOf).toLocaleString() : "Unknown"}</td>
                        <td>{item.studentCount ?? 0}</td>
                        <td>{Object.entries(item.riskBands || {}).map(([band, count]) => `${band}: ${count}`).join(" · ") || "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </AccessGate>
  );
}
