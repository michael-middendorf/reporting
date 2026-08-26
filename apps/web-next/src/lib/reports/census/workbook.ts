import type { CensusLists, CensusRawStudent, UnretainedStudent } from "./lists";
import type { HousingAssignmentRow } from "./residency";
import {
  DEFAULT_FILTERS,
  buildReport,
  filterStudents,
  projectReportStudents,
  tablesFromSnapshot,
  type ReportTables,
} from "./report";
import {
  fullTimeUg,
  historicalSeries,
  type AttritionRow,
  type CensusSnapshot,
  type CountFte,
  type LabeledCount,
} from "./types";
import { cellRef, XlsxSheet, XlsxWorkbook, type CellStyle, type CellValue } from "./xlsx";

const NAVY = "1A3F6F";
const GOLD = "B8922E";
const PALE = "F7FAFD";
const TOTAL_FILL = "E8EEF6";

const TITLE: CellStyle = { bold: true, size: 16, color: NAVY, border: { b: { s: "thin", c: GOLD } } };
const TITLE20: CellStyle = { bold: true, size: 20, color: NAVY, border: { b: { s: "thin", c: GOLD } } };
const TITLE18: CellStyle = { bold: true, size: 18, color: NAVY, border: { b: { s: "thin", c: GOLD } } };
const SECTION: CellStyle = { bold: true, size: 11, color: NAVY };
const HEADER_STYLE: CellStyle = {
  bold: true,
  size: 10,
  color: "FFFFFF",
  fill: NAVY,
  vAlign: "center",
  hAlign: "center",
};
const TOTAL_STYLE: CellStyle = { bold: true, size: 11, fill: TOTAL_FILL, color: NAVY };
const NOTE: CellStyle = { italic: true, size: 10, color: "4A6A90" };
const LABEL_BOLD: CellStyle = { bold: true, size: 12, color: NAVY };
const INDENT: CellStyle = { indent: 1 };
const STRIPE: CellStyle = { fill: PALE };

function fallLabel(year: number): string {
  return `Fall ${year}`;
}

function faLabel(year: number): string {
  return `FA${String(year).slice(2)}`;
}

function writeHeaders(ws: XlsxSheet, row: number, col: number, headers: string[]) {
  headers.forEach((h, i) => {
    ws.set(row, col + i, h, HEADER_STYLE);
  });
}

function writeRow(ws: XlsxSheet, row: number, col: number, values: CellValue[], indent = false) {
  values.forEach((v, i) => {
    ws.set(row, col + i, v, i === 0 && indent ? INDENT : {});
  });
}

function applyFmt(ws: XlsxSheet, row: number, col: number, numFmt: CellStyle["numFmt"]) {
  ws.patch(row, col, { numFmt });
}

function styleTotal(ws: XlsxSheet, row: number, from: number, to: number) {
  for (let c = from; c <= to; c++) ws.patch(row, c, TOTAL_STYLE);
}

function writeCountTable(
  ws: XlsxSheet,
  startRow: number,
  startCol: number,
  title: string,
  headers: string[],
  rows: CellValue[][],
  opts?: { pctCols?: number[]; intCols?: number[]; total?: boolean },
): number {
  let headerRow = startRow;
  if (title) {
    ws.set(startRow, startCol, title, SECTION);
    headerRow = startRow + 1;
  }
  writeHeaders(ws, headerRow, startCol, headers);
  let r = headerRow + 1;
  const lastCol = startCol + headers.length - 1;
  for (const [i, row] of rows.entries()) {
    writeRow(ws, r, startCol, row);
    if (i % 2 === 1) {
      for (let c = startCol; c <= lastCol; c++) ws.patch(r, c, STRIPE);
    }
    for (const c of opts?.intCols || []) applyFmt(ws, r, startCol + c, "int");
    for (const c of opts?.pctCols || []) applyFmt(ws, r, startCol + c, "pct");
    r += 1;
  }
  if (opts?.total && rows.length) {
    styleTotal(ws, r - 1, startCol, lastCol);
  }
  if (rows.length) ws.box(headerRow, startCol, r - 1, lastCol);
  return r;
}

