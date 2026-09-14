"use client";

import { useMemo, useState } from "react";
import { SheetTable, fmtDec, fmtN, fmtPct } from "@/components/census/Sheet";
import type { CensusRawStudent, LoaWithStatus, UnretainedStudent } from "@/lib/reports/census/lists-core";
import {
  CENSUS_RAW_HEADERS,
  FTCA_RAW_HEADERS,
  LOA_HEADERS,
  LOA_LIVE_EXTRA_HEADERS,
  UNRETAINED_HEADERS,
  censusRawRow,
  displayListRow,
  ftcaRawRow,
  loaLiveRow,
  unretainedRow,
} from "@/lib/reports/census/list-columns";
import type { FtcaRawRow, SportRetentionRow } from "@/lib/reports/census/retention";

function haystack(row: Record<string, unknown>): string {
  return Object.values(row).join(" ").toLowerCase();
}

export function RawDataSheet({
  students,
  alumniIds = new Set(),
}: {
  students: CensusRawStudent[];
  alumniIds?: Set<string>;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? students.filter((s) => haystack(s as unknown as Record<string, unknown>).includes(needle)) : students;
    return list.map((s) => displayListRow(censusRawRow(s, alumniIds)));
  }, [students, q, alumniIds]);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>FA26 Census Raw Data</h2>
        <p className="sheet-n">{fmtN(students.length)} students from registration (undergraduate and graduate)</p>
      </div>
      {!students.length ? (
        <p className="note">Student list is not published yet. After aws login, run publish-census-lists.sh.</p>
      ) : (
        <>
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PCID, sport…" />
          <SheetTable title="" scroll headers={[...CENSUS_RAW_HEADERS]} rows={rows} />
        </>
      )}
    </div>
  );
}

export function UnretainedSheet({ students }: { students: UnretainedStudent[] }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? students.filter((s) => haystack(s as unknown as Record<string, unknown>).includes(needle)) : students;
    return list.map((s) => displayListRow(unretainedRow(s)));
  }, [students, q]);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>All Not Retained</h2>
        <p className="sheet-n">
          {fmtN(students.length)} Fall 2025 census students not registered Fall 2026 and not 2025–26 graduates
        </p>
      </div>
      {!students.length ? (
        <p className="note">Unretained list is not published yet.</p>
      ) : (
        <>
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PCID, sport…" />
          <SheetTable title="" scroll headers={[...UNRETAINED_HEADERS]} rows={rows} />
        </>
      )}
    </div>
  );
}

export function FtcaRawSheet({ rows }: { rows: FtcaRawRow[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? rows.filter((s) => haystack(s as unknown as Record<string, unknown>).includes(needle)) : rows;
    return list.map((s) => displayListRow(ftcaRawRow(s)));
  }, [rows, q]);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>F25–F26 FTCA Retention Raw Data</h2>
        <p className="sheet-n">{fmtN(rows.length)} Fall 2025 Incoming + FTCA students</p>
      </div>
      {!rows.length ? (
        <p className="note">FTCA cohort file is not published yet (needs Fall 2025 census raw).</p>
      ) : (
        <>
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PCID, sport…" />
          <SheetTable title="" scroll headers={[...FTCA_RAW_HEADERS]} rows={shown} />
        </>
      )}
    </div>
  );
}

export function LoaSheet({
  rows,
  title,
  note,
}: {
  rows: LoaWithStatus[];
  title: string;
  note: string;
  classHeader?: string;
  sportHeader?: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? rows.filter((s) => haystack(s as unknown as Record<string, unknown>).includes(needle)) : rows;
    return list.map((s) => displayListRow(loaLiveRow(s)));
  }, [rows, q]);
  const returned = rows.filter((s) => s.status === "Returned").length;
  const gone = rows.filter((s) => s.status === "Did not return").length;
  const graduated = rows.filter((s) => s.status === "Graduated").length;
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>{title}</h2>
        <p className="sheet-n">
          {fmtN(rows.length)} LOA · {fmtN(returned)} returned Fall 2026 · {fmtN(gone)} did not return
          {graduated ? ` · ${fmtN(graduated)} graduated` : ""}
        </p>
      </div>
      <p className="note">{note}</p>
      {!rows.length ? (
        <p className="note">No leave of absence students in the current filter.</p>
      ) : (
        <>
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PCID, sport, status…" />
          <SheetTable
            title=""
            scroll
            headers={[...LOA_HEADERS, ...LOA_LIVE_EXTRA_HEADERS]}
            rows={shown}
          />
        </>
      )}
    </div>
  );
}

export function SportRetentionTable({ rows }: { rows: SportRetentionRow[] }) {
  if (!rows.length) return null;
  const tot = {
    athletes: rows.reduce((s, r) => s + r.athletes, 0),
    associated: rows.reduce((s, r) => s + r.associated, 0),
    notRetained: rows.reduce((s, r) => s + r.notRetained, 0),
    retained: rows.reduce((s, r) => s + r.retained, 0),
    graduated: rows.reduce((s, r) => s + r.graduated, 0),
    notRetained3plus: rows.reduce((s, r) => s + r.notRetained3plus, 0),
  };
  return (
    <SheetTable
      title="Athletic Retention"
      headers={[
        "Team",
        "FA25 Athletes",
        "FA25 Associated",
        "# Non-Retained",
        "# Retained",
        "# Graduated",
        "Retention %",
        "Graduated %",
        "Retained Avg. GPA",
        "Non-Retained Avg. GPA",
        "Non-Retained 3.0+ GPA",
      ]}
      rows={[
        ...rows.map((r) => [
          r.sport,
          fmtN(r.athletes),
          fmtN(r.associated),
          fmtN(r.notRetained),
          fmtN(r.retained),
          fmtN(r.graduated),
          r.retentionPct == null ? "—" : fmtPct(r.retentionPct),
          r.graduatedPct == null ? "—" : fmtPct(r.graduatedPct),
          fmtDec(r.retainedAvgGpa),
          fmtDec(r.notRetainedAvgGpa),
          fmtN(r.notRetained3plus),
        ]),
        [
          "Total",
          fmtN(tot.athletes),
          fmtN(tot.associated),
          fmtN(tot.notRetained),
          fmtN(tot.retained),
          fmtN(tot.graduated),
          "",
          "",
          "",
          "",
          fmtN(tot.notRetained3plus),
        ],
      ]}
      note={'*Athletes = team players (Varsity / Non-Varsity / Non-NAIA). **Associated = band, managers, and other affiliates. Athlete/Non-Athlete tables use Associated. Leavers count against the Fall 2025 sport.'}
    />
  );
}
