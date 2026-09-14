"use client";

import { useMemo } from "react";
import { SportRetentionTable } from "@/components/census/CensusLists";
import { SheetTable, fmtN, fmtPct } from "@/components/census/Sheet";
import {
  DEFAULT_FILTERS,
  buildReport,
  filterStudents,
  type ReportExtras,
  type ReportFilters,
  type ReportStudent,
  type ReportTables,
} from "@/lib/reports/census/report";
import { CENSUS_SPORT_TABLE_NOTE } from "@/lib/reports/census/lists-core";
import type { CrosstabRow } from "@/lib/reports/census/retention";
import type { CensusSnapshot, LabeledCount } from "@/lib/reports/census/types";

function countRows(rows: LabeledCount[], pctDigits = 1): (string | number)[][] {
  const total = rows.reduce((s, r) => s + r.n, 0);
  return [
    ...rows.map((r) => [r.label, fmtN(r.n), fmtPct(r.pct ?? (total ? r.n / total : 0), pctDigits)]),
    ["Total", fmtN(total), ""],
  ];
}

function needs(cols: number): (string | number)[][] {
  return [Array.from({ length: cols }, (_, i) => (i === 0 ? "Needs data" : ""))];
}

function crosstabRows(
  rows: CrosstabRow[],
  twoLabels = false,
  includeInTotal?: (r: CrosstabRow) => boolean,
): (string | number)[][] {
  if (!rows.length) return needs(twoLabels ? 5 : 4);
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

export function CensusReport({
  data,
  students,
  filters,
  extras,
}: {
  data: CensusSnapshot;
  students: ReportStudent[];
  filters: ReportFilters;
  extras: ReportExtras;
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
  const athleticTypes = tables?.athleticTypes ?? u.athleticTypes ?? [];
  const classLevel = tables?.classLevel ?? u.classLevel;
  const sportsRows = tables?.sports ?? u.sports;
  const residency = tables?.residency ?? u.residency;
  const honorsByClass = tables?.honorsByClass ?? u.honorsByClass;
  const honorsN = tables?.honorsN ?? u.honorsN;
  const instituteByClass = tables?.instituteByClass ?? [];
  const instituteN = tables?.instituteN ?? 0;
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
  const ug = extras.ugSplit;
  const sportRows = extras.sportRetention;

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
          <SheetTable title="Florida (all UG)" headers={["Florida (all UG)", "Students", "Percentage"]} rows={countRows(floridaAthlete)} />
          <SheetTable title="Florida (all UG)" headers={["Florida (all UG)", "Students", "Percentage"]} rows={countRows(floridaCatholic)} />
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
              rows={needs(11)}
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
            note="Athlete = Athletics Associated."
          />
          <SheetTable
            title="Incoming Students"
            headers={["Athlete/Non-Athlete", "Students", "Percentage"]}
            rows={countRows(incomingAthlete)}
          />
          <SheetTable
            title="Application Decisions"
            headers={["Type", "Students", "Percentage"]}
            rows={appDecisions.length ? countRows(appDecisions) : needs(3)}
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
          <SheetTable
            title="Institute"
            headers={["Institute", "Students", "Percentage"]}
            rows={instituteByClass.length ? countRows(instituteByClass) : needs(3)}
            note={`${fmtN(instituteN)} institute students`}
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
            note={CENSUS_SPORT_TABLE_NOTE}
          />
          {athleticTypes.length ? (
            <SheetTable
              title="Athletic Type"
              headers={["Athletic Type", "Students", "Percentage"]}
              rows={countRows(athleticTypes)}
              note="Percent of this report group. Band and managers are Associated, not team Athletes."
            />
          ) : null}
          <SheetTable
            title="Application Decisions Retention"
            headers={["Type", "Students", "# Non-Retained", "Retention %"]}
            rows={crosstabRows(extras.appDecisionRetention)}
          />
          <SheetTable
            title="Committee admits and admin overrides"
            headers={["Admit type", "Type", "Students", "# Non-Retained", "Retention %"]}
            rows={crosstabRows(extras.admitOverride, true, (r) => r.label2 === "Overall")}
            labelCols={2}
          />
          <SheetTable
            title="M/F Retention"
            headers={["Gender", "Students", "# Non-Retained", "Retention %"]}
            rows={crosstabRows(extras.genderRetention)}
          />
          <SheetTable
            title="Catholic/Non-Catholic"
            headers={["Catholic/Non-Catholic", "Athlete/Non-Athlete", "Students", "# Non-Retained", "Retention %"]}
            rows={crosstabRows(extras.catholicAthlete, true)}
            labelCols={2}
          />
          <SheetTable
            title="Athlete/Non-Athlete"
            headers={["Athlete/Non-Athlete", "Gender", "Students", "# Non-Retained", "Retention %"]}
            rows={crosstabRows(extras.athleteGender, true)}
            labelCols={2}
          />
          <SheetTable
            title="Athlete/Non-Athlete"
            headers={["Athlete/Non-Athlete", "Ethnicity", "Students", "# Non-Retained", "Retention %"]}
            rows={crosstabRows(extras.athleteEthnicity, true)}
            labelCols={2}
          />
          <SheetTable
            title="Residence Type"
            headers={["Residence Type", "Gender", "Students", "# Non-Retained", "Retention %"]}
            rows={crosstabRows(extras.residenceGender, true)}
            labelCols={2}
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
            rows={
              extras.hasPrior
                ? [
                    ["Graduated Fall, Spring, Summer", fmtN(ug.all.graduated), fmtN(ug.athletes.graduated), fmtN(ug.nonAthletes.graduated)],
                    [
                      "Percentage",
                      "",
                      ug.all.graduated ? fmtPct(ug.athletes.graduated / ug.all.graduated) : "—",
                      ug.all.graduated ? fmtPct(ug.nonAthletes.graduated / ug.all.graduated) : "—",
                    ],
                  ]
                : [
                    ["Graduated Fall, Spring, Summer", fmtN(ret.graduates), "Needs data", "Needs data"],
                    ["Percentage", "", "Needs data", "Needs data"],
                  ]
            }
          />
          <SheetTable
            title="Fall 2025 FTCA Retention Rate"
            headers={["Fall 2025 FTCA Retention Rate", ""]}
            rows={[
              ["Fall 2025 FTCA Cohort (Incoming + FTCA)", fmtN(a.cohort)],
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
            headers={["Fall 2025 All UG Retention Rate", "All", "Athletes", "Non-Athletes"]}
            rows={
              extras.hasPrior
                ? [
                    ["Fall 2025 All UG Retention Rate", fmtN(ug.all.students), fmtN(ug.athletes.students), fmtN(ug.nonAthletes.students)],
                    [
                      "Fall 2025 All UG Enrolled for Fall 2026",
                      fmtN(ug.all.enrolled),
                      fmtN(ug.athletes.enrolled),
                      fmtN(ug.nonAthletes.enrolled),
                    ],
                    [
                      "Minus Fall, Spring, Summer Graduates",
                      fmtN(ug.all.graduated),
                      fmtN(ug.athletes.graduated),
                      fmtN(ug.nonAthletes.graduated),
                    ],
                    [
                      "All Student Retention Rate F25-F26",
                      ug.all.retentionPct == null ? "—" : fmtPct(ug.all.retentionPct),
                      ug.athletes.retentionPct == null ? "—" : fmtPct(ug.athletes.retentionPct),
                      ug.nonAthletes.retentionPct == null ? "—" : fmtPct(ug.nonAthletes.retentionPct),
                    ],
                  ]
                : [
                    ["Fall 2025 All UG Retention Rate", fmtN(ret.priorUg), "Needs data", "Needs data"],
                    ["Fall 2025 All UG Enrolled for Fall 2026", fmtN(ret.enrolledThisFall), "Needs data", "Needs data"],
                    ["Minus Fall, Spring, Summer Graduates", fmtN(ret.graduates), "Needs data", "Needs data"],
                    ["All Student Retention Rate F25-F26", fmtPct(ret.retentionRate), "Needs data", "Needs data"],
                  ]
            }
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
            note="*All declared majors except minors. Double majors counted twice."
          />
          <SheetTable
            title="F25-F26 Additional Association Retention"
            headers={["Association", "Gender", "Students", "Graduated", "# Non-Retained", "Retention %"]}
            rows={
              extras.association.length
                ? extras.association.map((r) => [
                    r.label,
                    r.label2 || "",
                    fmtN(r.students),
                    fmtN(r.graduated),
                    fmtN(r.notRetained),
                    r.retentionPct == null ? "—" : fmtPct(r.retentionPct),
                  ])
                : needs(6)
            }
            labelCols={2}
          />
        </div>
      </div>
    </div>
  );
}