function labeledRows(rows: LabeledCount[], withTotal = true): CellValue[][] {
  const out: CellValue[][] = rows.map((row) => [row.label, row.n, row.pct ?? null]);
  if (withTotal) {
    const total = rows.reduce((s, row) => s + row.n, 0);
    out.push(["Total", total, total ? 1 : null]);
  }
  return out;
}

function attritionRows(rows: AttritionRow[]): CellValue[][] {
  const out: CellValue[][] = rows.map((row) => [
    row.label,
    row.students,
    row.notRetained,
    row.retainedPct,
    row.shareOfNotRetained,
  ]);
  const students = rows.reduce((s, row) => s + row.students, 0);
  const notRetained = rows.reduce((s, row) => s + row.notRetained, 0);
  out.push([
    "Total",
    students,
    notRetained,
    students ? (students - notRetained) / students : null,
    students ? 1 : null,
  ]);
  return out;
}

function writeSummary(wb: XlsxWorkbook, data: CensusSnapshot) {
  const ws = wb.addSheet("Summary");
  ws.gridLines = false;
  ws.width(1, 58);
  ws.width(2, 4);
  ws.width(3, 22);
  ws.width(4, 12);

  ws.set(1, 1, `${data.term} Census — Summary`, TITLE);
  writeHeaders(ws, 2, 3, ["HEADCOUNT", "FTE"]);

  const ft = fullTimeUg(data);
  const s = data.summary;
  const year = data.historical.years[0] ?? 2026;
  const rows: { label: string; c?: CountFte; indent?: boolean; total?: boolean; hcText?: string }[] = [
    { label: "Degree-Seeking" },
    { label: `Undergraduate, New Students Admitted ${fallLabel(year).toUpperCase()}`, c: s.newStudents },
    { label: "FTCA", c: s.ftca, indent: true },
    { label: "TRAN", c: s.tran, indent: true },
    { label: "READ", c: s.read, indent: true },
    { label: "SECB", c: s.secb, indent: true },
    { label: "Lux Mundi", c: s.luxMundiUg, indent: true },
    { label: "Returning Students", c: s.returning },
    {
      label: "Total Degree-Seeking",
      c: s.degreeSeeking,
      total: true,
      hcText: `${s.degreeSeeking.headcount.toLocaleString()} (${ft.toLocaleString()} Full Time)`,
    },
    { label: "" },
    { label: "High School Dual Enrollment", c: s.dualEnrollment },
    { label: "Non-Degree-Seeking / Personal Enrichment", c: s.nonDegree },
    { label: "Lux Mundi Non-Degree-Seeking / Personal Enrichment", c: s.luxMundiUg },
    { label: "" },
    { label: "TOTAL UNDERGRADUATE ENROLLMENT", c: s.totalUndergraduate, total: true },
    { label: "" },
    { label: "Graduate MA Students", c: s.gradMa },
    { label: "Graduate PhD Students", c: s.gradPhd },
    { label: "Graduate MBA Students", c: s.gradMba },
    { label: "Graduate MEdCl", c: s.gradMedcl },
    { label: "Graduate MA Theo (Online) - Lux Mundi", c: s.luxMundiGrad },
    { label: "" },
    { label: "TOTAL GRADUATE ENROLLMENT", c: s.totalGraduate, total: true },
    { label: "" },
    { label: "Graduate & Undergraduate Enrollment", c: s.totalEnrollment, total: true },
  ];

  rows.forEach((row, i) => {
    const r = 3 + i;
    ws.set(r, 1, row.label, {
      size: 12,
      bold: Boolean(row.total || (!row.indent && row.c)),
      indent: row.indent ? 1 : undefined,
    });
    if (row.c) {
      if (row.hcText) ws.set(r, 3, row.hcText);
      else ws.set(r, 3, row.c.headcount, { numFmt: "int" });
      ws.set(r, 4, row.c.fte ?? "", { numFmt: "fte" });
      if (row.total) {
        styleTotal(ws, r, 1, 4);
        ws.patch(r, 1, LABEL_BOLD);
      }
    }
  });
  ws.patch(2, 1, HEADER_STYLE);
  ws.patch(2, 2, HEADER_STYLE);
  ws.box(2, 1, 2 + rows.length, 4);
}

