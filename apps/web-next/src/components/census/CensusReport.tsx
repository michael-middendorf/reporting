"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_FILTERS,
  DEGREE_OPTIONS,
  buildReport,
  filterStudents,
  filtersActive,
  uniqueSorted,
  type ReportFilters,
  type ReportStudent,
  type ReportTables,
} from "@/lib/reports/census/report";
import type { CensusSnapshot, LabeledCount } from "@/lib/reports/census/types";

function fmtN(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}
function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function SheetTable({
  title,
  headers,
  rows,
  note,
}: {
  title: string;
  headers: string[];
  rows: (string | number)[][];
  note?: string;
}) {
  return (
    <div className="sheet-table">
      <div className="sheet-caption">{title}</div>
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className={h !== headers[0] ? "num" : ""}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row[0] === "Total" ? "total" : ""}>
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? "" : "num"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="note">{note}</p>}
    </div>
  );
}

function countRows(rows: LabeledCount[], pctDigits = 1): (string | number)[][] {
  const total = rows.reduce((s, r) => s + r.n, 0);
  return [
    ...rows.map((r) => [r.label, fmtN(r.n), fmtPct(r.pct ?? (total ? r.n / total : 0), pctDigits)]),
    ["Total", fmtN(total), ""],
  ];
}

function MultiFilter({
  label,
  options,
  selected,
  onChange,
  emptyLabel,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}) {
  const set = new Set(selected);
  return (
    <details className="filter-menu">
      <summary>
        {label}
        {selected.length ? ` (${selected.length})` : ""}
      </summary>
      <div className="filter-menu-body">
        <button type="button" className="filter-link" onClick={() => onChange([])}>
          {emptyLabel}
        </button>
        {options.map((opt) => (
          <label key={opt}>
            <input
              type="checkbox"
              checked={set.has(opt)}
              onChange={() => {
                const next = new Set(set);
                if (next.has(opt)) next.delete(opt);
                else next.add(opt);
                onChange([...next].sort((a, b) => a.localeCompare(b)));
              }}
            />
            {opt}
          </label>
        ))}
      </div>
    </details>
  );
}

