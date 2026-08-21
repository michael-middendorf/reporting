"use client";

import { useMemo, useState } from "react";
import { useEnrollment } from "../EnrollmentProvider";
import { BarChart, Kpi, Section, acShort } from "@/components/enrollment/ui";
import { fmt } from "@/lib/reports/enrollment/load";
import {
  cycleLabel,
  statsFrom,
  type WithdrawnBundle,
  type WithdrawalKind,
  type WithdrawalRow,
} from "@/lib/reports/enrollment/withdrawals";

type AthleteFilter = "all" | "athlete" | "non";
type SortKey = keyof WithdrawalRow;
type Col = { k: SortKey; t: string };

const COLS: Col[] = [
  { k: "name", t: "Name" },
  { k: "personReferenceId", t: "Reference ID" },
  { k: "term", t: "Term" },
  { k: "ac", t: "Counselor" },
  { k: "withdrawnDate", t: "Withdrawn" },
  { k: "enrollingDate", t: "Enrolled / deposit" },
  { k: "athlete", t: "Athlete" },
  { k: "sport", t: "Sport" },
  { k: "scholarship", t: "Scholarship" },
  { k: "reason", t: "Reason" },
  { k: "otherSchool", t: "Other school" },
];

function cycleBundle(data: { withdrawn: WithdrawnBundle }, cycle: "fa26" | "fa27") {
  return cycle === "fa26" ? data.withdrawn.fa26 : data.withdrawn.fa27;
}

function priorBundle(data: { withdrawn: WithdrawnBundle }, cycle: "fa26" | "fa27") {
  return cycle === "fa26" ? data.withdrawn.fa25 : data.withdrawn.fa26;
}

function isAthlete(label: string) {
  const s = label.toLowerCase();
  if (!s || s.includes("non")) return false;
  return s.includes("athlete");
}