function writeHistorical(wb: XlsxWorkbook, data: CensusSnapshot) {
  const ws = wb.addSheet("Historical");
  ws.gridLines = false;
  ws.width(1, 58);
  const years = data.historical.years;
  years.forEach((_, i) => {
    ws.width(3 + i * 2, 14);
    ws.width(4 + i * 2, 10);
  });

  years.forEach((year, i) => {
    const col = 3 + i * 2;
    ws.merge(1, col, 1, col + 1);
    ws.set(1, col, fallLabel(year), { ...LABEL_BOLD, color: NAVY, hAlign: "center" });
    ws.set(2, col, "HEADCOUNT", { ...HEADER_STYLE, hAlign: "center" });
    ws.set(2, col + 1, "FTE", { ...HEADER_STYLE, hAlign: "center" });
  });

  const lines: { label: string; key?: string; indent?: boolean; total?: boolean }[] = [
    { label: "Degree-Seeking" },
    { label: "Undergraduate, New Students Admitted", key: "newStudents" },
    { label: "FTCA", key: "ftca", indent: true },
    { label: "TRAN", key: "tran", indent: true },
    { label: "READ", key: "read", indent: true },
    { label: "SECB", key: "secb", indent: true },
    { label: "Lux Mundi", key: "luxMundiUg", indent: true },
    { label: "Returning Students", key: "returning" },
    { label: "Total Degree-Seeking", key: "degreeSeeking", total: true },
    { label: "" },
    { label: "High School Dual Enrollment", key: "dualEnrollment" },
    { label: "Non-Degree-Seeking / Personal Enrichment", key: "nonDegree" },
    { label: "" },
    { label: "TOTAL UNDERGRADUATE ENROLLMENT", key: "totalUndergraduate", total: true },
    { label: "" },
    { label: "Graduate MA Students", key: "gradMa" },
    { label: "Graduate PhD Students", key: "gradPhd" },
    { label: "Graduate MBA Students", key: "gradMba" },
    { label: "Graduate MEdCl", key: "gradMedcl" },
    { label: "Graduate MA Theo (Online) - Lux Mundi", key: "luxMundiGrad" },
    { label: "" },
    { label: "TOTAL GRADUATE ENROLLMENT", key: "totalGraduate", total: true },
    { label: "" },
    { label: "Graduate & Undergraduate Enrollment", key: "totalEnrollment", total: true },
  ];

  lines.forEach((line, i) => {
    const r = 3 + i;
    ws.set(r, 1, line.label, {
      bold: Boolean(line.total || (!line.indent && line.key)),
      indent: line.indent ? 1 : undefined,
    });
    if (!line.key) return;
    const series = historicalSeries(data.historical, line.key);
    years.forEach((_, yi) => {
      const col = 3 + yi * 2;
      ws.set(r, col, series.hc?.[yi] ?? "", { numFmt: "int" });
      ws.set(r, col + 1, series.fte?.[yi] ?? "", { numFmt: "fte" });
    });
    if (line.total) styleTotal(ws, r, 1, 2 + years.length * 2);
  });
  const lastCol = 2 + years.length * 2;
  ws.patch(1, 1, { fill: NAVY });
  ws.patch(1, 2, { fill: NAVY });
  ws.patch(2, 1, HEADER_STYLE);
  ws.patch(2, 2, HEADER_STYLE);
  ws.box(1, 1, 2 + lines.length, lastCol);
}

function writeGenderLoad(
  ws: XlsxSheet,
  startRow: number,
  startCol: number,
  rows: ReportTables["genderLoad"],
): number {
  const headers = ["Row Labels", "Full", "Half", "Less", "Other(THRE)", "Total"];
  ws.set(startRow, startCol, "UG by Gender", SECTION);
  writeHeaders(ws, startRow + 1, startCol, headers);
  let r = startRow + 2;
  let prev = "";
  const lastCol = startCol + headers.length - 1;
  for (const g of rows) {
    if (g.gender !== prev) {
      const letter = g.gender === "Female" ? "F" : g.gender === "Male" ? "M" : g.gender;
      ws.set(r, startCol, letter, { bold: true, color: NAVY });
      r += 1;
      prev = g.gender;
    }
    writeRow(ws, r, startCol, [g.incomingReturning, g.full, g.half, g.less, g.other, g.total]);
    for (const c of [1, 2, 3, 4, 5]) applyFmt(ws, r, startCol + c, "int");
    r += 1;
  }
  writeRow(ws, r, startCol, [
    "Total",
    rows.reduce((s, g) => s + g.full, 0),
    rows.reduce((s, g) => s + g.half, 0),
    rows.reduce((s, g) => s + g.less, 0),
    rows.reduce((s, g) => s + g.other, 0),
    rows.reduce((s, g) => s + g.total, 0),
  ]);
  for (const c of [1, 2, 3, 4, 5]) applyFmt(ws, r, startCol + c, "int");
  styleTotal(ws, r, startCol, lastCol);
  ws.box(startRow + 1, startCol, r, lastCol);
  return r + 1;
}

