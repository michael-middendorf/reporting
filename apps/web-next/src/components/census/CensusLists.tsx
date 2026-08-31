"use client";

import { useMemo, useState } from "react";
import { SheetTable, fmtN } from "@/components/census/Sheet";
import type { CensusRawStudent, LoaWithStatus, UnretainedStudent } from "@/lib/reports/census/lists-core";
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
      s.religion || "—",
      s.cathGroup || "—",
      s.program,
      s.degree || "—",
      s.session || "—",
      s.collegeAttend,
      s.classLevel,
      s.fullPart,
      s.sport || "—",
      s.institute || "—",
      s.honors || "—",
      s.residency,
      s.gender,
    ]);
  }, [students, q]);
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
          <SheetTable
            title=""
            scroll
            headers={["PCID", "First", "Last", "In/Ret", "State", "Religion", "Cath/Chris/Other", "Program", "Degree", "Session", "College", "Class", "Load", "Sport", "Institute", "Honors", "Residency", "Gender"]}
            rows={rows}
          />
        </>
      )}
    </div>
  );
}

function isSeniorClass(classLevel: string | undefined): boolean {
  return /senior|^sr$/i.test(classLevel || "");
}

export function UnretainedSheet({ students }: { students: UnretainedStudent[] }) {
  const [q, setQ] = useState("");
  const seniors = useMemo(
    () =>
      students
        .filter((s) => isSeniorClass(s.classLevel) && (s.program || "UNDERG") === "UNDERG")
        .slice()
        .sort((a, b) => Number(b.earnedCredits || 0) - Number(a.earnedCredits || 0) || a.last.localeCompare(b.last)),
    [students],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? students.filter((s) => haystack(s as unknown as Record<string, unknown>).includes(needle)) : students;
    return list.map((s) => [
      s.pcid,
      s.first,
      s.last,
      s.retention,
      s.gpa,
      s.earnedCredits ?? "—",
      s.credits ?? "—",
      s.sport || "—",
      s.program || "",
      s.collegeAttend,
      s.classLevel,
      s.gender,
      s.religion || "—",
      s.state,
    ]);
  }, [students, q]);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>All Not Retained</h2>
        <p className="sheet-n">
          {fmtN(students.length)} Fall 2025 census students not registered Fall 2026 and not 2025–26 graduates
          {students.filter((s) => /senior|^sr$/i.test(s.classLevel || "")).length
            ? ` · ${fmtN(students.filter((s) => /senior|^sr$/i.test(s.classLevel || "")).length)} seniors`
            : ""}
        </p>
      </div>
      {!students.length ? (
        <p className="note">Unretained list is not published yet.</p>
      ) : (
        <>
          {seniors.length > 0 && (
            <SheetTable
              title="Unretained seniors — confirm they did not graduate"
              headers={["PCID", "First", "Last", "GPA", "Earned credits", "FA25 credits", "Sport", "College"]}
              rows={seniors.map((s) => [
                s.pcid,
                s.first,
                s.last,
                s.gpa,
                s.earnedCredits ?? "—",
                s.credits ?? "—",
                s.sport || "—",
                s.collegeAttend,
              ])}
            />
          )}
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PCID, sport…" />
          <SheetTable
            title=""
            scroll
            headers={[
              "PCID",
              "First",
              "Last",
              "Retention",
              "GPA",
              "Earned credits",
              "FA25 credits",
              "FA25 Sport",
              "Program",
              "College",
              "Class",
              "Gender",
              "Religion",
              "State",
            ]}
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
      s.religion || "—",
      s.cathGroup || "—",
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
            headers={["First", "Last", "Retained F25?", "PCID", "Religion", "Cath/Chris/Other", "FA25 Sport", "FA25 Curriculum", "FA26 Sport", "FA26 Class", "FA26 Curriculum"]}
            rows={shown}
          />
        </>
      )}
    </div>
  );
}

export function LoaSheet({ rows }: { rows: LoaWithStatus[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? rows.filter((s) => haystack(s as unknown as Record<string, unknown>).includes(needle)) : rows;
    return list.map((s) => [
      s.pcid,
      s.first,
      s.last,
      s.status,
      s.classLevel,
      s.incomingReturning,
      s.curriculum,
      s.sport || "—",
      s.finalGpa || s.gpa || "—",
      s.household || "—",
      s.fsp || "—",
      s.gender,
      s.state || "—",
      s.fa26Class || "—",
      s.fa26Sport || "—",
      s.fa26Curriculum || "—",
      s.fa26Residency || "—",
    ]);
  }, [rows, q]);
  const returned = rows.filter((s) => s.status === "Returned").length;
  const gone = rows.filter((s) => s.status === "Did not return").length;
  const graduated = rows.filter((s) => s.status === "Graduated").length;
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Spring 2026 Leave of Absence</h2>
        <p className="sheet-n">
          {fmtN(rows.length)} on the S26 LOA census · {fmtN(returned)} returned Fall 2026 · {fmtN(gone)} did not return
          {graduated ? ` · ${fmtN(graduated)} graduated` : ""}
        </p>
      </div>
      <p className="note">
        Roster is the Spring 2026 census Leave of Absence sheet. Status is Fall 2026 Registration Status: Returned if they
        are enrolled now, Did not return if they are on All Not Retained, Graduated if they finished in Fall 2025 / Spring
        2026 / Summer 2026. The 6 who did not return are already in All Not Retained.
      </p>
      {!rows.length ? (
        <p className="note">No S26 LOA students in the current filter.</p>
      ) : (
        <>
          <input className="sheet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PCID, sport, status…" />
          <SheetTable
            title=""
            scroll
            headers={[
              "PCID",
              "First",
              "Last",
              "FA26 status",
              "S26 class",
              "In/Ret",
              "Curriculum",
              "S26 sport",
              "GPA",
              "Household",
              "FSP",
              "Gender",
              "State",
              "FA26 class",
              "FA26 sport",
              "FA26 curriculum",
              "FA26 residency",
            ]}
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
