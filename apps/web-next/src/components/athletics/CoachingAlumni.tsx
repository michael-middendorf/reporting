"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSportFetch } from "./useSportFetch";
import type { AlumniRow, AlumniSummary } from "@/lib/reports/athletics-coaching/alumni";
import { formatAsOf, formatCount } from "./CoachingHub";

type AlumniResponse = AlumniSummary & { mfaUrl?: string };

const ALL_YEARS = "all";

function yearsOnTeam(row: AlumniRow): string {
  if (row.firstYear === null && row.lastYear === null) return "";
  const span =
    row.firstYear !== null && row.lastYear !== null && row.firstYear !== row.lastYear
      ? `${row.firstYear} to ${row.lastYear}`
      : String(row.firstYear ?? row.lastYear);
  return row.yearsCount !== null ? `${span} (${row.yearsCount} yr${row.yearsCount === 1 ? "" : "s"})` : span;
}

/** "2012-05-12" -> "5/12/2012" without a UTC-to-local shift. */
function formatGradDate(value: string | null): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return value || "";
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

function degreeLabel(row: AlumniRow): string {
  return row.degreeTitle || row.degree;
}

function csvCell(input: unknown): string {
  let value = String(input ?? "");
  if (/^[=+\-@]/.test(value)) value = `'${value}`;
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadAlumniCsv(filename: string, rows: AlumniRow[], includeEmail: boolean) {
  const header = [
    "Name",
    "Class year",
    "Degree",
    "Graduation date",
    "Sports",
    "First year",
    "Last year",
    "Years on team",
    ...(includeEmail ? ["Email"] : []),
  ];
  const lines = rows.map((row) =>
    [
      row.name,
      row.classYear ?? "",
      degreeLabel(row),
      row.graduationDate ?? "",
      row.sports.join("; "),
      row.firstYear ?? "",
      row.lastYear ?? "",
      row.yearsCount ?? "",
      ...(includeEmail ? [row.email ?? ""] : []),
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = [header.map(csvCell).join(","), ...lines].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AlumniPage({ sportKey }: { sportKey: string }) {
  const { data, error, loading } = useSportFetch<AlumniResponse>(
    `/api/athletics-coaching/alumni?sport=${encodeURIComponent(sportKey)}`,
    { noStore: true, fallbackError: "Unable to load alumni" },
  );
  const [search, setSearch] = useState("");
  const [year, setYear] = useState(ALL_YEARS);

  const visible = useMemo(() => {
    const rows = data?.rows ?? [];
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (year !== ALL_YEARS && String(row.classYear ?? "Unknown") !== year) return false;
      if (!query) return true;
      return [row.name, degreeLabel(row), row.sports.join(" "), row.classYear ?? "", row.email ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [data, search, year]);

  const showEmails = Boolean(data && !data.emailsHidden);

  return (
    <section className="ath-coach-band">
      <h2>Alumni</h2>
      {loading ? <p>Loading alumni…</p> : null}
      {error ? <p>{error}</p> : null}
      {!loading && !error && data && !data.available ? (
        <p>The PowerCampus alumni feed is not in yet. Former athletes will show here after the next overnight refresh.</p>
      ) : null}
      {!loading && !error && data?.available ? (
        <>
          <p>
            Graduates who were on this team while enrolled, from PowerCampus team memberships
            {data.slateUsed ? " and Slate sport history" : ""}. Living graduates only.
          </p>
          {data.emailsHidden && data.mfaUrl ? (
            <p>
              Personal emails need an authenticator code.{" "}
              <Link href={data.mfaUrl}>Continue with authenticator</Link>
            </p>
          ) : null}
          <div className="ath-coach-kpis">
            <div className="ath-kpi">
              <span>Alumni</span>
              <strong>{formatCount(data.total)}</strong>
              <small>Graduated former athletes</small>
            </div>
          </div>
          {data.byClassYear.length ? (
            <div className="ath-coach-mix" aria-label="Alumni by class year">
              {data.byClassYear.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {data.rows.length ? (
            <div className="ath-table-wrap">
              <div className="ath-table-tools">
                <label>
                  <span className="sr-only">Search alumni</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search alumni…"
                  />
                </label>
                <label>
                  <span className="sr-only">Class year</span>
                  <select value={year} onChange={(event) => setYear(event.target.value)}>
                    <option value={ALL_YEARS}>All class years</option>
                    {data.byClassYear.map((item) => (
                      <option key={item.label} value={item.label}>
                        {item.label} ({item.count})
                      </option>
                    ))}
                  </select>
                </label>
                <span>{visible.length.toLocaleString()} shown</span>
                <button
                  type="button"
                  className="ath-text-btn"
                  disabled={!visible.length}
                  onClick={() =>
                    downloadAlumniCsv(`${data.sport}-alumni.csv`, visible, showEmails)
                  }
                >
                  Export CSV
                </button>
              </div>
              <div className="ath-table-scroll">
                <table className="ath-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Class year</th>
                      <th>Degree</th>
                      <th>Graduated</th>
                      <th>Sports</th>
                      <th>Years on team</th>
                      {showEmails ? <th>Email</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.classYear ?? ""}</td>
                        <td>{degreeLabel(row) || ""}</td>
                        <td>{formatGradDate(row.graduationDate)}</td>
                        <td>{row.sports.join(", ")}</td>
                        <td>{yearsOnTeam(row) || ""}</td>
                        {showEmails ? (
                          <td>{row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : ""}</td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!visible.length ? <div className="ath-empty">No alumni match the current filters.</div> : null}
            </div>
          ) : (
            <p>No graduated former athletes found for this team.</p>
          )}
          {data.generatedAt ? <p>{formatAsOf(data.generatedAt)}</p> : null}
        </>
      ) : null}
    </section>
  );
}