function writeCensusReport(wb: XlsxWorkbook, data: CensusSnapshot, tables: ReportTables) {
  const year = data.historical.years[0] ?? 2026;
  const fa = faLabel(year);
  const ws = wb.addSheet(`${fa} Census Report`);
  ws.gridLines = false;
  [6, 16, 12, 12, 3, 28, 12, 12, 3, 22, 14, 18, 16, 3, 3, 42, 14, 14, 14, 12, 12, 22].forEach((w, i) => {
    ws.width(i + 1, w);
  });

  ws.merge(1, 1, 1, 20);
  ws.set(1, 1, `${data.term} Census Report - Undergraduate Statistics`, TITLE20);
  ws.height(1, 26);

  const t = tables;
  const n = t.n;
  const col = { b: 2, f: 6, j: 10, p: 16 };

  let b = writeCountTable(ws, 3, col.b, "", ["States", "Students", "Percentage"], labeledRows(t.states), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });
  b = writeCountTable(ws, b + 2, col.b, "", ["Florida", "Students", "Percentage"], labeledRows(t.floridaAthlete), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });
  b = writeCountTable(ws, b + 2, col.b, "", ["Florida", "Students", "Percentage"], labeledRows(t.floridaCatholic), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });

  let f = writeCountTable(ws, 3, col.f, "", ["Country", "Students", "Percentage"], labeledRows(t.countries), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });
  ws.set(f, col.f, `*${t.countries.length} Countries of F1 Visa Holders`, NOTE);
  f += 2;
  f = writeCountTable(ws, f, col.f, "All Students", ["Religion", "Students", "Percentage"], labeledRows(t.religion), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });
  f = writeCountTable(
    ws,
    f + 2,
    col.f,
    "All UG Students",
    ["Athlete/Non-Athlete", "Students", "Percentage"],
    labeledRows(t.athlete),
    { intCols: [1], pctCols: [2], total: true },
  );
  f = writeCountTable(
    ws,
    f + 2,
    col.f,
    "Incoming Students",
    ["Athlete/Non-Athlete", "Students", "Percentage"],
    labeledRows(t.incomingAthlete),
    { intCols: [1], pctCols: [2], total: true },
  );
  if (t.appDecisions.length) {
    f = writeCountTable(
      ws,
      f + 2,
      col.f,
      "Application Decisions",
      ["Type", "Students", "Percentage"],
      labeledRows(t.appDecisions),
      { intCols: [1], pctCols: [2], total: true },
    );
  }
  f = writeCountTable(
    ws,
    f + 2,
    col.f,
    "Athletic Religious Association",
    ["Religion", "Students", "Percentage"],
    labeledRows(t.athleticReligion),
    { intCols: [1], pctCols: [2], total: true },
  );
  f = writeCountTable(
    ws,
    f + 2,
    col.f,
    "",
    ["Non-Florida & Catholic", "Students", "Percentage"],
    labeledRows(t.nonFloridaCatholicAthlete),
    { intCols: [1], pctCols: [2], total: true },
  );
  f = writeCountTable(
    ws,
    f + 2,
    col.f,
    "Honors Program",
    ["Honors Program", "Students", "Percentage"],
    labeledRows(t.honorsByClass),
    { intCols: [1], pctCols: [2], total: true },
  );
  // FA25 puts UG by Gender under States/Florida once column F is clear (Other(THRE) lives in F).
  writeGenderLoad(ws, Math.max(b, f) + 2, col.b, t.genderLoad);

  let j = writeCountTable(ws, 3, col.j, "", ["Gender", "Students", "Percentage"], labeledRows(t.gender), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });
  const sportRows: CellValue[][] = [
    ...t.sports.map((r) => [r.label, r.n, r.pctOfAthletes ?? null, r.pctOfAll ?? null]),
    ["Total", t.sports.reduce((s, r) => s + r.n, 0), "", ""],
  ];
  writeCountTable(
    ws,
    j + 2,
    col.j,
    "",
    ["Sport", "Students", "% of Student Athletes", "% of All Students"],
    sportRows,
    { intCols: [1], pctCols: [2, 3], total: true },
  );

  const classRows: CellValue[][] = [
    ...t.classLevel.map((r) => [r.label, r.n, r.fullTime ?? "", r.incoming ?? "", n ? r.n / n : null]),
    [
      "Total",
      t.classLevel.reduce((s, r) => s + r.n, 0),
      t.classLevel.reduce((s, r) => s + (r.fullTime ?? 0), 0),
      t.classLevel.reduce((s, r) => s + (r.incoming ?? 0), 0),
      "",
    ],
  ];
  let p = writeCountTable(
    ws,
    3,
    col.p,
    "",
    ["Class Level", "Students", "Full Time", "Incoming", "Percentage"],
    classRows,
    { intCols: [1, 2, 3], pctCols: [4], total: true },
  );

  const resHasGender = t.residency.some((r) => r.male != null || r.female != null);
  const resRows: CellValue[][] = [
    ...t.residency.map((r) => [r.label, r.n, r.pct ?? null, r.male ?? "", r.female ?? ""]),
    [
      "Total",
      t.residency.reduce((s, r) => s + r.n, 0),
      "",
      resHasGender ? t.residency.reduce((s, r) => s + (r.male ?? 0), 0) : "",
      resHasGender ? t.residency.reduce((s, r) => s + (r.female ?? 0), 0) : "",
    ],
  ];
  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "",
    ["Student Residency", "Total", "Percentage", "Male", "Female"],
    resRows,
    { intCols: [1, 3, 4], pctCols: [2], total: true },
  );
  ws.set(p, col.p, data.housing ? "*No UG in Middlebrooke" : "Housing pending", NOTE);
  p += 2;

  p = writeCountTable(
    ws,
    p,
    col.p,
    "Graduation",
    ["Graduation", "All", "Athletes", "Non-Athletes"],
    [["Graduated Fall, Spring, Summer", data.allUgRetention.graduates, "", ""]],
    { intCols: [1] },
  );
  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "Fall 2025 FTCA Retention Rate",
    ["Fall 2025 FTCA Retention Rate", ""],
    [
      ["Fall 2025 FTCA Cohort", data.ftcaAttrition.cohort],
      ["Fall 2025 Cohort Enrolled for Fall 2026", data.ftcaAttrition.enrolledThisFall],
      ["Retention Rate F25-F26", data.ftcaAttrition.retentionRate],
    ],
    { intCols: [1] },
  );
  applyFmt(ws, p - 1, col.p + 1, "pct");

  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "Historical FTCA Retention Rate",
    ["Historical FTCA Retention Rate", "Rate"],
    data.historicalFtcaRetention.map((r) => [r.label, r.rate]),
    { pctCols: [1] },
  );

  const lastAllUg = writeCountTable(
    ws,
    p + 2,
    col.p,
    "Fall 2025 All UG Retention Rate",
    ["Fall 2025 All UG Retention Rate", "All"],
    [
      ["Fall 2025 All UG Retention Rate", data.allUgRetention.priorUg],
      ["Fall 2025 All UG Enrolled for Fall 2026", data.allUgRetention.enrolledThisFall],
      ["Minus Fall, Spring, Summer Graduates", data.allUgRetention.graduates],
      ["All Student Retention Rate F25-F26", data.allUgRetention.retentionRate],
    ],
    { intCols: [1] },
  );
  applyFmt(ws, lastAllUg - 1, col.p + 1, "pct");
  p = lastAllUg;

  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "Historical All UG Retention Rate",
    ["Historical All UG Retention Rate", "Rate"],
    data.historicalAllUgRetention.map((r) => [r.label, r.rate]),
    { pctCols: [1] },
  );

  const majorTotal = t.majors.reduce((s, m) => s + m.total, 0);
  const majorRows: CellValue[][] = [
    ...t.majors.map((m) => [m.label, m.freshman, m.sophomore, m.junior, m.senior, m.total, majorTotal ? m.total / majorTotal : null]),
    [
      "Totals",
      t.majors.reduce((s, m) => s + m.freshman, 0),
      t.majors.reduce((s, m) => s + m.sophomore, 0),
      t.majors.reduce((s, m) => s + m.junior, 0),
      t.majors.reduce((s, m) => s + m.senior, 0),
      majorTotal,
      "",
    ],
  ];
  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "",
    [`${fa} Majors`, "Freshman", "Sophomore", "Junior", "Senior", "Total", "Percentage All Majors"],
    majorRows,
    { intCols: [1, 2, 3, 4, 5], pctCols: [6], total: true },
  );
  ws.set(p, col.p, "*Includes all declared majors, students with more than one major will be counted multiple times.", NOTE);
}

