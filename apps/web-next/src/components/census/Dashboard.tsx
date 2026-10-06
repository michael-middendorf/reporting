"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { CensusReport } from "@/components/census/CensusReport";
import { FtcaRawSheet, LoaSheet, RawDataSheet, UnretainedSheet } from "@/components/census/CensusLists";
import { FilterBar, SheetTable, fmtN, fmtPct } from "@/components/census/Sheet";
import type { CensusRawStudent, LoaWithStatus, UnretainedStudent } from "@/lib/reports/census/lists-core";
import { isUgDegreeSeekingRow } from "@/lib/reports/census/lists-core";
import {
  DEFAULT_FILTERS,
  buildReport,
  buildReportExtras,
  describeFilters,
  filterCensusRaw,
  filtersForCensusRaw,
  filterStudents,
  filterLoa,
  filterUnretained,
  projectUnretained,
  uniqueSorted,
  type ListExportKind,
  type ReportFilters,
  type ReportStudent,
} from "@/lib/reports/census/report";
import {
  applyLiveRetentionHistory,
  buildAllUgSplit,
  buildFtcaAttritionFromPrior,
  buildFtcaExtras,
  collectGpa,
  isCatholic,
  type CrosstabRow,
  type FtcaExtras,
  type FtcaRawRow,
} from "@/lib/reports/census/retention";
import {
  KPI_DEFS,
  SUMMARY_DEFS,
  amuUndergraduateAlumniIds,
  buildGraduateEnrollment,
  meanPositive,
  summaryFromStudents,
  uniqueStudentCount,
  type GraduateProgramStats,
} from "@/lib/reports/census/from-lists";
import type { AttritionRow } from "@/lib/reports/census/types";
import type { HousingAssignmentRow } from "@/lib/reports/census/residency";
import {
  degreeSeekingHcLabel,
  historicalSeries,
  HISTORICAL_ROWS,
  type CensusSnapshot,
  type CountFte,
} from "@/lib/reports/census/types";
import "@/styles/census.css";

