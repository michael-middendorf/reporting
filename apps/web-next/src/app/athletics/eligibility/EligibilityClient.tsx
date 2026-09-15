"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SimpleXlsx, triggerXlsxDownload } from "@/lib/aspiredu-xlsx";
import {
  eligibilityExportRows,
  type EligibilityAthlete,
  type EligibilitySnapshot,
} from "@/lib/reports/athletics/eligibility";

function formatHours(value: number | null): string {
  if (value === null) return "—";
  return String(value);
}

function formatGpa(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(2);
}

export function EligibilityClient() {
  const [data, setData] = useState<EligibilitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mfaUrl, setMfaUrl] = useState<string | null>(null);
  const [sportKey, setSportKey] = useState("all");
  const [search, setSearch] = useState("");

  function load() {
    setLoading(true);
    apiFetch("/api/athletics-eligibility-data")
      .then(async (response) => {
        const json = await response.json();
        if (response.status === 401 && json.mfaUrl) {
          setMfaUrl(String(json.mfaUrl));
          setError(null);
          setData(null);
          return;
        }
        if (!response.ok) throw new Error(json.error || `Error ${response.status}`);
        setData(json as EligibilitySnapshot);
        setError(null);
        setMfaUrl(null);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setData(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const sports = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of data?.athletes || []) {
      if (row.sportKey && !seen.has(row.sportKey)) seen.set(row.sportKey, row.sport);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.athletes || []).filter((row) => {
      if (sportKey !== "all" && row.sportKey !== sportKey) return false;
      if (!q) return true;
      return `${row.name} ${row.email} ${row.pcid} ${row.sport}`.toLowerCase().includes(q);
    });
  }, [data, sportKey, search]);

  function exportExcel() {
    const book = new SimpleXlsx();
    book.addSheet("Eligibility", eligibilityExportRows(visible));
    const stamp = new Date().toISOString().slice(0, 10);
    triggerXlsxDownload(`Athletics_Eligibility_${stamp}.xlsx`, book.write());
  }

  return (
    <main className="ath-page ath-giving">
      <div className="ath-page-heading ath-giving-banner">
        <div>
          <p className="ath-kicker">Athletics</p>
          <h1>Eligibility</h1>
        </div>
        <div className="ath-giving-actions">
          <button type="button" className="ath-secondary" onClick={exportExcel} disabled={!visible.length}>
            Export Excel
          </button>
          <button type="button" className="ath-primary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {mfaUrl ? (
        <div className="ath-state">
          <p>Eligibility uses student academic records. Continue with an authenticator code.</p>
          <a className="ath-primary" href={mfaUrl}>
            Continue →
          </a>
        </div>
      ) : null}
      {error ? (
        <div className="ath-state">
          <p>{error}</p>
        </div>
      ) : null}

      {!error && !mfaUrl && data ? (
        <>
          <div className="ath-giving-filters">
            <div className="ath-giving-date-filter">
              <span>Sport</span>
              <div className="ath-giving-date-presets" role="group" aria-label="Sport">
                <button
                  type="button"
                  className={sportKey === "all" ? "is-active" : ""}
                  onClick={() => setSportKey("all")}
                >
                  All sports
                </button>
                {sports.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={sportKey === key ? "is-active" : ""}
                    onClick={() => setSportKey(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <section className="ath-card ath-giving-table">
            <div className="ath-card-title">
              <h2>NAIA eligibility hours</h2>
            </div>
            <div className="ath-table-tools">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, PCID, or sport"
              />
              <span>
                {visible.length} athlete{visible.length === 1 ? "" : "s"}
              </span>
            </div>
            <EligibilityTable rows={visible} data={data} />
          </section>
        </>
      ) : null}
    </main>
  );
}

function EligibilityTable({
  rows,
  data,
}: {
  rows: EligibilityAthlete[];
  data: EligibilitySnapshot;
}) {
  if (!rows.length) {
    return <p className="ath-empty">No athletes in this view.</p>;
  }
  return (
    <div className="ath-table-scroll">
      <table className="ath-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Sport</th>
            <th>Current hours ({data.currentTerm})</th>
            <th>Prior term ({data.priorTerm})</th>
            <th>Second-to-last ({data.secondLastTerm})</th>
            <th>Summer ({data.summerTerm})</th>
            <th>Cum. hours earned</th>
            <th>Cum. GPA</th>
            <th>Full-time terms (TOA)</th>
            <th>Matriculation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.pcid || row.email || row.name}>
              <td>{row.name}</td>
              <td>{row.sport || "—"}</td>
              <td>{formatHours(row.currentHours)}</td>
              <td>{formatHours(row.priorTermHours)}</td>
              <td>{formatHours(row.secondLastHours)}</td>
              <td>{formatHours(row.summerHours)}</td>
              <td>{formatHours(row.earnedHours)}</td>
              <td>{formatGpa(row.cumGpa)}</td>
              <td>{formatHours(row.fullTimeTerms)}</td>
              <td>{row.matriculation || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
