"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { CensusReport } from "@/components/census/CensusReport";
import { FtcaRawSheet, RawDataSheet, UnretainedSheet, VerifySheet } from "@/components/census/CensusLists";
import { FilterBar, fmtN, fmtPct } from "@/components/census/Sheet";
import type { CensusRawStudent, UnretainedStudent } from "@/lib/reports/census/lists-core";
import { isUgDegreeSeekingRow } from "@/lib/reports/census/lists-core";
import {
  DEFAULT_FILTERS,
  buildReport,
  filterCensusRaw,
  filtersForCensusRaw,
  filterStudents,
  filterUnretained,
  uniqueSorted,
  type ReportFilters,
  type ReportStudent,
} from "@/lib/reports/census/report";
import {
  buildAllUgSplit,
  buildFtcaAttritionFromPrior,
  buildSportRetention,
  type FtcaRawRow,
} from "@/lib/reports/census/retention";
import { KPI_DEFS, SUMMARY_DEFS, summaryFromStudents, uniqueStudentCount } from "@/lib/reports/census/from-lists";
import { buildVerifyList } from "@/lib/reports/census/verify";
import type { HousingAssignmentRow } from "@/lib/reports/census/residency";
import {
  historicalSeries,
  type CensusSnapshot,
  type CountFte,
} from "@/lib/reports/census/types";
import "@/styles/census.css";