export function CensusReport({
  data,
  students,
}: {
  data: CensusSnapshot;
  students: ReportStudent[];
}) {
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const sports = useMemo(() => uniqueSorted(students, (s) => s.sport), [students]);
  const majors = useMemo(() => uniqueSorted(students.filter((s) => s.program === "UNDERG"), (s) => s.major), [students]);

  const filtered = useMemo(() => filterStudents(students, filters), [students, filters]);
  const live = useMemo(() => (students.length ? buildReport(filtered) : null), [students, filtered]);
  const tables: ReportTables | null = live;
  const u = data.ug;
  const n = tables?.n ?? u.n;
  const universe = students.length
    ? filterStudents(students, { ...DEFAULT_FILTERS, degree: filters.degree }).length
    : u.n;

  const active = filtersActive(filters);

  function set<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const title =
    filters.degree === "grad"
      ? `${data.term} Census Report — Graduate Statistics`
      : filters.degree === "all"
        ? `${data.term} Census Report — All Students`
        : `${data.term} Census Report — Undergraduate Statistics`;

  const states = tables?.states ?? u.states;
  const countries = tables?.countries ?? u.countries;
  const gender = tables?.gender ?? u.gender;
  const religion = tables?.religion ?? u.religion;
  const athlete = tables?.athlete ?? u.athlete;
  const incomingAthlete = tables?.incomingAthlete ?? u.incomingAthlete;
  const classLevel = tables?.classLevel ?? u.classLevel;
  const sportsRows = tables?.sports ?? u.sports;
  const residency = tables?.residency ?? u.residency;
  const honorsByClass = tables?.honorsByClass ?? u.honorsByClass;
  const honorsN = tables?.honorsN ?? u.honorsN;
  const athleticReligion = tables?.athleticReligion ?? u.athleticReligion;
  const floridaAthlete = tables?.floridaAthlete ?? u.floridaAthlete;
  const floridaCatholic = tables?.floridaCatholic ?? u.floridaCatholic;
  const nonFl = tables?.nonFloridaCatholicAthlete ?? u.nonFloridaCatholicAthlete;
  const genderLoad = tables?.genderLoad ?? u.genderLoad;
  const majorRows = tables?.majors ?? u.majors;
  const appDecisions = tables?.appDecisions ?? [];
  const majorTotal = majorRows.reduce((s, m) => s + m.total, 0);
  const a = data.ftcaAttrition;
  const ret = data.allUgRetention;
  const fa = `FA${String(data.historical.years[0] ?? 2026).slice(2)}`;
  const loadTotal = {
    full: genderLoad.reduce((s, g) => s + g.full, 0),
    half: genderLoad.reduce((s, g) => s + g.half, 0),
    less: genderLoad.reduce((s, g) => s + g.less, 0),
    other: genderLoad.reduce((s, g) => s + g.other, 0),
    total: genderLoad.reduce((s, g) => s + g.total, 0),
  };

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>{title}</h2>
        <p className="sheet-n">
          {fmtN(n)} students
          {universe !== n ? ` of ${fmtN(universe)} in this degree group` : ""}
          {students.length ? "" : " · snapshot totals (student list not loaded)"}
        </p>
      </div>

      <div className="filter-bar">
        <label>
          Gender
          <select value={filters.gender} onChange={(e) => set("gender", e.target.value as ReportFilters["gender"])}>
            <option value="all">All</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
          </select>
        </label>
        <label>
          Athletes
          <select value={filters.athlete} onChange={(e) => set("athlete", e.target.value as ReportFilters["athlete"])}>
            <option value="all">All</option>
            <option value="Athlete">Athletes only</option>
            <option value="Non-Athlete">Non-athletes only</option>
          </select>
        </label>
        <label>
          Degree type
          <select value={filters.degree} onChange={(e) => set("degree", e.target.value as ReportFilters["degree"])}>
            {DEGREE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <MultiFilter
          label="Hide sports"
          emptyLabel="Show all sports"
          options={sports}
          selected={filters.excludedSports}
          onChange={(excludedSports) => set("excludedSports", excludedSports)}
        />
        <MultiFilter
          label="Majors"
          emptyLabel="All majors"
          options={majors}
          selected={filters.majors}
          onChange={(next) => set("majors", next)}
        />
        {active && (
          <button type="button" className="filter-reset" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset to census view
          </button>
        )}
      </div>

      <div className="sheet-grid">
        <div className="sheet-col">
          <SheetTable title="States" headers={["States", "Students", "Percentage"]} rows={countRows(states, 2)} />
          <SheetTable title="Florida" headers={["Florida", "Students", "Percentage"]} rows={countRows(floridaAthlete)} />
          <SheetTable title="Florida" headers={["Florida", "Students", "Percentage"]} rows={countRows(floridaCatholic)} />
          <SheetTable
            title="UG by Gender"
            headers={["Row Labels", "Full", "Half", "Less", "Other(THRE)", "Total"]}
            rows={[
              ...genderLoad.flatMap((g, i, arr) => {
                const first = i === 0 || arr[i - 1].gender !== g.gender;
                const line: (string | number)[][] = [];
                if (first) line.push([g.gender === "Female" ? "F" : g.gender === "Male" ? "M" : g.gender, "", "", "", "", ""]);
                line.push([g.incomingReturning, fmtN(g.full), fmtN(g.half), fmtN(g.less), fmtN(g.other), fmtN(g.total)]);
                return line;
              }),
              ["Total", fmtN(loadTotal.full), fmtN(loadTotal.half), fmtN(loadTotal.less), fmtN(loadTotal.other), fmtN(loadTotal.total)],
            ]}
          />
        </div>
        <div className="sheet-col">
          <SheetTable
            title="Country"
            headers={["Country", "Students", "Percentage"]}
            rows={countRows(countries, 1)}
            note={countries.length ? `*${countries.length} Countries of F1 Visa Holders` : undefined}
          />
          <SheetTable title="All Students" headers={["Religion", "Students", "Percentage"]} rows={countRows(religion)} />
          <SheetTable
            title="All UG Students"
            headers={["Athlete/Non-Athlete", "Students", "Percentage"]}
            rows={countRows(athlete)}
          />
          <SheetTable
            title="Incoming Students"
            headers={["Athlete/Non-Athlete", "Students", "Percentage"]}
            rows={countRows(incomingAthlete)}
          />
          {appDecisions.length > 0 && (
            <SheetTable
              title="Application Decisions"
              headers={["Type", "Students", "Percentage"]}
              rows={countRows(appDecisions)}
            />
          )}
          <SheetTable
            title="Athletic Religious Association"
            headers={["Religion", "Students", "Percentage"]}
            rows={countRows(athleticReligion)}
          />
          <SheetTable
            title="Non-Florida & Catholic"
            headers={["Non-Florida & Catholic", "Students", "Percentage"]}
            rows={countRows(nonFl)}
          />
          <SheetTable
            title="Honors Program"
            headers={["Honors Program", "Students", "Percentage"]}
            rows={countRows(honorsByClass)}
            note={`${fmtN(honorsN)} honors students`}
          />
        </div>
        <div className="sheet-col">
          <SheetTable title="Gender" headers={["Gender", "Students", "Percentage"]} rows={countRows(gender)} />
          <SheetTable
            title="Sport"
            headers={["Sport", "Students", "% of Student Athletes", "% of All Students"]}
            rows={[
              ...sportsRows.map((r) => [
                r.label,
                fmtN(r.n),
                fmtPct(r.pctOfAthletes, 2),
                fmtPct(r.pctOfAll, 2),
              ]),
              ["Total", fmtN(sportsRows.reduce((s, r) => s + r.n, 0)), "", ""],
            ]}
          />
        </div>
        <div className="sheet-col">
          <SheetTable
            title="Class Level"
            headers={["Class Level", "Students", "Full Time", "Incoming", "Percentage"]}
            rows={[
              ...classLevel.map((r) => [r.label, fmtN(r.n), fmtN(r.fullTime), fmtN(r.incoming), fmtPct(r.pct)]),
              [
                "Total",
                fmtN(classLevel.reduce((s, r) => s + r.n, 0)),
                fmtN(classLevel.reduce((s, r) => s + (r.fullTime ?? 0), 0)),
                fmtN(classLevel.reduce((s, r) => s + (r.incoming ?? 0), 0)),
                "",
              ],
            ]}
          />
          <SheetTable
            title="Student Residency"
            headers={["Student Residency", "Total", "Percentage", "Male", "Female"]}
            rows={[
              ...residency.map((r) => [r.label, fmtN(r.n), fmtPct(r.pct), fmtN(r.male), fmtN(r.female)]),
              [
                "Total",
                fmtN(residency.reduce((s, r) => s + r.n, 0)),
                "",
                fmtN(residency.reduce((s, r) => s + (r.male ?? 0), 0)),
                fmtN(residency.reduce((s, r) => s + (r.female ?? 0), 0)),
              ],
            ]}
            note={data.housing ? "*No UG in Middlebrooke" : "Housing pending"}
          />
          <SheetTable
            title="Graduation"
            headers={["Graduation", "All", "Athletes", "Non-Athletes"]}
            rows={[["Graduated Fall, Spring, Summer", fmtN(ret.graduates), "—", "—"]]}
          />
          <SheetTable
            title="Fall 2025 FTCA Retention Rate"
            headers={["Fall 2025 FTCA Retention Rate", ""]}
            rows={[
              ["Fall 2025 FTCA Cohort", fmtN(a.cohort)],
              ["Fall 2025 Cohort Enrolled for Fall 2026", fmtN(a.enrolledThisFall)],
              ["Retention Rate F25-F26", fmtPct(a.retentionRate)],
            ]}
          />
          <SheetTable
            title="Historical FTCA Retention Rate"
            headers={["Historical FTCA Retention Rate", "Rate"]}
            rows={data.historicalFtcaRetention.map((r) => [r.label, fmtPct(r.rate)])}
          />
          <SheetTable
            title="Fall 2025 All UG Retention Rate"
            headers={["Fall 2025 All UG Retention Rate", "All"]}
            rows={[
              ["Fall 2025 All UG Retention Rate", fmtN(ret.priorUg)],
              ["Fall 2025 All UG Enrolled for Fall 2026", fmtN(ret.enrolledThisFall)],
              ["Minus Fall, Spring, Summer Graduates", fmtN(ret.graduates)],
              ["All Student Retention Rate F25-F26", fmtPct(ret.retentionRate)],
            ]}
          />
          <SheetTable
            title="Historical All UG Retention Rate"
            headers={["Historical All UG Retention Rate", "Rate"]}
            rows={data.historicalAllUgRetention.map((r) => [r.label, fmtPct(r.rate)])}
          />
          <SheetTable
            title={`${fa} Majors`}
            headers={[`${fa} Majors`, "Freshman", "Sophomore", "Junior", "Senior", "Total", "Percentage All Majors"]}
            rows={[
              ...majorRows.map((m) => [
                m.label,
                fmtN(m.freshman),
                fmtN(m.sophomore),
                fmtN(m.junior),
                fmtN(m.senior),
                fmtN(m.total),
                fmtPct(majorTotal ? m.total / majorTotal : 0),
              ]),
              [
                "Totals",
                fmtN(majorRows.reduce((s, m) => s + m.freshman, 0)),
                fmtN(majorRows.reduce((s, m) => s + m.sophomore, 0)),
                fmtN(majorRows.reduce((s, m) => s + m.junior, 0)),
                fmtN(majorRows.reduce((s, m) => s + m.senior, 0)),
                fmtN(majorTotal),
                "",
              ],
            ]}
            note="*Includes all declared majors, students with more than one major will be counted multiple times."
          />
        </div>
      </div>
    </div>
  );
}
