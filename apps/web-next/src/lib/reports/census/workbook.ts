import type { CensusLists, CensusRawStudent, UnretainedStudent } from "./lists";
import { isUgDegreeSeekingRow } from "./lists-core";
import {
  athleteOf,
  buildAllUgSplit,
  buildAssociationRetention,
  buildCrosstab,
  buildCrosstab2On,
  buildFtcaAttritionFromPrior,
  buildFtcaExtras,
  buildSportRetention,
  catholicOf,
  collectGpa,
  whiteOf,
  type CrosstabRow,
  type FtcaRawRow,
  type SportRetentionRow,
} from "./retention";
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
const NEEDS_DATA = "Needs data";

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
  border: { b: { s: "medium", c: GOLD } },
};
const TOTAL_STYLE: CellStyle = { bold: true, size: 11, fill: TOTAL_FILL, color: NAVY };
const NOTE: CellStyle = { italic: true, size: 10, color: "4A6A90" };
const NEEDS_STYLE: CellStyle = { italic: true, size: 10, color: GOLD };
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

function needsPlaceholder(colCount: number): CellValue[][] {
  const row: CellValue[] = Array.from({ length: colCount }, () => "");
  row[0] = NEEDS_DATA;
  return [row];
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
  const body = rows.length ? rows : needsPlaceholder(headers.length);
  const empty = !rows.length;
  let headerRow = startRow;
  if (title) {
    ws.set(startRow, startCol, title, SECTION);
    headerRow = startRow + 1;
  }
  writeHeaders(ws, headerRow, startCol, headers);
  let r = headerRow + 1;
  const lastCol = startCol + headers.length - 1;
  for (const [i, row] of body.entries()) {
    writeRow(ws, r, startCol, row);
    if (empty || row[0] === NEEDS_DATA) {
      for (let c = startCol; c <= lastCol; c++) ws.patch(r, c, NEEDS_STYLE);
    } else if (i % 2 === 1) {
      for (let c = startCol; c <= lastCol; c++) ws.patch(r, c, STRIPE);
    }
    if (!empty) {
      for (const c of opts?.intCols || []) applyFmt(ws, r, startCol + c, "int");
      for (const c of opts?.pctCols || []) applyFmt(ws, r, startCol + c, "pct");
    }
    r += 1;
  }
  if (opts?.total && rows.length) {
    styleTotal(ws, r - 1, startCol, lastCol);
  }
  ws.box(headerRow, startCol, r - 1, lastCol);
  for (let c = startCol; c <= lastCol; c++) {
    ws.patch(headerRow, c, { border: { b: { s: "medium", c: GOLD } } });
  }
  return r;
}