function writeAttrition(wb: XlsxWorkbook, data: CensusSnapshot) {
  const ws = wb.addSheet("FA25 FTCA Cohort Attrition");
  ws.gridLines = false;
  [18, 12, 16, 12, 22, 3, 24, 16, 14, 12, 16, 12, 3, 28, 16, 16].forEach((w, i) => {
    ws.width(i + 1, w);
  });
  ws.set(1, 1, "Fall 2025 Cohort Attrition", TITLE18);

  const a = data.ftcaAttrition;
  writeCountTable(
    ws,
    3,
    1,
    "States",
    ["States", "Students", "# Non-Retained", "% Retained", "% of All Non-Retained"],
    attritionRows(a.byState),
    { intCols: [1, 2], pctCols: [3, 4], total: true },
  );
  writeCountTable(
    ws,
    3,
    7,
    "Athlete",
    ["Athlete", "Students", "# Non-Retained", "% Retained"],
    a.byAthlete
      .map((r) => [r.label, r.students, r.notRetained, r.retainedPct])
      .concat([
        [
          "Total",
          a.byAthlete.reduce((sum, r) => sum + r.students, 0),
          a.byAthlete.reduce((sum, r) => sum + r.notRetained, 0),
          a.retentionRate,
        ],
      ]),
    { intCols: [1, 2], pctCols: [3], total: true },
  );
  writeCountTable(
    ws,
    10,
    7,
    "Sport Primary",
    ["Sport Primary", "Students", "Non-Retained", "% of All Non-Retained", "% Retained"],
    a.bySport
      .map((r) => [r.label, r.students, r.notRetained, r.shareOfNotRetained, r.retainedPct])
      .concat([
        [
          "Total",
          a.bySport.reduce((sum, r) => sum + r.students, 0),
          a.bySport.reduce((sum, r) => sum + r.notRetained, 0),
          "",
          "",
        ],
      ]),
    { intCols: [1, 2], pctCols: [3, 4], total: true },
  );
  writeCountTable(
    ws,
    3,
    14,
    "AMU GPA Ranges",
    ["AMU GPA Ranges", "Students", "# Non-Retained"],
    a.byGpa
      .map((r) => [r.label, r.students, r.notRetained])
      .concat([["Total", a.byGpa.reduce((sum, r) => sum + r.students, 0), a.byGpa.reduce((sum, r) => sum + r.notRetained, 0)]]),
    { intCols: [1, 2], total: true },
  );
  writeCountTable(
    ws,
    16,
    14,
    "Ethnicity",
    ["Ethnicity", "Students", "# Non-Retained", "% Retained"],
    a.byEthnicity
      .map((r) => [r.label, r.students, r.notRetained, r.retainedPct])
      .concat([
        [
          "Total",
          a.byEthnicity.reduce((sum, r) => sum + r.students, 0),
          a.byEthnicity.reduce((sum, r) => sum + r.notRetained, 0),
          a.retentionRate,
        ],
      ]),
    { intCols: [1, 2], pctCols: [3], total: true },
  );
  writeCountTable(
    ws,
    36,
    7,
    "Catholic / Athlete",
    ["Catholic / Athlete", "Students", "# Non-Retained", "% Retained"],
    a.byCatholicAthlete
      .map((r) => [r.label, r.students, r.notRetained, r.retainedPct])
      .concat([
        [
          "Total",
          a.byCatholicAthlete.reduce((sum, r) => sum + r.students, 0),
          a.byCatholicAthlete.reduce((sum, r) => sum + r.notRetained, 0),
          a.retentionRate,
        ],
      ]),
    { intCols: [1, 2], pctCols: [3], total: true },
  );
}

