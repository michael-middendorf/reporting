"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ASPIREDU_NAV } from "@/lib/report-nav";
import { apiFetch } from "@/lib/api";
import { triggerXlsxDownload } from "@/lib/aspiredu-xlsx";
import styles from "./aspiredu.module.css";
import s from "./students/students.module.css";
import { EMPTY, formatDate, formatDateTime } from "./students/format";
import {
  MIN_QUERY_CHARS,
  autoSearchParams,
  loadMoreParams,
  queryTooShort,
  type SearchParams,
} from "@/lib/reports/aspiredu/student-search";

type ListStudent = {
  studentKey: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  risk?: number | null;
  riskBand?: string | null;
  riskScore?: number | null;
  courseCount?: number | null;
  missingAssignments?: number | null;
  lastActivityAt?: string | null;
};

type ListResponse = {
  ok?: boolean;
  status?: string;
  asOf?: string | null;
  total?: number;
  riskValues?: number[];
  students?: ListStudent[];
  cursor?: string | null;
  error?: string;
};

function studentName(student: ListStudent): string {
  const last = (student.lastName || "").trim();
  const first = (student.firstName || "").trim();
  if (last && first) return `${last}, ${first}`;
  return last || first || "Unnamed student";
}

/** New Lambda sends `risk`; the old one only had riskBand/riskScore. */
function studentRisk(student: ListStudent): number | null {
  if (typeof student.risk === "number") return student.risk;
  const band = Number(student.riskBand);
  if (student.riskBand && Number.isFinite(band)) return band;
  return typeof student.riskScore === "number" ? student.riskScore : null;
}

/** At most 8 chips: the snapshot can carry many distinct risk scores. */
function chipValues(values: number[]): number[] {
  const sorted = [...new Set(values)].sort((a, b) => b - a);
  if (sorted.length <= 8) return sorted;
  const step = Math.ceil(sorted.length / 8);
  return sorted.filter((_, index) => index % step === 0);
}

function count(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : EMPTY;
}

function errorMessage(status: number, body: ListResponse | null): string {
  if (status === 401) return "Your session has expired. Return to Reports and sign in again.";
  if (status === 403) return "You do not have access to student records.";
  return body?.error || "Unable to load student records.";
}

const FALLBACK_FILENAME = "academic-affairs-students.xlsx";

function filenameFrom(disposition: string | null): string {
  const match = /filename="([^"]+\.xlsx)"/i.exec(disposition || "");
  return match ? match[1]! : FALLBACK_FILENAME;
}

function DownloadButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/aspiredu/api/export", { cache: "no-store" });
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
    <div className={s.downloadBox}>
      <button className={styles.button} type="button" disabled={busy} onClick={() => void download()}>
        {busy ? "Building spreadsheet…" : "Download spreadsheet"}
      </button>
      {error && <p className={s.bannerError} role="alert">{error}</p>}
    </div>
  );
}