function crosstabCells(rows: CrosstabRow[], twoLabels = false): CellValue[][] {
  if (!rows.length) return [];
  if (twoLabels) {
    return rows.map((r) => [r.label, r.label2 || "", r.students, r.notRetained, r.retentionPct]);
  }
  return rows.map((r) => [r.label, r.students, r.notRetained, r.retentionPct]);
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
  if (!rows.length) {
    return writeCountTable(ws, startRow, startCol, "UG by Gender", headers, []);
  }
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

function realAppDecisions(rows: LabeledCount[]): LabeledCount[] {
  return rows.filter((r) => r.label && r.label !== "Not listed");
}

type ReportExtras = {
  hasPrior: boolean;
  sportRetention: SportRetentionRow[];
  appDecisionRetention: CrosstabRow[];
  catholicAthlete: CrosstabRow[];
  athleteGender: CrosstabRow[];
  athleteEthnicity: CrosstabRow[];
  residenceGender: CrosstabRow[];
  association: CrosstabRow[];
  ugSplit: ReturnType<typeof buildAllUgSplit>;
};

function writeCensusReport(wb: XlsxWorkbook, data: CensusSnapshot, tables: ReportTables, extra: ReportExtras) {
  const year = data.historical.years[0] ?? 2026;
  const fa = faLabel(year);
  const ws = wb.addSheet(`${fa} Census Report`);
  ws.gridLines = false;
  [6, 22, 14, 14, 14, 28, 14, 14, 16, 22, 16, 16, 16, 14, 3, 42, 14, 14, 14, 16, 14, 22].forEach((w, i) => {
    ws.width(i + 1, w);
  });

  ws.merge(1, 1, 1, 21);
  ws.set(1, 1, `${data.term} Census Report - Undergraduate Statistics`, TITLE20);
  ws.height(1, 26);

  const t = tables;
  const n = t.n;
  const col = { b: 2, f: 6, j: 10, p: 16 };
  const ug = extra.ugSplit;

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
  ws.set(f, col.f, t.countries.length ? `*${t.countries.length} Countries of F1 Visa Holders` : NEEDS_DATA, NOTE);
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
  f = writeCountTable(
    ws,
    f + 2,
    col.f,
    "Application Decisions",
    ["Type", "Students", "Percentage"],
    realAppDecisions(t.appDecisions).length ? labeledRows(realAppDecisions(t.appDecisions)) : [],
    { intCols: [1], pctCols: [2], total: true },
  );
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

  let j = writeCountTable(ws, 3, col.j, "", ["Gender", "Students", "Percentage"], labeledRows(t.gender), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });
  const sportRows: CellValue[][] = t.sports.length
    ? [
        ...t.sports.map((r) => [r.label, r.n, r.pctOfAthletes ?? null, r.pctOfAll ?? null]),
        ["Total", t.sports.reduce((s, r) => s + r.n, 0), "", ""],
      ]
    : [];
  j = writeCountTable(
    ws,
    j + 2,
    col.j,
    "",
    ["Sport", "Students", "% of Student Athletes", "% of All Students"],
    sportRows,
    { intCols: [1], pctCols: [2, 3], total: true },
  );
  j = writeCountTable(
    ws,
    j + 2,
    col.j,
    "Application Decisions Retention",
    ["Type", "Students", "# Non-Retained", "Retention %"],
    crosstabCells(extra.appDecisionRetention),
    { intCols: [1, 2], pctCols: [3], total: false },
  );
  j = writeCountTable(
    ws,
    j + 2,
    col.j,
    "Catholic/Non-Catholic",
    ["Catholic/Non-Catholic", "Athlete/Non-Athlete", "Students", "# Non-Retained", "Retention %"],
    crosstabCells(extra.catholicAthlete, true),
    { intCols: [2, 3], pctCols: [4] },
  );
  j = writeCountTable(
    ws,
    j + 2,
    col.j,
    "Athlete/Non-Athlete",
    ["Athlete/Non-Athlete", "Gender", "Students", "# Non-Retained", "Retention %"],
    crosstabCells(extra.athleteGender, true),
    { intCols: [2, 3], pctCols: [4] },
  );
  j = writeCountTable(
    ws,
    j + 2,
    col.j,
    "Athlete/Non-Athlete",
    ["Athlete/Non-Athlete", "Ethnicity", "Students", "# Non-Retained", "Retention %"],
    extra.athleteEthnicity.length
      ? extra.athleteEthnicity.map((r) => [r.label, r.label2 || "", r.students, r.notRetained, r.retentionPct])
      : [],
    { intCols: [2, 3], pctCols: [4] },
  );
  j = writeCountTable(
    ws,
    j + 2,
    col.j,
    "Residence Type",
    ["Residence Type", "Gender", "Students", "# Non-Retained", "Retention %"],
    crosstabCells(extra.residenceGender, true),
    { intCols: [2, 3], pctCols: [4] },
  );
  ws.set(j, col.j, "*Discounting Study Abroad, Online, and Middlebrooke Students", NOTE);
  j += 1;

  const classRows: CellValue[][] = t.classLevel.length
    ? [
        ...t.classLevel.map((r) => [r.label, r.n, r.fullTime ?? "", r.incoming ?? "", n ? r.n / n : null]),
        [
          "Total",
          t.classLevel.reduce((s, r) => s + r.n, 0),
          t.classLevel.reduce((s, r) => s + (r.fullTime ?? 0), 0),
          t.classLevel.reduce((s, r) => s + (r.incoming ?? 0), 0),
          "",
        ],
      ]
    : [];
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
  const resRows: CellValue[][] = t.residency.length
    ? [
        ...t.residency.map((r) => [r.label, r.n, r.pct ?? null, r.male ?? "", r.female ?? ""]),
        [
          "Total",
          t.residency.reduce((s, r) => s + r.n, 0),
          "",
          resHasGender ? t.residency.reduce((s, r) => s + (r.male ?? 0), 0) : "",
          resHasGender ? t.residency.reduce((s, r) => s + (r.female ?? 0), 0) : "",
        ],
      ]
    : [];
  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "",
    ["Student Residency", "Total", "Percentage", "Male", "Female"],
    resRows,
    { intCols: [1, 3, 4], pctCols: [2], total: true },
  );
  ws.set(p, col.p, data.housing ? "*No UG in Middlebrooke" : "Housing pending — Needs data", NOTE);
  p += 2;

  p = writeCountTable(
    ws,
    p,
    col.p,
    "Graduation",
    ["Graduation", "All", "Athletes", "Non-Athletes"],
    extra.hasPrior
      ? [
          [
            "Graduated Fall, Spring, Summer",
            ug.all.graduated,
            ug.athletes.graduated,
            ug.nonAthletes.graduated,
          ],
          [
            "Percentage",
            "",
            ug.all.graduated ? ug.athletes.graduated / ug.all.graduated : "",
            ug.all.graduated ? ug.nonAthletes.graduated / ug.all.graduated : "",
          ],
        ]
      : [
          ["Graduated Fall, Spring, Summer", data.allUgRetention.graduates, NEEDS_DATA, NEEDS_DATA],
          ["Percentage", "", NEEDS_DATA, NEEDS_DATA],
        ],
    { intCols: [1, 2, 3] },
  );
  applyFmt(ws, p - 1, col.p + 2, "pct");
  applyFmt(ws, p - 1, col.p + 3, "pct");

  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "Fall 2025 FTCA Retention Rate",
    ["Fall 2025 FTCA Retention Rate", ""],
    [
      ["Fall 2025 FTCA Cohort (Incoming + FTCA)", data.ftcaAttrition.cohort],
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
    data.historicalFtcaRetention.length
      ? data.historicalFtcaRetention.map((r) => [r.label, r.rate])
      : [],
    { pctCols: [1] },
  );

  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "Fall 2025 All UG Retention Rate",
    ["Fall 2025 All UG Retention Rate", "All", "Athletes", "Non-Athletes"],
    extra.hasPrior
      ? [
          ["Fall 2025 All UG Retention Rate", ug.all.students, ug.athletes.students, ug.nonAthletes.students],
          [
            "Fall 2025 All UG Enrolled for Fall 2026",
            ug.all.enrolled,
            ug.athletes.enrolled,
            ug.nonAthletes.enrolled,
          ],
          [
            "Minus Fall, Spring, Summer Graduates",
            ug.all.graduated,
            ug.athletes.graduated,
            ug.nonAthletes.graduated,
          ],
          [
            "All Student Retention Rate F25-F26",
            ug.all.retentionPct,
            ug.athletes.retentionPct,
            ug.nonAthletes.retentionPct,
          ],
        ]
      : [
          ["Fall 2025 All UG Retention Rate", data.allUgRetention.priorUg, NEEDS_DATA, NEEDS_DATA],
          ["Fall 2025 All UG Enrolled for Fall 2026", data.allUgRetention.enrolledThisFall, NEEDS_DATA, NEEDS_DATA],
          ["Minus Fall, Spring, Summer Graduates", data.allUgRetention.graduates, NEEDS_DATA, NEEDS_DATA],
          ["All Student Retention Rate F25-F26", data.allUgRetention.retentionRate, NEEDS_DATA, NEEDS_DATA],
        ],
    { intCols: [1, 2, 3] },
  );
  applyFmt(ws, p - 1, col.p + 1, "pct");
  applyFmt(ws, p - 1, col.p + 2, "pct");
  applyFmt(ws, p - 1, col.p + 3, "pct");

  p = writeCountTable(
    ws,
    p + 2,
    col.p,
    "Historical All UG Retention Rate",
    ["Historical All UG Retention Rate", "Rate"],
    data.historicalAllUgRetention.length
      ? data.historicalAllUgRetention.map((r) => [r.label, r.rate])
      : [],
    { pctCols: [1] },
  );

  const majorTotal = t.majors.reduce((s, m) => s + m.total, 0);
  const majorRows: CellValue[][] = t.majors.length
    ? [
        ...t.majors.map((m) => [
          m.label,
          m.freshman,
          m.sophomore,
          m.junior,
          m.senior,
          m.total,
          majorTotal ? m.total / majorTotal : null,
        ]),
        [
          "Totals",
          t.majors.reduce((s, m) => s + m.freshman, 0),
          t.majors.reduce((s, m) => s + m.sophomore, 0),
          t.majors.reduce((s, m) => s + m.junior, 0),
          t.majors.reduce((s, m) => s + m.senior, 0),
          majorTotal,
          "",
        ],
      ]
    : [];
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
  p += 2;

  p = writeCountTable(
    ws,
    p,
    col.p,
    "F25-F26 Additional Association Retention",
    ["Association", "Gender", "Students", "Graduated", "# Non-Retained", "Retention %"],
    extra.association.length
      ? extra.association.map((r) => [r.label, r.label2 || "", r.students, r.graduated, r.notRetained, r.retentionPct])
      : [],
    { intCols: [2, 3, 4], pctCols: [5] },
  );
  ws.set(p, col.p, "*Mary's Marines / FSP / Households: Needs data if the association column is blank on the raw sheet.", NOTE);

  // Gender load spans B–G (overlaps F). Athletic retention spans B–K (overlaps F and J).
  const genderEnd = writeGenderLoad(ws, Math.max(b, f) + 2, col.b, t.genderLoad);
  const sportRetentionRows: CellValue[][] = extra.sportRetention.length
    ? [
        ...extra.sportRetention.map((r) => [
          r.sport,
          r.roster,
          r.notRetained,
          r.retained,
          r.graduated,
          r.retentionPct,
          r.graduatedPct,
          r.retainedAvgGpa,
          r.notRetainedAvgGpa,
          r.notRetained3plus,
        ]),
        [
          "Total",
          extra.sportRetention.reduce((s, r) => s + r.roster, 0),
          extra.sportRetention.reduce((s, r) => s + r.notRetained, 0),
          extra.sportRetention.reduce((s, r) => s + r.retained, 0),
          extra.sportRetention.reduce((s, r) => s + r.graduated, 0),
          "",
          "",
          "",
          "",
          extra.sportRetention.reduce((s, r) => s + r.notRetained3plus, 0),
        ],
      ]
    : [];
  writeCountTable(
    ws,
    Math.max(genderEnd, j) + 2,
    col.b,
    "Athletic Retention",
    [
      "Team",
      "FA25 Roster #",
      "# Non-Retained",
      "# Retained",
      "# Graduated",
      "Retention %",
      "Graduated %",
      "Retained Avg. GPA",
      "Non-Retained Avg. GPA",
      "Non-Retained 3.0+ GPA",
    ],
    sportRetentionRows,
    { intCols: [1, 2, 3, 4, 9], pctCols: [5, 6], total: true },
  );
}