function writeHousing(wb: XlsxWorkbook, rows: HousingAssignmentRow[]) {
  const ws = wb.addSheet("FA26 Housing (eRez)");
  const headers = [
    "PCID",
    "Name",
    "Email",
    "Building",
    "Room",
    "Price Type",
    "Residency",
    "Class",
    "Student Type",
    "In UG census",
  ];
  writeHeaders(ws, 1, 1, headers);
  [14, 28, 36, 14, 10, 12, 16, 16, 18, 14].forEach((w, i) => ws.width(i + 1, w));
  const sorted = [...rows].sort((a, b) => a.residency.localeCompare(b.residency) || a.name.localeCompare(b.name));
  sorted.forEach((row, i) => {
    writeRow(ws, i + 2, 1, [
      row.pcid,
      row.name,
      row.email,
      row.building,
      row.room,
      row.priceType,
      row.residency,
      row.classStatus,
      row.studentType,
      row.includedInCensus ? "Y" : "N",
    ]);
    if (i % 2 === 1) {
      for (let c = 1; c <= headers.length; c++) ws.patch(i + 2, c, STRIPE);
    }
  });
  if (sorted.length) ws.box(1, 1, sorted.length + 1, headers.length);
  ws.autoFilter = `A1:${cellRef(1, headers.length)}`;
  ws.freezeRows = 1;
}

