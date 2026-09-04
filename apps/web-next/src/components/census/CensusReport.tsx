"use client";

import { useMemo } from "react";
import { SportRetentionTable } from "@/components/census/CensusLists";
import { SheetTable, fmtN, fmtPct } from "@/components/census/Sheet";
import type { SportRetentionRow } from "@/lib/reports/census/retention";
import {
  DEFAULT_FILTERS,
  buildReport,
  filterStudents,
  type ReportFilters,
  type ReportStudent,
  type ReportTables,
} from "@/lib/reports/census/report";
import type { CensusSnapshot, LabeledCount } from "@/lib/reports/census/types";

function countRows(rows: LabeledCount[], pctDigits = 1): (string | number)[][] {
  const total = rows.reduce((s, r) => s + r.n, 0);
  return [
    ...rows.map((r) => [r.label, fmtN(r.n), fmtPct(r.pct ?? (total ? r.n / total : 0), pctDigits)]),
    ["Total", fmtN(total), ""],
  ];
}

export function CensusReport({
  data,
  students,
  filters,
  sportRows = [],
}: {
  data: CensusSnapshot;
  students: ReportStudent[];
  filters: ReportFilters;
  sportRows?: SportRetentionRow[];
}) {
  const filtered = useMemo(() => filterStudents(students, filters), [students, filters]);
  const live = useMemo(() => (students.length ? buildReport(filtered) : null), [students, filtered]);
  const tables: ReportTables | null = live;
  const u = data.ug;
  const n = tables?.n ?? u.n;
  const universe = students.length
    ? filterStudents(students, { ...DEFAULT_FILTERS, degree: filters.degree }).length
    : u.n;

  const who = filters.retention === "unretained" ? "Unretained" : "";
  const title =
    filters.degree === "grad"
      ? `${data.term} Census Report — ${who ? `${who} · ` : ""}Graduate Statistics`
      : filters.degree === "all"
        ? `${data.term} Census Report — ${who ? `${who} · ` : ""}All Students`
        : `${data.term} Census Report — ${who ? `${who} · ` : ""}Undergraduate Statistics`;

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
          {filters.retention === "unretained" ? " · FA25 not registered FA26, not 2025–26 graduates" : ""}
          {students.length ? "" : " · snapshot totals (student list not loaded)"}
        </p>
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
          {sportRows.length ? (
            <SportRetentionTable rows={sportRows} />
          ) : (
            <SheetTable
              title="Athletic Retention (Fall 2025 sport)"
              headers={["Team", "FA25 Athletes", "FA25 Associated", "# Non-Retained", "# Retained", "# Graduated", "Retention %", "Graduated %"]}
              rows={[["Needs data", "", "", "", "", "", ""]]}
            />
          )}
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
          <SheetTable
            title="Application Decisions"
            headers={["Type", "Students", "Percentage"]}
            rows={appDecisions.length ? countRows(appDecisions) : [["Needs data", "", ""]]}
          />
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
            title="Honors College"
            headers={["Honors College", "Students", "Percentage"]}
            rows={countRows(honorsByClass)}
            note={`${fmtN(honorsN)} honors students`}
          />
        </div>
        <div className="sheet-col">
          <SheetTable title="Gender" headers={["Gender", "Students", "Percentage"]} rows={countRows(gender)} />
          <SheetTable
            title="Sport"
            headers={["Sport", "Athletes", "Athletics Associated", "% of Student Athletes", "% of All Students"]}
            rows={[
              ...sportsRows.map((r) => [
                r.label,
                fmtN(r.athletes ?? 0),
                fmtN(r.associated ?? r.n),
                fmtPct(r.pctOfAthletes, 2),
                fmtPct(r.pctOfAll, 2),
              ]),
              [
                "Total",
                `${sportsRows.reduce((s, r) => s + (r.athletes ?? 0), 0)}*`,
                `${sportsRows.reduce((s, r) => s + (r.associated ?? r.n), 0)}**`,
                "",
                "",
              ],
            ]}
            note={'*“Athletes” refers to team players only. “Athletics Associated” includes anyone affiliated with athletics (band, managers, etc.). **Athletics Association is used for athlete vs. non-athlete counts.'}
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
            note={
              data.housing
                ? "On Campus = halls. Ireland (Mount Melleray Abbey) and Rome are separate. Mont Mallary (03MM) is separate. Middlebrooke is not On Campus."
                : "Housing pending"
            }
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