function attritionWithTotal(
  rows: AttritionRow[],
  rate: number,
  cols: "full" | "short" | "gpa" | "sport",
): CellValue[][] {
  if (!rows.length) return [];
  const body: CellValue[][] =
    cols === "full"
      ? rows.map((r) => [r.label, r.students, r.notRetained, r.retainedPct, r.shareOfNotRetained])
      : cols === "sport"
        ? rows.map((r) => [r.label, r.students, r.notRetained, r.shareOfNotRetained, r.retainedPct])
        : cols === "gpa"
          ? rows.map((r) => [r.label, r.students, r.notRetained, r.retainedPct])
          : rows.map((r) => [r.label, r.students, r.notRetained, r.retainedPct]);
  const students = rows.reduce((s, r) => s + r.students, 0);
  const notRetained = rows.reduce((s, r) => s + r.notRetained, 0);
  if (cols === "full") body.push(["Total", students, notRetained, rate, students ? 1 : null]);
  else if (cols === "sport") body.push(["Total", students, notRetained, "", rate]);
  else body.push(["Total", students, notRetained, rate]);
  return body;
}

function writeAttrition(
  wb: XlsxWorkbook,
  data: CensusSnapshot,
  extras: ReturnType<typeof buildFtcaExtras>,
) {
  const ws = wb.addSheet("FA25 FTCA Cohort Attrition");
  ws.gridLines = false;
  [18, 12, 16, 12, 16, 3, 24, 18, 14, 14, 14, 14, 3, 22, 12, 14, 14, 3, 3, 22, 16, 14, 14].forEach((w, i) => {
    ws.width(i + 1, w);
  });
  ws.set(1, 1, "Fall 2025 Incoming FTCA Cohort Attrition", TITLE18);
  ws.set(2, 1, "Cohort = listed as Incoming and FTCA on the Fall 2025 census. Athletic retention is on the Census Report sheet.", NOTE);

  const a = data.ftcaAttrition;
  const colA = 1;
  const colG = 7;
  const colN = 14;
  const colT = 20;

  let aRow = writeCountTable(
    ws,
    4,
    colA,
    "States",
    ["States", "Students", "# Non-Retained", "% Retained", "% of All Non-Retained"],
    attritionWithTotal(a.byState, a.retentionRate, "full"),
    { intCols: [1, 2], pctCols: [3, 4], total: true },
  );
  aRow = writeCountTable(
    ws,
    aRow + 2,
    colA,
    "Male - Florida",
    ["Catholic/Non-Catholic", "Athlete/Non-Athlete", "Students", "# Non-Retained", "% Retained"],
    crosstabCells(extras.byMaleFlorida, true),
    { intCols: [2, 3], pctCols: [4] },
  );

  let gRow = writeCountTable(
    ws,
    4,
    colG,
    "Athlete",
    ["Athlete", "Students", "# Non-Retained", "% Retained"],
    attritionWithTotal(a.byAthlete, a.retentionRate, "short"),
    { intCols: [1, 2], pctCols: [3], total: true },
  );
  gRow = writeCountTable(
    ws,
    gRow + 2,
    colG,
    "Sport Primary",
    ["Sport Primary", "Students", "Non-Retained", "% of All Non-Retained", "% Retained"],
    attritionWithTotal(a.bySport, a.retentionRate, "sport"),
    { intCols: [1, 2], pctCols: [3, 4], total: true },
  );
  gRow = writeCountTable(
    ws,
    gRow + 2,
    colG,
    "Catholic/Non-Catholic",
    ["Catholic/Non-Catholic", "Athlete/Non-Athlete", "Students", "# Non-Retained", "% Retained"],
    a.byCatholicAthlete.length
      ? a.byCatholicAthlete.map((r) => {
          const [cath, ath] = r.label.split(" / ");
          return [cath || r.label, ath || "", r.students, r.notRetained, r.retainedPct];
        })
      : [],
    { intCols: [2, 3], pctCols: [4] },
  );
  gRow = writeCountTable(
    ws,
    gRow + 2,
    colG,
    "Athlete",
    ["Athlete", "Gender", "Students", "# Non-Retained", "% Retained"],
    crosstabCells(extras.byAthleteGender, true),
    { intCols: [2, 3], pctCols: [4] },
  );
  writeCountTable(
    ws,
    gRow + 2,
    colG,
    "Ethnicity",
    ["Ethnicity", "Athlete/Non-Athlete", "Students", "# Non-Retained", "% Retained"],
    crosstabCells(extras.byEthnicityAthlete, true),
    { intCols: [2, 3], pctCols: [4] },
  );

  let nRow = writeCountTable(
    ws,
    4,
    colN,
    "Ethnicity",
    ["Ethnicity", "Students", "# Non-Retained", "% Retained"],
    attritionWithTotal(a.byEthnicity, a.retentionRate, "short"),
    { intCols: [1, 2], pctCols: [3], total: true },
  );
  nRow = writeCountTable(
    ws,
    nRow + 2,
    colN,
    "Resident / Commuter",
    ["Resident / Commuter", "Gender", "Students", "# Non-Retained", "% Retained"],
    crosstabCells(extras.byResidencyGender, true),
    { intCols: [2, 3], pctCols: [4] },
  );
  nRow = writeCountTable(
    ws,
    nRow + 2,
    colN,
    "HS GPA Ranges",
    ["HS GPA Ranges", "Students", "# Non-Retained", "% Retained"],
    [],
    { intCols: [1, 2], pctCols: [3] },
  );
  writeCountTable(
    ws,
    nRow + 2,
    colN,
    "Application Decision",
    ["Application Decision", "Students", "# Non-Retained", "% Retained"],
    extras.byAppDecision.every((r) => r.label === "Not listed")
      ? []
      : crosstabCells(extras.byAppDecision),
    { intCols: [1, 2], pctCols: [3] },
  );

  let tRow = writeCountTable(
    ws,
    4,
    colT,
    "AMU GPA Ranges",
    ["AMU GPA Ranges", "Students", "# Non-Retained", "% Retained"],
    attritionWithTotal(a.byGpa, a.retentionRate, "gpa"),
    { intCols: [1, 2], pctCols: [3], total: true },
  );
  tRow = writeCountTable(
    ws,
    tRow + 2,
    colT,
    "HS GPA Ranges (Athletes)",
    ["HS GPA Ranges", "Students", "# Non-Retained", "% Retained"],
    [],
    { intCols: [1, 2], pctCols: [3] },
  );
  tRow = writeCountTable(
    ws,
    tRow + 2,
    colT,
    "HS GPA 2.9-3.49",
    ["HS GPA Ranges", "Students", "# Non-Retained", "% Retained"],
    [],
    { intCols: [1, 2], pctCols: [3] },
  );
  writeCountTable(
    ws,
    tRow + 2,
    colT,
    "HS GPA 2.9-3.49 Athletes",
    ["HS GPA Ranges", "Students", "# Non-Retained", "% Retained"],
    [],
    { intCols: [1, 2], pctCols: [3] },
  );
}