function writeListSheet(
  wb: XlsxWorkbook,
  name: string,
  headers: string[],
  widths: number[],
  rows: CellValue[][],
) {
  const ws = wb.addSheet(name);
  ws.gridLines = false;
  writeHeaders(ws, 1, 1, headers);
  widths.forEach((w, i) => ws.width(i + 1, w));
  if (!rows.length) {
    ws.set(2, 1, "No student-level rows published yet.");
    return;
  }
  rows.forEach((row, i) => {
    writeRow(ws, i + 2, 1, row);
    if (i % 2 === 1) {
      for (let c = 1; c <= headers.length; c++) ws.patch(i + 2, c, STRIPE);
    }
  });
  ws.box(1, 1, rows.length + 1, headers.length);
  ws.autoFilter = `A1:${cellRef(1, headers.length)}`;
  ws.freezeRows = 1;
}

function rawRow(s: CensusRawStudent): CellValue[] {
  return [
    s.pcid,
    s.first,
    s.last,
    s.incomingReturning,
    s.state,
    s.religion,
    s.cathGroup,
    s.ethnicity,
    s.gender,
    s.program,
    s.collegeAttend,
    s.curriculum,
    s.curriculumName,
    s.classLevel,
    s.fullPart,
    s.city,
    s.credits,
    s.gpa,
    s.earnedCredits,
    s.residency,
    s.sport,
    s.athlete,
    s.honors,
    s.fsp,
    s.household,
    s.institute,
    s.marines,
    s.appDecision,
    s.degree,
    s.email,
  ];
}

function unretainedRow(s: UnretainedStudent): CellValue[] {
  return [
    s.pcid,
    s.first,
    s.last,
    s.retention,
    s.gpa,
    s.fsp,
    s.household,
    s.marines,
    s.honors,
    s.sport,
    s.state,
    s.gender,
    s.classLevel,
    s.collegeAttend,
    s.incomingReturning,
    s.program || "",
  ];
}