function csvEscape(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows: WithdrawalRow[], filename: string) {
  const header = COLS.map((c) => c.t);
  const body = rows.map((r) =>
    COLS.map((c) => csvEscape(c.k === "ac" ? acShort(r.ac) : String(r[c.k] ?? ""))).join(","),
  );
  const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function countEntries(map: Record<string, number>) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

export default function WithdrawalsPage() {
  const { data, loading, error, cycle } = useEnrollment();
  const [kind, setKind] = useState<WithdrawalKind>("deposits");
  const [q, setQ] = useState("");
  const [athlete, setAthlete] = useState<AthleteFilter>("all");
  const [sortK, setSortK] = useState<SortKey>("withdrawnDate");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);

  const cur = data ? cycleBundle(data, cycle) : null;
  const prv = data ? priorBundle(data, cycle) : null;
  const cohort = cur ? cur[kind] : null;
  const vs = cycle === "fa26" ? "FA25" : "FA26";
  const emptyCopy =
    kind === "deposits"
      ? `No withdrawn deposits for this cycle yet.`
      : `No withdrawn deferred students for this cycle yet.`;

  const filtered = useMemo(() => {
    if (!cohort) return [];
    const needle = q.trim().toLowerCase();
    let rows = cohort.rows;
    if (athlete === "athlete") rows = rows.filter((r) => isAthlete(r.athlete));
    if (athlete === "non") rows = rows.filter((r) => r.athlete && !isAthlete(r.athlete));
    if (needle) {
      rows = rows.filter((r) => {
        const hay = [
          r.name,
          r.personReferenceId,
          r.term,
          acShort(r.ac),
          r.ac,
          r.sport,
          r.scholarship,
          r.reason,
          r.otherSchool,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
    }
    return rows;
  }, [cohort, q, athlete]);

  const visible = useMemo(() => {
    const dir = sortDir;
    return [...filtered].sort((a, b) => {
      const av = String(a[sortK] ?? "");
      const bv = String(b[sortK] ?? "");
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return cmp * dir;
    });
  }, [filtered, sortK, sortDir]);

  const viewStats = useMemo(() => statsFrom(filtered), [filtered]);

  if (loading)
    return (
      <div className="view active">
        <p>Loading…</p>
      </div>
    );
  if (error || !data || !cur || !prv)
    return (
      <div className="view active">
        <p>{error || "No data"}</p>
      </div>
    );

  function toggleSort(k: SortKey) {
    if (sortK === k) setSortDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortK(k);
      setSortDir(k === "withdrawnDate" || k === "enrollingDate" ? -1 : 1);
    }
  }

  const byAc = countEntries(viewStats.byAC).map(([ac, n]) => ({
    label: acShort(ac),
    value: n,
    tone: "red" as const,
  }));
  const byReason = countEntries(viewStats.byReason).map(([reason, n]) => ({
    label: reason,
    value: n,
    tone: "secondary" as const,
  }));

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Withdrawals {cycleLabel(cycle)}</h1>
          <p className="rpt-sub">
            Deposited students who withdrew, and deferred students who withdrew. Compared with {vs}.
          </p>
        </div>
      </div>

      <div className="kpi-strip">
        <Kpi label="Withdrawn deposits" cur={cur.deposits.total} prv={prv.deposits.total} invert highlight />
        <Kpi label="Withdrawn deferred" cur={cur.deferred.total} prv={prv.deferred.total} invert />
        <Kpi label="Athletes (deposits)" cur={cur.deposits.athlete} />
        <Kpi label="Non-athletes (deposits)" cur={cur.deposits.nonAthlete} />
      </div>

      <div className="wd-toolbar">
        <div className="wd-seg" role="tablist" aria-label="Withdrawal cohort">
          <button
            type="button"
            role="tab"
            aria-selected={kind === "deposits"}
            className={`wd-seg-btn${kind === "deposits" ? " on" : ""}`}
            onClick={() => setKind("deposits")}
          >
            Deposits ({fmt(cur.deposits.total)})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "deferred"}
            className={`wd-seg-btn${kind === "deferred" ? " on" : ""}`}
            onClick={() => setKind("deferred")}
          >
            Deferred ({fmt(cur.deferred.total)})
          </button>
        </div>
        <input
          className="wd-search"
          type="search"
          placeholder="Search name, counselor, sport, reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="wd-seg" role="group" aria-label="Athlete filter">
          {(["all", "athlete", "non"] as AthleteFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`wd-seg-btn${athlete === f ? " on" : ""}`}
              onClick={() => setAthlete(f)}
            >
              {f === "all" ? "All" : f === "athlete" ? "Athlete" : "Non-athlete"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="back-btn"
          disabled={!visible.length}
          onClick={() =>
            downloadCsv(
              visible,
              `${cycle}-${kind}-withdrawals.csv`,
            )
          }
        >
          CSV
        </button>
      </div>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">In view</div>
          <div className="kpi-val">{fmt(visible.length)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Athletes</div>
          <div className="kpi-val">{fmt(viewStats.athlete)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Non-athletes</div>
          <div className="kpi-val">{fmt(viewStats.nonAthlete)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Counselors</div>
          <div className="kpi-val">{fmt(viewStats.counselorCount)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Latest withdrawal</div>
          <div className="kpi-val" style={{ fontSize: 16 }}>
            {viewStats.latestDate || "—"}
          </div>
        </div>
      </div>

      <div className="cols2">
        <div>
          <Section label="By counselor" />
          {byAc.length ? <BarChart rows={byAc} /> : <p className="rpt-sub">{emptyCopy}</p>}
        </div>
        <div>
          <Section label="By reason" />
          {byReason.length ? <BarChart rows={byReason} /> : <p className="rpt-sub">{emptyCopy}</p>}
        </div>
      </div>

      <Section
        label={kind === "deposits" ? "Withdrawn deposits" : "Withdrawn deferred"}
      />
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.k}>
                  <button type="button" className="wd-th" onClick={() => toggleSort(c.k)}>
                    {c.t}
                    {sortK === c.k ? (sortDir === -1 ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={`${r.personReferenceId}-${r.term}-${r.withdrawnDate}`}>
                <td>{r.name}</td>
                <td>{r.personReferenceId}</td>
                <td>{r.term || "—"}</td>
                <td>{acShort(r.ac)}</td>
                <td>{r.withdrawnDate || "—"}</td>
                <td>{r.enrollingDate || r.depositDate || "—"}</td>
                <td>{r.athlete || "—"}</td>
                <td>{r.sport || "—"}</td>
                <td>{r.scholarship || "—"}</td>
                <td>{r.reason || "—"}</td>
                <td>{r.otherSchool || "—"}</td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={COLS.length}>{emptyCopy}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="rpt-sub">
        {fmt(cur.otherCount)} other withdrawals (accepted / no decision) not shown.
      </p>
    </div>
  );
}