function writeFtcaRaw(wb: XlsxWorkbook, rows: FtcaRawRow[]) {
  writeListSheet(
    wb,
    "F25-F26 FTCA Retention Raw Data",
    [
      "First",
      "Last",
      "Retained F25?",
      "PCID",
      "FTCA",
      "Religious Affiliation",
      "Catholic, Christian, Other",
      "Catholic Non-Catholic",
      "Fall 25 Athletic Association",
      "Fall 25 Curriculum",
      "Fall 25 FULL PART TIME",
      "Fall 25 Credits",
      "Fall 25 GPA",
      "Fall 25 Res Comm",
      "Fall 26 Athletic Association",
      "Fall 26 Curriculum",
      "Fall 26 Class",
      "Fall 26 FULL PART TIME",
      "Fall 26 Credits",
      "Fall 26 GPA",
      "Fall 26 Res Comm",
      "DOB",
      "Gender",
      "Ethnicity",
      "HS GPA",
      "City",
      "State",
      "PCID",
    ],
    [14, 16, 14, 14, 10, 18, 18, 16, 22, 16, 14, 12, 12, 14, 22, 16, 12, 14, 12, 12, 14, 14, 10, 12, 10, 14, 8, 14],
    rows.map((r) => [
      r.first,
      r.last,
      r.retained,
      r.pcid,
      r.ftca,
      r.religion,
      r.cathGroup,
      r.catholicNonCatholic,
      r.fa25Sport,
      r.fa25Curriculum,
      r.fa25FullPart,
      r.fa25Credits,
      r.fa25Gpa,
      r.fa25Residency,
      r.fa26Sport,
      r.fa26Curriculum,
      r.fa26Class,
      r.fa26FullPart,
      r.fa26Credits,
      r.fa26Gpa,
      r.fa26Residency,
      r.dob,
      r.gender,
      r.ethnicity,
      r.hsGpa,
      r.city,
      r.state,
      r.pcid,
    ]),
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

function emptyCol(rows: CellValue[][], col: number): boolean {
  return rows.every((row) => {
    const v = row[col];
    return v == null || v === "";
  });
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
  widths.forEach((w, i) => ws.width(i + 1, w));
  const missing = headers.map((_, c) => emptyCol(rows, c));
  const labeled = headers.map((h, c) => (missing[c] ? `${h} (Needs data)` : h));
  writeHeaders(ws, 1, 1, labeled);
  if (!rows.length) {
    ws.set(2, 1, "Needs data — no student-level rows published yet.", NEEDS_STYLE);
    for (let c = 2; c <= headers.length; c++) ws.set(2, c, NEEDS_DATA, NEEDS_STYLE);
    ws.box(1, 1, 2, headers.length);
    return;
  }
  rows.forEach((row, i) => {
    const filled = row.map((v, c) => (missing[c] && (v == null || v === "") ? NEEDS_DATA : v ?? ""));
    writeRow(ws, i + 2, 1, filled);
    if (i % 2 === 1) {
      for (let c = 1; c <= headers.length; c++) ws.patch(i + 2, c, STRIPE);
    }
    missing.forEach((isMissing, c) => {
      if (isMissing) ws.patch(i + 2, c + 1, NEEDS_STYLE);
    });
  });
  ws.box(1, 1, rows.length + 1, headers.length);
  for (let c = 1; c <= headers.length; c++) {
    ws.patch(1, c, { border: { b: { s: "medium", c: GOLD } } });
  }
  ws.autoFilter = `A1:${cellRef(1, headers.length)}`;
  ws.freezeRows = 1;
}

const CENSUS_RAW_HEADERS = [
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
  "Athletic Type",
  "Roster Status",
  "Honors",
  "FSP",
  "Household",
  "Institute",
  "Mary's Marines",
  "Application Decision",
  "Degree",
  "Email",
  "Citizenship",
  "Visa",
  "DOB",
  "HS GPA",
];

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
    s.athleticType || "",
    s.rosterStatus || "",
    s.honors,
    s.fsp,
    s.household,
    s.institute,
    s.marines,
    s.appDecision,
    s.degree,
    s.email,
    s.citizenship,
    s.visa,
    s.dob || "",
    s.hsGpa ?? "",
  ];
}

