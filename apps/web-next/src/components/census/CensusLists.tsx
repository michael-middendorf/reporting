"use client";

import { useMemo, useState } from "react";
import { SheetTable, fmtN } from "@/components/census/Sheet";
import type { CensusRawStudent, UnretainedStudent } from "@/lib/reports/census/lists-core";
import type { FtcaRawRow, SportRetentionRow } from "@/lib/reports/census/retention";
import type { VerifyRow } from "@/lib/reports/census/verify";

function haystack(row: Record<string, unknown>): string {
  return Object.values(row).join(" ").toLowerCase();
}

export function RawDataSheet({ students }: { students: CensusRawStudent[] }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? students.filter((s) => haystack(s as unknown as Record<string, unknown>).includes(needle)) : students;
    return list.map((s) => [
      s.pcid,
      s.first,
      s.last,
      s.incomingReturning,
      s.state,
      s.program,
      s.collegeAttend,
      s.classLevel,
      s.fullPart,
      s.sport || "—",
      s.residency,
      s.gender,
    ]);
  }, [students, q]);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>FA26 Census Raw Data</h2>
        <p className="sheet-n">{fmtN(students.length)} students from registration</p>
      </div>
      {!students.length ? (
        <p className="note">Student list is not published yet. After aws login, run publish-census-lists.sh.</p>
      ) : (
        <>
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PCID, sport…" />
          <SheetTable
            title=""
            scroll
            headers={["PCID", "First", "Last", "In/Ret", "State", "Program", "College", "Class", "Load", "Sport", "Residency", "Gender"]}
            rows={rows}
          />
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
    return list.map((s) => [
      s.pcid,
      s.first,
      s.last,
      s.retention,
      s.gpa,
      s.sport || "—",
      s.program || "",
      s.collegeAttend,
      s.classLevel,
      s.gender,
      s.state,
    ]);
  }, [students, q]);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>All Not Retained</h2>
        <p className="sheet-n">{fmtN(students.length)} Fall 2025 census students not registered Fall 2026 and not 2025–26 graduates</p>
      </div>
      {!students.length ? (
        <p className="note">Unretained list is not published yet.</p>
      ) : (
        <>
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PCID, sport…" />
          <SheetTable
            title=""
            scroll
            headers={["PCID", "First", "Last", "Retention", "GPA", "FA25 Sport", "Program", "College", "Class", "Gender", "State"]}
            rows={rows}
          />
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
    return list.map((s) => [
      s.first,
      s.last,
      s.retained,
      s.pcid,
      s.fa25Sport || "—",
      s.fa25Curriculum,
      s.fa26Sport || "—",
      s.fa26Class,
      s.fa26Curriculum,
    ]);
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
          <SheetTable
            title=""
            scroll
            headers={["First", "Last", "Retained F25?", "PCID", "FA25 Sport", "FA25 Curriculum", "FA26 Sport", "FA26 Class", "FA26 Curriculum"]}
            rows={shown}
          />
        </>
      )}
    </div>
  );
}

export function VerifySheet({ rows }: { rows: VerifyRow[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter((s) => haystack(s as unknown as Record<string, unknown>).includes(needle))
      : rows;
    return list.map((s) => [s.issue, s.pcid, s.first, s.last, s.why, s.detail]);
  }, [rows, q]);
  const byIssue = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.issue, (m.get(r.issue) || 0) + 1);
    return [...m.entries()];
  }, [rows]);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Verify (temporary)</h2>
        <p className="sheet-n">
          {fmtN(rows.length)} mismatches to check — Ireland session vs housing, unretained seniors, housed but not registered
        </p>
      </div>
      <p className="note">
        Temporary review list. These people may be coded wrong; they are not removed from census counts until you
        confirm.
      </p>
      {byIssue.length > 0 && (
        <p className="note">{byIssue.map(([issue, n]) => `${issue}: ${n}`).join(" · ")}</p>
      )}
      {!rows.length ? (
        <p className="note">No mismatch rows with the current lists.</p>
      ) : (
        <>
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issue, name, PCID…" />
          <SheetTable
            title=""
            scroll
            headers={["Issue", "PCID", "First", "Last", "Why", "Detail"]}
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
    roster: rows.reduce((s, r) => s + r.roster, 0),
    notRetained: rows.reduce((s, r) => s + r.notRetained, 0),
    retained: rows.reduce((s, r) => s + r.retained, 0),
    graduated: rows.reduce((s, r) => s + r.graduated, 0),
  };
  return (
    <SheetTable
      title="Athletic Retention (Fall 2025 sport)"
      headers={["Team", "FA25 Roster", "# Non-Retained", "# Retained", "# Graduated", "Retention %", "Graduated %"]}
      rows={[
        ...rows.map((r) => [
          r.sport,
          fmtN(r.roster),
          fmtN(r.notRetained),
          fmtN(r.retained),
          fmtN(r.graduated),
          r.retentionPct == null ? "—" : `${(r.retentionPct * 100).toFixed(1)}%`,
          r.graduatedPct == null ? "—" : `${(r.graduatedPct * 100).toFixed(1)}%`,
        ]),
        ["Total", fmtN(tot.roster), fmtN(tot.notRetained), fmtN(tot.retained), fmtN(tot.graduated), "", ""],
      ]}
      note="Leavers count against the sport they played on the Fall 2025 census, not this fall."
    />
  );
}