function writeSources(
  wb: XlsxWorkbook,
  data: CensusSnapshot,
  housingCount: number,
  rawCount: number,
  unretainedCount: number,
) {
  const ws = wb.addSheet("Sources");
  ws.gridLines = false;
  ws.width(1, 28);
  ws.width(2, 88);
  ws.set(1, 1, "Census draft sources", TITLE);
  const rows: [string, string][] = [
    ["Term", data.term],
    ["Status", data.status],
    ["Snapshot date", data.generated],
    ["Draft exported", new Date().toISOString().slice(0, 10)],
    [
      "Housing",
      data.housing
        ? `eRezLife assignments (${data.housing.session || "session unknown"}; ${data.housing.ugMatched} UG matched, ${data.housing.unassigned} unassigned of ${data.kpis.ugStudents} UG). ${housingCount} assignment rows on FA26 Housing (eRez).`
        : "eRez housing cache not available; residency is still pending.",
    ],
    [
      "Raw data",
      rawCount
        ? `${rawCount.toLocaleString()} students on FA26 Census Raw Data (registration spine; residency filled from eRez when matched).`
        : "Student-level FA26 file is not in the census cache yet.",
    ],
    [
      "Not retained",
      unretainedCount
        ? `${unretainedCount.toLocaleString()} Fall 2025 census students not in Fall 2026 registration and not among 2025–26 Fall/Spring/Summer graduates.`
        : "Unretained list is not in the census cache yet.",
    ],
    ["Still to add", data.pending.length ? data.pending.join("; ") : "None"],
  ];
  rows.forEach((row, i) => {
    ws.set(i + 3, 1, row[0], { bold: true, color: NAVY, fill: PALE });
    ws.set(i + 3, 2, row[1], { wrap: true });
    ws.height(i + 3, 36);
  });
  ws.box(3, 1, 2 + rows.length, 2);
}

export function censusFileName(data: CensusSnapshot, exported = new Date()): string {
  const stamp = exported.toISOString().slice(0, 10);
  const fa = faLabel(data.historical.years[0] ?? 2026);
  return `${fa}_Census_${data.status === "final" ? "Final" : "DRAFT"}_${stamp}.xlsx`;
}

export async function buildCensusWorkbook(
  data: CensusSnapshot,
  housingRows: HousingAssignmentRow[] = [],
  lists: CensusLists = { students: [], unretained: [] },
): Promise<Buffer> {
  const wb = new XlsxWorkbook();
  const tables = lists.students.length
    ? buildReport(filterStudents(projectReportStudents(lists.students), DEFAULT_FILTERS))
    : tablesFromSnapshot(data);
  writeSummary(wb, data);
  writeHistorical(wb, data);
  writeCensusReport(wb, data, tables);
  writeAttrition(wb, data);
  writeListSheet(
    wb,
    "FA26 Census Raw Data",
    [
      "PCID",
      "First_Name",
      "Last_Name",
      "Incoming/Returning",
      "State",
      "Religion",
      "Cath/Chris/Other",
      "Ethnicity",
      "Gender",
      "Program",
      "College_Attend",
      "Curriculum",
      "Curriculum Name",
      "Class_Level",
      "Full_Part",
      "City",
      "Credits",
      "Cumulative GPA",
      "Cumulative Earned Credits",
      "Resident / Commuter",
      "Athletic Assoc. (Athlet.)",
      "Athlete/Non-Athlete",
      "Honors",
      "FSP",
      "Household",
      "Institute",
      "Mary's Marines",
      "Application Decision",
      "Degree",
      "Email",
    ],
    [14, 16, 18, 16, 8, 16, 14, 12, 10, 12, 14, 12, 22, 12, 10, 16, 10, 12, 14, 16, 22, 16, 10, 10, 12, 12, 14, 16, 10, 32],
    lists.students.map(rawRow),
  );
  writeListSheet(
    wb,
    "All Not Retained",
    [
      "PCID",
      "First",
      "Last",
      "Retention",
      "Final GPA",
      "FSP",
      "Household",
      "Mary's Marines",
      "Honors",
      "Sport",
      "State",
      "Gender",
      "Class",
      "College_Attend",
      "Incoming/Returning",
      "Program",
    ],
    [14, 16, 18, 14, 12, 10, 12, 16, 10, 18, 8, 10, 12, 14, 16, 12],
    lists.unretained.map(unretainedRow),
  );
  if (housingRows.length) writeHousing(wb, housingRows);
  writeSources(wb, data, housingRows.length, lists.students.length, lists.unretained.length);
  return wb.writeBuffer();
}