const UNRETAINED_HEADERS = [
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
];

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
      "Registration",
      "Fall 2026 Registration Status-26.xlsx. All students = every PCID on that file. UG degree-seeking = Program UNDERG and College Attend not DUAL, EACO, or ND. Incoming = not on the Fall 2025 census.",
    ],
    [
      "Raw data",
      rawCount
        ? `${rawCount.toLocaleString()} students on FA26 Census Raw Data (registration spine; residency filled from eRez when matched).`
        : "Student-level FA26 file is not in the census cache yet.",
    ],
    [
      "Graduates",
      "PowerCampus Graduated - All (Graduated %2D All-13.xlsx). Intervening year is Fall 2025, Spring 2026, and Summer 2026.",
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
  lists: CensusLists = { students: [], unretained: [], prior: [], graduates: [] },
  ftcaRaw: FtcaRawRow[] = [],
): Promise<Buffer> {
  const wb = new XlsxWorkbook();
  const tables = lists.students.length
    ? buildReport(filterStudents(projectReportStudents(lists.students), DEFAULT_FILTERS))
    : tablesFromSnapshot(data);
  const currentIds = lists.students.map((s) => s.pcid);
  const gpa = collectGpa(lists);
  if (lists.prior.length) {
    data.ftcaAttrition = buildFtcaAttritionFromPrior(lists.prior, currentIds, lists.graduates, gpa);
    const ug = buildAllUgSplit(lists.prior, currentIds, lists.graduates);
    data.allUgRetention = {
      priorUg: ug.all.students,
      graduates: ug.all.graduated,
      pool: ug.all.students - ug.all.graduated,
      enrolledThisFall: ug.all.enrolled,
      notRetained: ug.all.notRetained,
      retentionRate: ug.all.retentionPct ?? 0,
    };
  }
  const extra: ReportExtras = {
    hasPrior: lists.prior.length > 0,
    sportRetention: lists.prior.length
      ? buildSportRetention(lists.prior, currentIds, lists.graduates, [], gpa)
      : [],
    appDecisionRetention: lists.prior.length
      ? buildCrosstab(lists.prior, currentIds, lists.graduates, (s) => s.appDecision || "Not listed").filter(
          (r) => r.label !== "Not listed",
        )
      : [],
    catholicAthlete: lists.prior.length
      ? buildCrosstab2On(
          lists.prior.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend)),
          currentIds,
          lists.graduates,
          catholicOf,
          athleteOf,
        )
      : [],
    athleteGender: lists.prior.length
      ? buildCrosstab2On(
          lists.prior.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend)),
          currentIds,
          lists.graduates,
          athleteOf,
          (s) => s.gender || "—",
        )
      : [],
    athleteEthnicity: lists.prior.length
      ? buildCrosstab2On(
          lists.prior.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend)),
          currentIds,
          lists.graduates,
          athleteOf,
          whiteOf,
        )
      : [],
    residenceGender: lists.prior.length
      ? buildCrosstab2On(
          lists.prior.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend)),
          currentIds,
          lists.graduates,
          (s) => s.residency || "Not listed",
          (s) => s.gender || "—",
        )
      : [],
    association: lists.prior.length ? buildAssociationRetention(lists.prior, currentIds, lists.graduates) : [],
    ugSplit: lists.prior.length
      ? buildAllUgSplit(lists.prior, currentIds, lists.graduates)
      : {
          all: {
            students: data.allUgRetention.priorUg,
            enrolled: data.allUgRetention.enrolledThisFall,
            graduated: data.allUgRetention.graduates,
            notRetained: data.allUgRetention.notRetained,
            retentionPct: data.allUgRetention.retentionRate,
          },
          athletes: { students: 0, enrolled: 0, graduated: 0, notRetained: 0, retentionPct: null },
          nonAthletes: { students: 0, enrolled: 0, graduated: 0, notRetained: 0, retentionPct: null },
        },
  };
  const ftcaExtras = lists.prior.length
    ? buildFtcaExtras(lists.prior, currentIds, lists.graduates)
    : {
        byAthleteGender: [],
        byEthnicityAthlete: [],
        byResidencyGender: [],
        byAppDecision: [],
        byMaleFlorida: [],
      };

  writeSummary(wb, data);
  writeHistorical(wb, data);
  writeCensusReport(wb, data, tables, extra);
  writeAttrition(wb, data, ftcaExtras);
  writeFtcaRaw(wb, ftcaRaw);
  writeListSheet(
    wb,
    "FA26 Census Raw Data",
    CENSUS_RAW_HEADERS,
    [14, 16, 18, 16, 8, 16, 14, 12, 10, 12, 14, 12, 22, 12, 10, 16, 10, 12, 14, 16, 16, 22, 16, 16, 22, 10, 10, 12, 12, 14, 16, 10, 32, 12, 12, 10],
    lists.students.map(rawRow),
  );
  writeListSheet(
    wb,
    "All Not Retained",
    UNRETAINED_HEADERS,
    [14, 16, 18, 14, 12, 10, 12, 16, 10, 18, 8, 10, 12, 14, 16, 12],
    lists.unretained.map(unretainedRow),
  );
  if (housingRows.length) writeHousing(wb, housingRows);
  writeSources(wb, data, housingRows.length, lists.students.length, lists.unretained.length);
  return wb.writeBuffer();
}