export default function AcademicAffairsStudentsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [minRisk, setMinRisk] = useState<number | null>(null);
  const [students, setStudents] = useState<ListStudent[]>([]);
  const [riskValues, setRiskValues] = useState<number[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  // Whole-snapshot count for the header, from the last unfiltered load.
  const [snapshotTotal, setSnapshotTotal] = useState<number | null>(null);
  const [filtered, setFiltered] = useState(false);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);
  // Params of the last first-page load that completed. The cursor belongs to it.
  const committed = useRef<SearchParams | null>(null);

  const load = useCallback(async (options: SearchParams & { cursor?: string }) => {
    const id = ++requestId.current;
    const appending = Boolean(options.cursor);
    if (appending) setLoadingMore(true);
    else setLoading(true);
    setError("");
    // POST keeps typed names out of URLs, which CloudFront and the ALB log.
    const payload = {
      query: options.query.trim() || undefined,
      minRisk: options.minRisk ?? undefined,
      cursor: options.cursor,
    };
    try {
      const response = await apiFetch("/aspiredu/api/students", {
        method: "POST",
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as ListResponse | null;
      if (id !== requestId.current) return;
      if (!response.ok || !body) {
        setError(errorMessage(response.status, body));
        if (!appending) {
          setStudents([]);
          setCursor(null);
          committed.current = null;
        }
        return;
      }
      if (!appending) committed.current = { query: options.query.trim(), minRisk: options.minRisk };
      const page = Array.isArray(body.students) ? body.students : [];
      setStudents((prev) => (appending ? [...prev, ...page] : page));
      setCursor(body.cursor || null);
      setTotal(typeof body.total === "number" ? body.total : null);
      if (!appending) {
        const isFiltered = Boolean(options.query.trim()) || options.minRisk != null;
        setFiltered(isFiltered);
        if (!isFiltered && typeof body.total === "number") setSnapshotTotal(body.total);
      }
      setAsOf(body.asOf || null);
      if (Array.isArray(body.riskValues)) setRiskValues(chipValues(body.riskValues.filter((v) => Number.isFinite(v))));
      setStatus(body.status || null);
    } catch {
      if (id === requestId.current) setError("Unable to reach the student search. Check your connection.");
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // Search as you type (debounced) and whenever the risk chip changes.
  // A 1-character query waits for a second character (Enter still searches);
  // a chip change still reloads, keeping the last committed query.
  useEffect(() => {
    const next = autoSearchParams({ query, minRisk }, committed.current);
    if (!next) return;
    const timer = window.setTimeout(() => void load(next), 300);
    return () => window.clearTimeout(timer);
  }, [query, minRisk, load]);

  function loadMore() {
    const next = loadMoreParams(committed.current, cursor);
    if (next) void load(next);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void load({ query, minRisk });
  }

  function open(studentKey: string) {
    router.push(`/aspiredu/students/${encodeURIComponent(studentKey)}`);
  }

  const shownTotal = total ?? students.length;
  const headerMeta = [
    snapshotTotal !== null ? `${snapshotTotal.toLocaleString()} ${snapshotTotal === 1 ? "student" : "students"}` : null,
    asOf ? `data as of ${formatDateTime(asOf)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <AccessGate report="aspiredu">
      <div className={styles.shell}>
        <ReportTopBar title="Academic Affairs" nav={ASPIREDU_NAV} />
        <main className={styles.content}>
          <header className={s.pageHeader}>
            <div>
              <h1>Students</h1>
              <p className={styles.meta}>{headerMeta || "Loading…"}</p>
            </div>
            <DownloadButton />
          </header>

          <section className={styles.panel}>
            <form className={s.searchForm} onSubmit={onSubmit} role="search">
              <input
                className={s.searchInput}
                type="search"
                aria-label="Search students"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, email, ID, or class"
                autoComplete="off"
                maxLength={200}
              />
              <button className={styles.button} type="submit">Search</button>
            </form>
            {queryTooShort(query) && (
              <p className={s.hint}>Type {MIN_QUERY_CHARS} or more characters to search, or press Enter.</p>
            )}

            {riskValues.length > 0 && (
              <div className={s.chips} role="group" aria-label="Filter by overall risk">
                <span className={s.chipsLabel}>Overall risk</span>
                <button
                  type="button"
                  className={`${s.chip} ${minRisk === null ? s.chipActive : ""}`}
                  aria-pressed={minRisk === null}
                  onClick={() => setMinRisk(null)}
                >
                  All
                </button>
                {riskValues.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`${s.chip} ${minRisk === value ? s.chipActive : ""}`}
                    aria-pressed={minRisk === value}
                    onClick={() => setMinRisk(value)}
                  >
                    {value} or higher
                  </button>
                ))}
              </div>
            )}

            {status === "awaiting_first_delivery" && (
              <p className={s.banner}>Awaiting the first AspireDU statistics delivery. Students will appear once it lands.</p>
            )}
            {error && <p className={s.bannerError} role="alert">{error}</p>}

            <p className={s.countLine} aria-live="polite">
              {loading ? "Searching…" : filtered ? `${shownTotal} ${shownTotal === 1 ? "match" : "matches"}` : ""}
            </p>

            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${s.listTable}`}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className={s.num}>Classes</th>
                    <th className={s.num}>Missing work</th>
                    <th className={s.num}>Risk</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => {
                    const risk = studentRisk(student);
                    const href = `/aspiredu/students/${encodeURIComponent(student.studentKey)}`;
                    return (
                      <tr key={student.studentKey} className={s.clickRow} onClick={() => open(student.studentKey)}>
                        <td>
                          <Link href={href} className={s.nameLink} onClick={(event) => event.stopPropagation()}>
                            {studentName(student)}
                          </Link>
                          {student.email && <span className={s.subtle}>{student.email}</span>}
                        </td>
                        <td className={s.num}>{count(student.courseCount)}</td>
                        <td className={s.num}>{count(student.missingAssignments)}</td>
                        <td className={s.num}>
                          {risk === null ? EMPTY : <span className={s.riskPill}>{risk}</span>}
                        </td>
                        <td>{formatDate(student.lastActivityAt ?? null)}</td>
                      </tr>
                    );
                  })}
                  {!loading && !students.length && !error && (
                    <tr>
                      <td colSpan={6} className={s.emptyCell}>
                        {query.trim() || minRisk !== null ? "No students match this search." : "No students in the current snapshot."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {cursor && (
              <div className={s.loadMore}>
                <button
                  className={`${styles.button} ${styles.secondary}`}
                  type="button"
                  disabled={loading || loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </section>
        </main>
      </div>
    </AccessGate>
  );
}