function fmtFte(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

type Tab = "summary" | "historical" | "ug" | "grad" | "attrition" | "ftca" | "raw" | "unretained" | "loa";

type CensusPageData = CensusSnapshot & {
  reportStudents?: ReportStudent[];
  rawStudents?: CensusRawStudent[];
  unretainedStudents?: UnretainedStudent[];
  loaFallStudents?: LoaWithStatus[];
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

  async function downloadExport(kind: "draft" | ListExportKind) {
    setExportError(null);
    setDownloading(true);
    try {
      const res =
        kind === "draft"
          ? await apiFetch("/api/census-export")
          : await apiFetch("/api/census-export", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind, filters }),
            });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || res.statusText || "Export failed");
      }
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || "FA26_Census_export.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      document.querySelector(".census-root .export-menu")?.removeAttribute("open");
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
  const unretainedProjected = useMemo(
    () => projectUnretained(data?.unretainedStudents || []),
    [data?.unretainedStudents],
  );
  const sports = useMemo(
    () => uniqueSorted([...students, ...unretainedProjected], (s) => s.sport),
    [students, unretainedProjected],
  );
  const majors = useMemo(
    () => uniqueSorted(students.filter((s) => s.program === "UNDERG"), (s) => s.major),
    [students],
  );
  const religions = useMemo(
    () =>
      uniqueSorted([...students, ...unretainedProjected], (s) => s.religion).filter((r) => r && r !== "-"),
    [students, unretainedProjected],
  );
  const peopleFilters = useMemo(() => filtersForCensusRaw(filters), [filters]);
  const filteredAll = useMemo(() => filterCensusRaw(rawStudents, peopleFilters), [rawStudents, peopleFilters]);
  const filteredRaw = useMemo(() => filterCensusRaw(rawStudents, filters), [rawStudents, filters]);
  const reportUniverse = filters.retention === "unretained" ? unretainedProjected : students;
  const filteredReport = useMemo(() => filterStudents(reportUniverse, filters), [reportUniverse, filters]);
  const filteredUnretained = useMemo(
    () => filterUnretained(data?.unretainedStudents || [], filters),
    [data?.unretainedStudents, filters],
  );
  const filteredLoaFall = useMemo(
    () => filterLoa(data?.loaFallStudents || [], filters),
    [data?.loaFallStudents, filters],
  );
  const filteredPrior = useMemo(
    () => filterCensusRaw(data?.priorStudents || [], filters),
    [data?.priorStudents, filters],
  );
  const filteredFtca = useMemo(() => {
    const keep = new Set(filteredPrior.map((s) => s.pcid.toUpperCase()));
    return (data?.ftcaRaw || []).filter((r) => keep.has((r.pcid || "").toUpperCase()));
  }, [data?.ftcaRaw, filteredPrior]);
  const gpaById = useMemo(
    () =>
      collectGpa({
        students: rawStudents,
        unretained: data?.unretainedStudents || [],
        prior: data?.priorStudents || [],
        graduates: data?.graduates || [],
        loa: [],
        loaFall: data?.loaFallStudents || [],
      }),
    [rawStudents, data?.unretainedStudents, data?.priorStudents, data?.graduates, data?.loaFallStudents],
  );
  const extras = useMemo(
    () =>
      buildReportExtras(
        filteredPrior,
        filteredRaw.map((s) => s.pcid),
        data?.graduates || [],
        gpaById,
        data?.allUgRetention || {
          priorUg: 0,
          graduates: 0,
          pool: 0,
          enrolledThisFall: 0,
          notRetained: 0,
          retentionRate: 0,
        },
        filters.excludedSports,
      ),
    [filteredPrior, filteredRaw, data?.graduates, gpaById, data?.allUgRetention, filters.excludedSports],
  );
  const ftcaExtras = useMemo(
    () =>
      filteredPrior.length
        ? buildFtcaExtras(filteredPrior, filteredRaw.map((s) => s.pcid), data?.graduates || [])
        : null,
    [filteredPrior, filteredRaw, data?.graduates],
  );
  const alumniIds = useMemo(
    () => amuUndergraduateAlumniIds(data?.priorStudents || [], data?.graduates || []),
    [data?.priorStudents, data?.graduates],
  );
  const gradBlocks = useMemo(
    () => buildGraduateEnrollment(filteredAll, data?.priorStudents || [], data?.graduates || []),
    [filteredAll, data?.priorStudents, data?.graduates],
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
  const ugds = filteredAll.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend, s.degree));
  const k = {
    ...data.kpis,
    allStudents: rawStudents.length ? uniqueStudentCount(filteredAll) : data.kpis.allStudents,
    ugStudents: liveSummary?.degreeSeeking.headcount ?? data.kpis.ugStudents,
    pctCatholic: ugds.length
      ? ugds.filter(isCatholic).length / ugds.length
      : data.kpis.pctCatholic,
    ugOnCampusPct: tables
      ? (tables.residency.find((r) => r.label === "On Campus" || r.label === "Resident")?.n ?? 0) / (tables.n || 1)
      : data.kpis.ugOnCampusPct,
    incomingHsGpa: rawStudents.length
      ? meanPositive(
          ugds.filter((s) => (s.incomingReturning || "").toLowerCase().startsWith("incoming")),
          (s) => s.hsGpa,
          2,
        )
      : data.kpis.incomingHsGpa,
    avgAct: rawStudents.length
      ? meanPositive(
          ugds.filter((s) => (s.incomingReturning || "").toLowerCase().startsWith("incoming")),
          (s) => s.act,
          1,
        )
      : data.kpis.avgAct,
    avgSat: rawStudents.length
      ? meanPositive(
          ugds.filter((s) => (s.incomingReturning || "").toLowerCase().startsWith("incoming")),
          (s) => s.sat,
          0,
          5,
          400,
        )
      : data.kpis.avgSat,
    avgClt: rawStudents.length
      ? meanPositive(
          ugds.filter((s) => (s.incomingReturning || "").toLowerCase().startsWith("incoming")),
          (s) => s.clt,
          1,
        )
      : data.kpis.avgClt,
  };
  const liveFtcaRate = liveFtca?.retentionRate ?? data.ftcaAttrition.retentionRate;
  const liveUgRate = liveAllUg?.retentionRate ?? data.allUgRetention.retentionRate;
  const summaryData = applyLiveRetentionHistory(
    {
      ...data,
      summary: liveSummary || data.summary,
      ftcaAttrition: liveFtca || data.ftcaAttrition,
      allUgRetention: liveAllUg || data.allUgRetention,
    },
    liveFtcaRate,
    liveUgRate,
  );
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
            <details className="export-menu">
              <summary className="download" aria-disabled={downloading}>
                {downloading ? "Building Excel…" : "Export"}
              </summary>
              <div className="export-menu-body">
                <button type="button" disabled={downloading} onClick={() => downloadExport("draft")}>
                  Full census draft
                </button>
                <button type="button" disabled={downloading} onClick={() => downloadExport("filtered")}>
                  All filtered lists
                  <span>{describeFilters(filters)}</span>
                </button>
                <button type="button" disabled={downloading} onClick={() => downloadExport("unretained")}>
                  Unretained
                </button>
                <button type="button" disabled={downloading} onClick={() => downloadExport("loa")}>
                  LOA
                </button>
                <button type="button" disabled={downloading} onClick={() => downloadExport("sports")}>
                  Sports
                </button>
                <button type="button" disabled={downloading} onClick={() => downloadExport("raw")}>
                  Census Raw
                </button>
                <button type="button" disabled={downloading} onClick={() => downloadExport("ftca")}>
                  FTCA Raw
                </button>
              </div>
            </details>
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
          <Kpi label="All students" value={fmtN(k.allStudents)} def={KPI_DEFS.allStudents} />
          <Kpi label="UG degree-seeking" value={fmtN(k.ugStudents)} def={KPI_DEFS.ugStudents} />
          <Kpi
            label="Mount Melleray Abbey"
            value={fmtN(liveSummary?.ireland.headcount ?? data.summary.ireland.headcount)}
            def={KPI_DEFS.ireland}
          />
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
          <Kpi label="% Catholic" value={fmtPct(k.pctCatholic)} def={KPI_DEFS.pctCatholic} />
          <Kpi
            label="Avg CLT / ACT / SAT"
            value={`${k.avgClt ?? "—"}  /  ${k.avgAct ?? "—"}  /  ${k.avgSat ?? "—"}`}
            def={KPI_DEFS.testScores}
            flip
          />
        </div>

        <FilterBar filters={filters} onChange={setFilters} sports={sports} majors={majors} religions={religions} />
        {filters.retention === "unretained" && (
          <p className="filter-note">
            Unretained is on. Census Report, All Not Retained, and exports use FA25 students who did not return.
            Summary and Census Raw stay Fall 2026 enrolled.
          </p>
        )}

        <div className="tabs">
          {(
            [
              ["summary", "Summary"],
              ["historical", "Historical"],
              ["ug", "Census Report"],
              ["grad", "Graduate"],
              ["attrition", "Retention"],
              ["ftca", "FTCA Raw"],
              ["raw", "Census Raw"],
              ["unretained", "All Not Retained"],
              ["loa", "FA26 LOA"],
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
        {tab === "historical" && <HistoricalTab data={summaryData} />}
        {tab === "ug" && (
          <CensusReport
            data={summaryData}
            extras={extras}
            students={filteredReport}
            filters={filters}
          />
        )}
        {tab === "grad" && <GraduateTab year={data.historical.years[0] ?? 2026} blocks={gradBlocks} />}
        {tab === "attrition" && (
          <AttritionTab
            data={summaryData}
            extras={ftcaExtras}
            unretained={{
              n: filteredUnretained.length,
              ug: filteredUnretained.filter((s) => isUgDegreeSeekingRow(s.program || "", s.collegeAttend)).length,
            }}
          />
        )}
        {tab === "ftca" && <FtcaRawSheet rows={filteredFtca} />}
        {tab === "raw" && <RawDataSheet students={filteredAll} alumniIds={alumniIds} />}
        {tab === "unretained" && <UnretainedSheet students={filteredUnretained} />}
        {tab === "loa" && (
          <LoaSheet
            rows={filteredLoaFall}
            title="Fall 2026 Leave of Absence"
            note="Leave of absence from the unretained notes (intend to return). In the FA25 roster and counted as retained. Not on All Not Retained. Only Aiden Wilson and Hannah Nelson are out of the denominator."
            classHeader="FA25 class"
            sportHeader="FA25 sport"
          />
        )}
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
    { label: "Other", c: s.newOther, indent: true },
    { label: "Lux Mundi", c: s.luxMundiUg, indent: true },
    { label: "Returning Students", c: s.returning },
    { label: "Residency", section: true },
    { label: "On Campus", c: s.onCampus ?? { headcount: 0, fte: 0 }, indent: true },
    { label: "Mount Melleray Abbey", c: s.ireland, indent: true },
    { label: "Rome", c: s.rome ?? { headcount: 0, fte: 0 }, indent: true },
    { label: "Commuter", c: s.commuter ?? { headcount: 0, fte: 0 }, indent: true },
    { label: "Total Degree-Seeking", c: s.degreeSeeking },
    { label: "On-campus dual enrollment", c: s.dualEnrollment },
    { label: "Online dual enrollment", c: s.chestertonDual },
    { label: "Non-Degree-Seeking / Personal Enrichment", c: s.nonDegree },
    { label: "Lux Mundi Non-Degree-Seeking / Personal Enrichment", c: s.luxMundiNonDegree },
    { label: "TOTAL UNDERGRADUATE ENROLLMENT", c: s.totalUndergraduate },
    { label: "MA Philosophy", c: s.gradMaPhil },
    { label: "MA Theology on-campus", c: s.gradMa },
    { label: "PhD Theology", c: s.gradPhd },
    { label: "MBA", c: s.gradMba },
    { label: "M. Education", c: s.gradMedcl },
    { label: "MA CRW", c: s.gradMaCrw },
    { label: "MA Theology online", c: s.luxMundiGrad },
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
  const lines = HISTORICAL_ROWS.filter((line) => line.label || line.key);
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
                {years.map((_, i) => {
                  const hcVal =
                    line.key === "degreeSeeking"
                      ? degreeSeekingHcLabel(hc[i], series.fullTime?.[i])
                      : hc[i];
                  return (
                    <Fragment key={i}>
                      <td className="num">
                        {!line.key || hcVal === "" || hcVal == null ? (line.key ? "—" : "") : typeof hcVal === "number" ? fmtN(hcVal) : hcVal}
                      </td>
                      <td className="num">{!line.key || fte[i] == null ? (line.key ? "—" : "") : fmtFte(fte[i])}</td>
                    </Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function attritionNeeds(cols: number): (string | number)[][] {
  return [Array.from({ length: cols }, (_, i) => (i === 0 ? "Needs data" : ""))];
}

function attritionBody(
  rows: AttritionRow[],
  rate: number,
  cols: "full" | "short" | "gpa" | "sport",
): (string | number)[][] {
  if (!rows.length) {
    return attritionNeeds(cols === "full" || cols === "sport" ? 5 : 4);
  }
  const students = rows.reduce((s, r) => s + r.students, 0);
  const notRetained = rows.reduce((s, r) => s + r.notRetained, 0);
  if (cols === "full") {
    return [
      ...rows.map((r) => [r.label, fmtN(r.students), fmtN(r.notRetained), fmtPct(r.retainedPct), fmtPct(r.shareOfNotRetained)]),
      ["Total", fmtN(students), fmtN(notRetained), fmtPct(rate), students ? "100.0%" : ""],
    ];
  }
  if (cols === "sport") {
    return [
      ...rows.map((r) => [r.label, fmtN(r.students), fmtN(r.notRetained), fmtPct(r.shareOfNotRetained), fmtPct(r.retainedPct)]),
      ["Total", fmtN(students), fmtN(notRetained), "", fmtPct(rate)],
    ];
  }
  return [
    ...rows.map((r) => [r.label, fmtN(r.students), fmtN(r.notRetained), fmtPct(r.retainedPct)]),
    ["Total", fmtN(students), fmtN(notRetained), fmtPct(rate)],
  ];
}

function subsetRate(rows: AttritionRow[]): number {
  const students = rows.reduce((s, r) => s + r.students, 0);
  const notRetained = rows.reduce((s, r) => s + r.notRetained, 0);
  const graduated = rows.reduce((s, r) => s + (r.graduated ?? 0), 0);
  const pool = students - graduated;
  return pool > 0 ? (pool - notRetained) / pool : 0;
}

function crosstabBody(
  rows: CrosstabRow[],
  twoLabels = false,
  includeInTotal?: (r: CrosstabRow) => boolean,
): (string | number)[][] {
  if (!rows.length) return attritionNeeds(twoLabels ? 5 : 4);
  const body: (string | number)[][] = twoLabels
    ? rows.map((r) => [r.label, r.label2 || "", fmtN(r.students), fmtN(r.notRetained), r.retentionPct == null ? "—" : fmtPct(r.retentionPct)])
    : rows.map((r) => [r.label, fmtN(r.students), fmtN(r.notRetained), r.retentionPct == null ? "—" : fmtPct(r.retentionPct)]);
  const summed = includeInTotal ? rows.filter(includeInTotal) : rows;
  const students = summed.reduce((s, r) => s + r.students, 0);
  const notRetained = summed.reduce((s, r) => s + r.notRetained, 0);
  const graduated = summed.reduce((s, r) => s + r.graduated, 0);
  const pool = students - graduated;
  const rate = pool > 0 ? (pool - notRetained) / pool : null;
  if (twoLabels) body.push(["Total", "", fmtN(students), fmtN(notRetained), rate == null ? "—" : fmtPct(rate)]);
  else body.push(["Total", fmtN(students), fmtN(notRetained), rate == null ? "—" : fmtPct(rate)]);
  return body;
}

function GraduateTab({ year, blocks }: { year: number; blocks: GraduateProgramStats[] }) {
  const fa = `FA${String(year).slice(2)}`;
  const overall = blocks.find((b) => b.program === "Overall");
  const programs = blocks.filter((b) => b.program !== "Overall");
  const rows = [
    ...programs.map((b) => [
      b.program,
      fmtN(b.n),
      fmtN(b.incoming),
      fmtN(b.returning),
      fmtN(b.alumniAdmits),
      fmtN(b.externalAdmits),
      fmtN(b.amuAlumni),
      fmtN(b.athlete),
      fmtN(b.nonAthlete),
      fmtN(b.catholic),
      fmtN(b.nonCatholic),
    ]),
    ...(overall
      ? [[
          "Total",
          fmtN(overall.n),
          fmtN(overall.incoming),
          fmtN(overall.returning),
          fmtN(overall.alumniAdmits),
          fmtN(overall.externalAdmits),
          fmtN(overall.amuAlumni),
          fmtN(overall.athlete),
          fmtN(overall.nonAthlete),
          fmtN(overall.catholic),
          fmtN(overall.nonCatholic),
        ]]
      : []),
  ];
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>{fa} Graduate Enrollment Statistics</h2>
        <p className="sheet-n">{fmtN(overall?.n ?? 0)} graduate students</p>
      </div>
      <p className="note">
        Alumni admits / External admits are incoming only. AMU Alumni includes returning students with an AMU bachelor&apos;s.
        Athlete includes Post Grad roster and Associated.
      </p>
      <SheetTable
        title=""
        headers={[
          "Program",
          "Students",
          "Incoming",
          "Returning",
          "Alumni admits",
          "External admits",
          "AMU Alumni",
          "Athlete",
          "Non-Athlete",
          "Catholic",
          "Non-Catholic",
        ]}
        rows={rows.length ? rows : attritionNeeds(11)}
      />
    </div>
  );
}

function AttritionTab({
  data,
  extras,
  unretained,
}: {
  data: CensusSnapshot;
  extras: FtcaExtras | null;
  unretained?: { n: number; ug: number };
}) {
  const a = data.ftcaAttrition;
  const u = data.allUgRetention;
  const x = extras;
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Fall 2025 Incoming FTCA Cohort Attrition</h2>
        <p className="sheet-n">
          Fall 2025 Incoming + FTCA only. Athletic retention is on the Census Report sheet. Filters at the top apply here too.
        </p>
      </div>
      {unretained && unretained.n > 0 && (
        <p className="note">
          All not retained: {fmtN(unretained.n)} Fall 2025 census students not registered Fall 2026 and not 2025–26
          graduates ({fmtN(unretained.ug)} undergraduate degree-seeking). Names are on All Not Retained.
        </p>
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
          <p className="note">
            Fall 2025 UG includes Fall 2026 leave of absence, counted as retained. Only Aiden Wilson
            (dropped after census) and Hannah Nelson (deceased) are out of this total.
          </p>
        </div>
      </div>
      <div className="sheet-grid">
        <div className="sheet-col">
          <SheetTable
            title="States"
            headers={["States", "Students", "# Non-Retained", "% Retained", "% of All Non-Retained"]}
            rows={attritionBody(a.byState, a.retentionRate, "full")}
          />
          <SheetTable
            title="Male - Florida"
            headers={["Catholic/Non-Catholic", "Athlete/Non-Athlete", "Students", "# Non-Retained", "% Retained"]}
            rows={crosstabBody(x?.byMaleFlorida || [], true)}
            labelCols={2}
          />
        </div>
        <div className="sheet-col">
          <SheetTable
            title="Athlete"
            headers={["Athlete", "Students", "# Non-Retained", "% Retained"]}
            rows={attritionBody(a.byAthlete, a.retentionRate, "short")}
          />
          <SheetTable
            title="Sport Primary"
            headers={["Sport Primary", "Students", "Non-Retained", "% of All Non-Retained", "% Retained"]}
            rows={attritionBody(a.bySport, a.retentionRate, "sport")}
          />
          <SheetTable
            title="Catholic/Non-Catholic"
            headers={["Catholic/Non-Catholic", "Athlete/Non-Athlete", "Students", "# Non-Retained", "% Retained"]}
            rows={
              a.byCatholicAthlete.length
                ? crosstabBody(
                    a.byCatholicAthlete.map((r) => {
                      const [cath, ath] = r.label.split(" / ");
                      return {
                        label: cath || r.label,
                        label2: ath || "",
                        students: r.students,
                        notRetained: r.notRetained,
                        graduated: 0,
                        retentionPct: r.retainedPct ?? null,
                      };
                    }),
                    true,
                  )
                : attritionNeeds(5)
            }
            labelCols={2}
          />
          <SheetTable
            title="Athlete"
            headers={["Athlete", "Gender", "Students", "# Non-Retained", "% Retained"]}
            rows={crosstabBody(x?.byAthleteGender || [], true)}
            labelCols={2}
          />
          <SheetTable
            title="Ethnicity"
            headers={["Ethnicity", "Athlete/Non-Athlete", "Students", "# Non-Retained", "% Retained"]}
            rows={crosstabBody(x?.byEthnicityAthlete || [], true)}
            labelCols={2}
          />
        </div>
        <div className="sheet-col">
          <SheetTable
            title="Ethnicity"
            headers={["Ethnicity", "Students", "# Non-Retained", "% Retained"]}
            rows={attritionBody(a.byEthnicity, a.retentionRate, "short")}
          />
          <SheetTable
            title="Resident / Commuter"
            headers={["Resident / Commuter", "Gender", "Students", "# Non-Retained", "% Retained"]}
            rows={crosstabBody(x?.byResidencyGender || [], true)}
            labelCols={2}
          />
          <SheetTable
            title="HS GPA Ranges"
            headers={["HS GPA Ranges", "Students", "# Non-Retained", "% Retained"]}
            rows={
              x && x.byHsGpa.some((r) => r.label !== "No HS GPA")
                ? attritionBody(
                    x.byHsGpa.filter((r) => r.label !== "No HS GPA" || r.students > 0),
                    a.retentionRate,
                    "gpa",
                  )
                : attritionNeeds(4)
            }
          />
          <SheetTable
            title="Application Decision"
            headers={["Application Decision", "Students", "# Non-Retained", "% Retained"]}
            rows={x?.byAppDecision.length ? crosstabBody(x.byAppDecision) : attritionNeeds(4)}
          />
          <SheetTable
            title="Committee admits and admin overrides"
            headers={["Admit type", "Type", "Students", "# Non-Retained", "Retention %"]}
            rows={x?.admitOverride.length ? crosstabBody(x.admitOverride, true, (r) => r.label2 === "Overall") : attritionNeeds(5)}
            labelCols={2}
          />
          <SheetTable
            title="Test Score"
            headers={["Test Score", "Students", "# Non-Retained", "% Retained"]}
            rows={x?.byTestScore.length ? attritionBody(x.byTestScore, a.retentionRate, "gpa") : attritionNeeds(4)}
          />
          <SheetTable
            title="Has Test Score"
            headers={["Athlete / Non-Athlete", "Students", "# Non-Retained", "% Retained"]}
            rows={
              x?.byHasTestScoreAthlete.length
                ? attritionBody(x.byHasTestScoreAthlete, subsetRate(x.byHasTestScoreAthlete), "gpa")
                : attritionNeeds(4)
            }
          />
          <SheetTable
            title="No Test Score"
            headers={["Athlete / Non-Athlete", "Students", "# Non-Retained", "% Retained"]}
            rows={
              x?.byNoTestScoreAthlete.length
                ? attritionBody(x.byNoTestScoreAthlete, subsetRate(x.byNoTestScoreAthlete), "gpa")
                : attritionNeeds(4)
            }
          />
          <SheetTable
            title="ACT Converted"
            headers={["ACT Converted", "Students", "# Non-Retained", "% Retained"]}
            rows={x?.byActConverted.length ? attritionBody(x.byActConverted, a.retentionRate, "gpa") : attritionNeeds(4)}
            note="*Has / No test score = SAT or ACT (converted). CLT-only is No."
          />
        </div>
        <div className="sheet-col">
          <SheetTable
            title="AMU GPA Ranges"
            headers={["AMU GPA Ranges", "Students", "# Non-Retained", "% Retained"]}
            rows={attritionBody(a.byGpa, a.retentionRate, "gpa")}
          />
          <SheetTable
            title="HS GPA Ranges (Athletes)"
            headers={["HS GPA Ranges", "Students", "# Non-Retained", "% Retained"]}
            rows={
              x && x.byHsGpaAthletes.some((r) => r.label !== "No HS GPA")
                ? attritionBody(
                    x.byHsGpaAthletes.filter((r) => r.label !== "No HS GPA" || r.students > 0),
                    subsetRate(x.byHsGpaAthletes),
                    "gpa",
                  )
                : attritionNeeds(4)
            }
          />
          <SheetTable
            title="HS GPA 2.9-3.49"
            headers={["HS GPA Ranges", "Students", "# Non-Retained", "% Retained"]}
            rows={x?.byHsGpaFine.length ? attritionBody(x.byHsGpaFine, subsetRate(x.byHsGpaFine), "gpa") : attritionNeeds(4)}
          />
          <SheetTable
            title="HS GPA 2.9-3.49 Athletes"
            headers={["HS GPA Ranges", "Students", "# Non-Retained", "% Retained"]}
            rows={
              x?.byHsGpaFineAthletes.length
                ? attritionBody(x.byHsGpaFineAthletes, subsetRate(x.byHsGpaFineAthletes), "gpa")
                : attritionNeeds(4)
            }
          />
          <SheetTable
            title="Honors College"
            headers={["Honors College", "Students", "# Non-Retained", "% Retained"]}
            rows={x?.byHonors.length ? attritionBody(x.byHonors, a.retentionRate, "gpa") : attritionNeeds(4)}
          />
          <SheetTable
            title="FSP"
            headers={["FSP", "Students", "# Non-Retained", "% Retained"]}
            rows={x?.byFsp.length ? attritionBody(x.byFsp, a.retentionRate, "gpa") : attritionNeeds(4)}
          />
          <SheetTable
            title="Institute"
            headers={["Institute", "Students", "# Non-Retained", "% Retained"]}
            rows={x?.byInstitute.length ? attritionBody(x.byInstitute, a.retentionRate, "gpa") : attritionNeeds(4)}
          />
        </div>
      </div>
    </div>
  );
}