function fmtFte(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

type Tab = "summary" | "historical" | "ug" | "attrition" | "ftca" | "raw" | "unretained" | "verify";

type CensusPageData = CensusSnapshot & {
  reportStudents?: ReportStudent[];
  rawStudents?: CensusRawStudent[];
  unretainedStudents?: UnretainedStudent[];
  priorStudents?: CensusRawStudent[];
  graduates?: { pcid: string; year?: string | number; term?: string; program?: string }[];
  housingRows?: HousingAssignmentRow[];
  ftcaRaw?: FtcaRawRow[];
  unretained?: { n: number; ug: number };
};

export function CensusDashboard() {
  const [data, setData] = useState<CensusPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const [downloading, setDownloading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function downloadDraft() {
    setExportError(null);
    setDownloading(true);
    try {
      const res = await apiFetch("/api/census-export");
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || res.statusText || "Export failed");
      }
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || "FA26_Census_DRAFT.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/census-data");
        const json = (await res.json()) as CensusPageData & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          setError(json.error || res.statusText || "Data unavailable");
          return;
        }
        setData(json);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const students = data?.reportStudents || [];
  const rawStudents = data?.rawStudents || [];
  const sports = useMemo(() => uniqueSorted(students, (s) => s.sport), [students]);
  const majors = useMemo(
    () => uniqueSorted(students.filter((s) => s.program === "UNDERG"), (s) => s.major),
    [students],
  );
  const peopleFilters = useMemo(() => filtersForCensusRaw(filters), [filters]);
  const filteredAll = useMemo(() => filterCensusRaw(rawStudents, peopleFilters), [rawStudents, peopleFilters]);
  const filteredRaw = useMemo(() => filterCensusRaw(rawStudents, filters), [rawStudents, filters]);
  const filteredReport = useMemo(() => filterStudents(students, filters), [students, filters]);
  const filteredUnretained = useMemo(
    () => filterUnretained(data?.unretainedStudents || [], filters),
    [data?.unretainedStudents, filters],
  );
  const filteredPrior = useMemo(
    () => filterCensusRaw(data?.priorStudents || [], filters),
    [data?.priorStudents, filters],
  );
  const filteredFtca = useMemo(() => {
    const keep = new Set(filteredPrior.map((s) => s.pcid.toUpperCase()));
    return (data?.ftcaRaw || []).filter((r) => keep.has((r.pcid || "").toUpperCase()));
  }, [data?.ftcaRaw, filteredPrior]);
  const sportRows = useMemo(
    () =>
      buildSportRetention(
        filteredPrior,
        filteredRaw.map((s) => s.pcid),
        data?.graduates || [],
        filters.excludedSports,
      ),
    [filteredPrior, filteredRaw, data?.graduates, filters.excludedSports],
  );
  const verifyRows = useMemo(
    () =>
      buildVerifyList(
        filteredRaw,
        filteredUnretained,
        data?.graduates || [],
        data?.housingRows || [],
      ),
    [filteredRaw, filteredUnretained, data?.graduates, data?.housingRows],
  );
  const liveSummary = useMemo(
    () => (rawStudents.length ? summaryFromStudents(filteredAll) : data?.summary),
    [filteredAll, rawStudents.length, data?.summary],
  );
  const liveFtca = useMemo(
    () =>
      filteredPrior.length
        ? buildFtcaAttritionFromPrior(filteredPrior, filteredRaw.map((s) => s.pcid), data?.graduates || [])
        : data?.ftcaAttrition,
    [filteredPrior, filteredRaw, data?.graduates, data?.ftcaAttrition],
  );
  const liveAllUg = useMemo(() => {
    if (!filteredPrior.length) return data?.allUgRetention;
    const ug = buildAllUgSplit(filteredPrior, filteredRaw.map((s) => s.pcid), data?.graduates || []);
    return {
      priorUg: ug.all.students,
      graduates: ug.all.graduated,
      pool: ug.all.students - ug.all.graduated,
      enrolledThisFall: ug.all.enrolled,
      notRetained: ug.all.notRetained,
      retentionRate: ug.all.retentionPct ?? 0,
    };
  }, [filteredPrior, filteredRaw, data?.graduates, data?.allUgRetention]);

  if (error) return <p style={{ padding: 24 }}>Error: {error}</p>;
  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  const tables = filteredReport.length ? buildReport(filteredReport) : null;
  const k = {
    ...data.kpis,
    allStudents: rawStudents.length ? uniqueStudentCount(filteredAll) : data.kpis.allStudents,
    ugStudents: liveSummary?.degreeSeeking.headcount ?? data.kpis.ugStudents,
    states: tables ? tables.states.filter((r) => r.label !== "International").length : data.kpis.states,
    pctCatholic: tables
      ? tables.religion.filter((r) => /cathol/i.test(r.label)).reduce((s, r) => s + r.n, 0) / (tables.n || 1)
      : data.kpis.pctCatholic,
    ugOnCampusPct: tables
      ? (tables.residency.find((r) => r.label === "On Campus" || r.label === "Resident")?.n ?? 0) / (tables.n || 1)
      : data.kpis.ugOnCampusPct,
  };
  const summaryData = {
    ...data,
    summary: liveSummary || data.summary,
    ftcaAttrition: liveFtca || data.ftcaAttrition,
    allUgRetention: liveAllUg || data.allUgRetention,
  };
  return (
    <div className="census-root">
      <div className="wrap">
        <div className="hero">
          <div>
            <div className="eyebrow">Institutional Research</div>
            <h1>{data.term} Census</h1>
            <p className="sub">
              Laid out like the Fall 2025 census workbook. Headcounts come from
              Fall 2026 Registration Status. Filters apply to every sheet.
              Snapshot {data.generated}
              {data.housing
                ? `. Housing from eRez${data.housing.session ? ` (${data.housing.session})` : ""}.`
                : "."}
            </p>
          </div>
          <div className="hero-actions">
            <button type="button" className="download" onClick={downloadDraft} disabled={downloading}>
              {downloading ? "Building Excel…" : "Download Excel draft"}
            </button>
            <span className="draft-pill">{data.status}</span>
          </div>
        </div>
        {exportError && <p className="export-error">Excel export failed: {exportError}</p>}

        {data.pending.length > 0 && (
          <div className="pending">
            <h2>Still to add</h2>
            <ul>
              {data.pending.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="kpis">
          <Kpi label="States" value={fmtN(k.states)} def={KPI_DEFS.states} />
          <Kpi label="All students" value={fmtN(k.allStudents)} def={KPI_DEFS.allStudents} />
          <Kpi label="UG degree-seeking" value={fmtN(k.ugStudents)} def={KPI_DEFS.ugStudents} />
          <Kpi
            label="Ireland"
            value={fmtN(liveSummary?.ireland.headcount ?? data.summary.ireland.headcount)}
            def={KPI_DEFS.ireland}
          />
          <Kpi label="Foreign countries" value={fmtN(k.foreignCountries)} def={KPI_DEFS.foreignCountries} flip />
          <Kpi
            label="UG on campus"
            value={fmtPct(k.ugOnCampusPct)}
            def={KPI_DEFS.ugOnCampus}
            flip
            hint={data.housing ? undefined : "Needs eRez housing list"}
          />
          <Kpi
            label="Incoming avg HS GPA"
            value={k.incomingHsGpa?.toFixed(2) ?? "—"}
            def={KPI_DEFS.incomingHsGpa}
          />
          <Kpi label="% Catholic" value={fmtPct(k.pctCatholic, 0)} def={KPI_DEFS.pctCatholic} />
          <Kpi
            label="Avg CLT / ACT / SAT"
            value={`${k.avgClt ?? "—"}  /  ${k.avgAct ?? "—"}  /  ${k.avgSat ?? "—"}`}
            def={KPI_DEFS.testScores}
            flip
          />
        </div>

        <FilterBar filters={filters} onChange={setFilters} sports={sports} majors={majors} />

        <div className="tabs">
          {(
            [
              ["summary", "Summary"],
              ["historical", "Historical"],
              ["ug", "Census Report"],
              ["attrition", "Retention"],
              ["ftca", "FTCA Raw"],
              ["raw", "Census Raw"],
              ["unretained", "All Not Retained"],
              ["verify", "Verify"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "summary" && <SummaryTab data={summaryData} />}
        {tab === "historical" && <HistoricalTab data={data} />}
        {tab === "ug" && (
          <CensusReport
            data={summaryData}
            students={filteredReport}
            filters={filters}
            sportRows={sportRows}
          />
        )}
        {tab === "attrition" && (
          <AttritionTab
            data={summaryData}
            unretained={{
              n: filteredUnretained.length,
              ug: filteredUnretained.filter((s) => isUgDegreeSeekingRow(s.program || "", s.collegeAttend)).length,
            }}
          />
        )}
        {tab === "ftca" && <FtcaRawSheet rows={filteredFtca} />}
        {tab === "raw" && <RawDataSheet students={filteredAll} />}
        {tab === "unretained" && <UnretainedSheet students={filteredUnretained} />}
        {tab === "verify" && <VerifySheet rows={verifyRows} />}
      </div>
    </div>
  );
}

function InfoTip({ text, flip }: { text: string; flip?: boolean }) {
  return (
    <span
      className={`info${flip ? " flip" : ""}`}
      tabIndex={0}
      aria-label={text}
      onClick={(e) => e.stopPropagation()}
    >
      i<span className="info-tip">{text}</span>
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
  def,
  flip,
}: {
  label: string;
  value: string;
  hint?: string;
  def?: string;
  flip?: boolean;
}) {
  return (
    <div className="kpi">
      <div className="lbl">
        {label}
        {def ? <InfoTip text={def} flip={flip} /> : null}
      </div>
      <div className="val">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function summaryDef(label: string): string | undefined {
  if (label.startsWith("Undergraduate, New Students Admitted")) {
    return SUMMARY_DEFS["Undergraduate, New Students Admitted"];
  }
  return SUMMARY_DEFS[label];
}

function HcFte({ c }: { c: CountFte }) {
  return (
    <>
      <td className="num">{fmtN(c.headcount)}</td>
      <td className="num">{fmtFte(c.fte)}</td>
    </>
  );
}

function SummaryTab({ data }: { data: CensusSnapshot }) {
  const s = data.summary;
  const year = data.historical.years[0] ?? 2026;
  const rows: { label: string; c?: CountFte; indent?: boolean; section?: boolean }[] = [
    { label: "Degree-Seeking", section: true },
    { label: `Undergraduate, New Students Admitted FALL ${year}`, c: s.newStudents },
    { label: "FTCA", c: s.ftca, indent: true },
    { label: "TRAN", c: s.tran, indent: true },
    { label: "READ", c: s.read, indent: true },
    { label: "SECB", c: s.secb, indent: true },
    { label: "Lux Mundi", c: s.luxMundiUg, indent: true },
    { label: "Returning Students", c: s.returning },
    { label: "Ireland", c: s.ireland, indent: true },
    { label: "On Campus", c: s.onCampus, indent: true },
    { label: "Mont Mallary", c: s.montMallary, indent: true },
    { label: "Total Degree-Seeking", c: s.degreeSeeking },
    { label: "High School Dual Enrollment", c: s.dualEnrollment },
    { label: "Chesterton DE", c: s.chestertonDual, indent: true },
    { label: "Chesterton", c: s.chesterton, indent: true },
    { label: "Non-Degree-Seeking / Personal Enrichment", c: s.nonDegree },
    { label: "Lux Mundi Non-Degree-Seeking / Personal Enrichment", c: s.luxMundiUg },
    { label: "TOTAL UNDERGRADUATE ENROLLMENT", c: s.totalUndergraduate },
    { label: "Graduate MA Students", c: s.gradMa },
    { label: "Graduate PhD Students", c: s.gradPhd },
    { label: "Graduate MBA Students", c: s.gradMba },
    { label: "Graduate MEdCl", c: s.gradMedcl },
    { label: "Graduate MA Theo (Online) - Lux Mundi", c: s.luxMundiGrad },
    { label: "TOTAL GRADUATE ENROLLMENT", c: s.totalGraduate },
    { label: "Graduate & Undergraduate Enrollment", c: s.totalEnrollment },
  ];
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Summary</h2>
        <p className="sheet-n">HEADCOUNT / FTE</p>
      </div>
      <div className="sheet-table sheet-table-tips">
      <table>
        <thead>
          <tr>
            <th></th>
            <th className="num">HEADCOUNT</th>
            <th className="num">FTE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              className={
                r.label.startsWith("TOTAL") || r.label.startsWith("Total") || r.label.startsWith("Graduate &")
                  ? "total"
                  : r.indent
                    ? "indent"
                    : ""
              }
            >
              <td>
                <span className="row-label">
                  {r.label}
                  {summaryDef(r.label) ? <InfoTip text={summaryDef(r.label) || ""} /> : null}
                </span>
              </td>
              {r.c ? <HcFte c={r.c} /> : <><td></td><td></td></>}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function HistoricalTab({ data }: { data: CensusSnapshot }) {
  const years = data.historical.years;
  const lines: { label: string; key?: string; indent?: boolean }[] = [
    { label: "Degree-Seeking" },
    { label: "Undergraduate, New Students Admitted", key: "newStudents" },
    { label: "FTCA", key: "ftca", indent: true },
    { label: "TRAN", key: "tran", indent: true },
    { label: "READ", key: "read", indent: true },
    { label: "SECB", key: "secb", indent: true },
    { label: "Lux Mundi", key: "luxMundiUg", indent: true },
    { label: "Returning Students", key: "returning" },
    { label: "Ireland", key: "ireland", indent: true },
    { label: "On Campus", key: "onCampus", indent: true },
    { label: "Mont Mallary", key: "montMallary", indent: true },
    { label: "Total Degree-Seeking", key: "degreeSeeking" },
    { label: "High School Dual Enrollment", key: "dualEnrollment" },
    { label: "Chesterton DE", key: "chestertonDual", indent: true },
    { label: "Chesterton", key: "chesterton", indent: true },
    { label: "Non-Degree-Seeking / Personal Enrichment", key: "nonDegree" },
    { label: "TOTAL UNDERGRADUATE ENROLLMENT", key: "totalUndergraduate" },
    { label: "Graduate MA Students", key: "gradMa" },
    { label: "Graduate PhD Students", key: "gradPhd" },
    { label: "Graduate MBA Students", key: "gradMba" },
    { label: "Graduate MEdCl", key: "gradMedcl" },
    { label: "Graduate MA Theo (Online) - Lux Mundi", key: "luxMundiGrad" },
    { label: "TOTAL GRADUATE ENROLLMENT", key: "totalGraduate" },
    { label: "Graduate & Undergraduate Enrollment", key: "totalEnrollment" },
  ];
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Historical</h2>
        <p className="sheet-n">Fall census history (Fall 2026 is live / draft). Prior years are not filtered.</p>
      </div>
      <div className="sheet-table">
      <table>
        <thead>
          <tr>
            <th rowSpan={2}></th>
            {years.map((y) => (
              <th key={y} className="num" colSpan={2}>
                Fall {y}
              </th>
            ))}
          </tr>
          <tr>
            {years.map((y) => (
              <Fragment key={y}>
                <th className="num">HEADCOUNT</th>
                <th className="num">FTE</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const series = line.key ? historicalSeries(data.historical, line.key) : { hc: [], fte: [] };
            const hc = series.hc || [];
            const fte = series.fte || [];
            return (
              <tr
                key={line.label}
                className={
                  line.label.startsWith("TOTAL") || line.label.startsWith("Total") || line.label.startsWith("Graduate &")
                    ? "total"
                    : line.indent
                      ? "indent"
                      : ""
                }
              >
                <td>{line.label}</td>
                {years.map((_, i) => (
                  <Fragment key={i}>
                    <td className="num">{!line.key || hc[i] == null ? (line.key ? "—" : "") : fmtN(hc[i])}</td>
                    <td className="num">{!line.key || fte[i] == null ? (line.key ? "—" : "") : fmtFte(fte[i])}</td>
                  </Fragment>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function AttritionTab({
  data,
  unretained,
}: {
  data: CensusSnapshot;
  unretained?: { n: number; ug: number };
}) {
  const a = data.ftcaAttrition;
  const u = data.allUgRetention;
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Retention</h2>
        <p className="sheet-n">Fall 2025 Incoming + FTCA only. Athletic retention is on the Census Report sheet. Filters at the top apply here too.</p>
      </div>
      {unretained && unretained.n > 0 && (
        <div className="card section">
          <h3>All not retained</h3>
          <table>
            <tbody>
              <tr>
                <td>Fall 2025 census students not registered Fall 2026 and not 2025–26 graduates</td>
                <td className="num">{fmtN(unretained.n)}</td>
              </tr>
              <tr className="total">
                <td>Of those, undergraduate degree-seeking</td>
                <td className="num">{fmtN(unretained.ug)}</td>
              </tr>
            </tbody>
          </table>
          <p className="note">
            Registration Status is the all-student count for this term. Names are on the
            All Not Retained sheet of the Excel draft.
          </p>
        </div>
      )}
      <div className="grid-2 section">
        <div className="card">
          <h3>FA25 FTCA cohort retention</h3>
          <table>
            <tbody>
              <tr>
                <td>Fall 2025 FTCA cohort</td>
                <td className="num">{fmtN(a.cohort)}</td>
              </tr>
              <tr>
                <td>Enrolled Fall 2026</td>
                <td className="num">{fmtN(a.enrolledThisFall)}</td>
              </tr>
              <tr>
                <td>Not retained</td>
                <td className="num">{fmtN(a.notRetained)}</td>
              </tr>
              <tr className="total">
                <td>Retention rate F25–F26</td>
                <td className="num">{fmtPct(a.retentionRate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>All UG retention (minus graduates)</h3>
          <table>
            <tbody>
              <tr>
                <td>Fall 2025 degree-seeking UG</td>
                <td className="num">{fmtN(u.priorUg)}</td>
              </tr>
              <tr>
                <td>Fall / Spring / Summer graduates</td>
                <td className="num">{fmtN(u.graduates)}</td>
              </tr>
              <tr>
                <td>Retention pool</td>
                <td className="num">{fmtN(u.pool)}</td>
              </tr>
              <tr>
                <td>Enrolled Fall 2026</td>
                <td className="num">{fmtN(u.enrolledThisFall)}</td>
              </tr>
              <tr className="total">
                <td>All-UG retention F25–F26</td>
                <td className="num">{fmtPct(u.retentionRate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-2 section">
        <div className="card">
          <h3>Historical FTCA retention</h3>
          <table>
            <tbody>
              {data.historicalFtcaRetention.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{fmtPct(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Historical all-UG retention</h3>
          <table>
            <tbody>
              {data.historicalAllUgRetention.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{fmtPct(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-2 section">
        <AttritionTable title="FTCA by state" rows={a.byState} />
        <AttritionTable title="FTCA by sport" rows={a.bySport} />
      </div>
      <div className="grid-2 section">
        <AttritionTable title="FTCA athlete / non-athlete" rows={a.byAthlete} />
        <AttritionTable title="FTCA by AMU GPA" rows={a.byGpa} />
      </div>
      <div className="grid-2 section">
        <AttritionTable title="FTCA by ethnicity" rows={a.byEthnicity} />
        <AttritionTable title="FTCA Catholic / athlete" rows={a.byCatholicAthlete} />
      </div>
    </div>
  );
}

function AttritionTable({
  title,
  rows,
}: {
  title: string;
  rows: CensusSnapshot["ftcaAttrition"]["byState"];
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th></th>
            <th className="num">Students</th>
            <th className="num">Not retained</th>
            <th className="num">% retained</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{fmtN(r.students)}</td>
              <td className="num">{fmtN(r.notRetained)}</td>
              <td className="num">{fmtPct(r.retainedPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
