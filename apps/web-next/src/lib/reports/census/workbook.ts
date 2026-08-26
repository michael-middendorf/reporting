import type { HousingAssignmentRow } from "./residency";
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
const HEADER = "DDEBF7";
const TOTAL = "F4F7FB";

const TITLE: CellStyle = { bold: true, size: 16, color: NAVY };
const TITLE20: CellStyle = { bold: true, size: 20, color: NAVY };
const TITLE18: CellStyle = { bold: true, size: 18, color: NAVY };
const SECTION: CellStyle = { bold: true, size: 11, color: NAVY };
const HEADER_STYLE: CellStyle = { bold: true, size: 10, color: NAVY, fill: HEADER, vAlign: "middle" };
const TOTAL_STYLE: CellStyle = { bold: true, size: 11, fill: TOTAL };
const NOTE: CellStyle = { italic: true, size: 10 };
const LABEL_BOLD: CellStyle = { bold: true, size: 12 };
const INDENT: CellStyle = { indent: 1 };

function fallLabel(year: number): string {
  return `Fall ${year}`;
}

function faLabel(year: number): string {
  return `FA${String(year).slice(2)}`;
}

function writeHeaders(ws: XlsxSheet, row: number, col: number, headers: string[]) {
  headers.forEach((h, i) => {
    ws.set(row, col + i, h, { ...HEADER_STYLE, hAlign: "center" });
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
  ws.set(startRow, startCol, title, SECTION);
  writeHeaders(ws, startRow + 1, startCol, headers);
  let r = startRow + 2;
  for (const row of rows) {
    writeRow(ws, r, startCol, row);
    for (const c of opts?.intCols || []) applyFmt(ws, r, startCol + c, "int");
    for (const c of opts?.pctCols || []) applyFmt(ws, r, startCol + c, "pct");
    r += 1;
  }
  if (opts?.total && rows.length) {
    styleTotal(ws, r - 1, startCol, startCol + headers.length - 1);
  }
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
    { label: "Graduate MA", c: s.gradMa },
    { label: "Graduate PhD", c: s.gradPhd },
    { label: "Graduate MBA", c: s.gradMba },
    { label: "Graduate MEdCl", c: s.gradMedcl },
    { label: "Lux Mundi (graduate)", c: s.luxMundiGrad },
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
    { label: "Graduate MA", key: "gradMa" },
    { label: "Graduate PhD", key: "gradPhd" },
    { label: "Graduate MBA", key: "gradMba" },
    { label: "Graduate MEdCl", key: "gradMedcl" },
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
}

function writeCensusReport(wb: XlsxWorkbook, data: CensusSnapshot) {
  const ws = wb.addSheet(`${faLabel(data.historical.years[0] ?? 2026)} Census Report`);
  ws.gridLines = false;
  [6, 16, 12, 12, 3, 28, 12, 12, 3, 22, 14, 16, 14, 3, 3, 38, 14, 14, 14, 12].forEach((w, i) => {
    ws.width(i + 1, w);
  });

  ws.merge(1, 1, 1, 18);
  ws.set(1, 1, `${data.term} Census Report — Undergraduate Statistics`, TITLE20);
  ws.height(1, 26);

  const u = data.ug;
  writeCountTable(ws, 3, 2, "States", ["States", "Students", "Percentage"], labeledRows(u.states), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });

  const countryEnd = writeCountTable(
    ws,
    3,
    6,
    "Countries (F1 / international)",
    ["Country", "Students", "Percentage"],
    labeledRows(u.countries),
    { intCols: [1], pctCols: [2], total: true },
  );
  ws.set(countryEnd, 6, `*${data.kpis.foreignCountries} countries of F1 visa holders`, NOTE);

  writeCountTable(ws, 3, 10, "Gender", ["Gender", "Students", "Percentage"], labeledRows(u.gender), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });

  const classRows: CellValue[][] = [
    ...u.classLevel.map((r) => [r.label, r.n, r.fullTime ?? null]),
    ["Total", u.classLevel.reduce((s, r) => s + r.n, 0), u.classLevel.reduce((s, r) => s + (r.fullTime ?? 0), 0)],
  ];
  writeCountTable(ws, 3, 16, "Class Level", ["Class Level", "Students", "Full Time"], classRows, {
    intCols: [1, 2],
    total: true,
  });

  const sportRows: CellValue[][] = [
    ...u.sports.map((r) => [r.label, r.n, r.pctOfAthletes ?? null, r.pctOfAll ?? null]),
    ["Total", u.sports.reduce((s, r) => s + r.n, 0), 1, u.sports.reduce((s, r) => s + (r.pctOfAll ?? 0), 0)],
  ];
  writeCountTable(
    ws,
    10,
    10,
    "Sport",
    ["Sport", "Students", "% of Student Athletes", "% of All Students"],
    sportRows,
    { intCols: [1], pctCols: [2, 3], total: true },
  );

  const resNote = data.housing
    ? `eRez ${data.housing.session || ""} · ${data.housing.ugMatched} UG matched`.trim()
    : "Housing pending";
  const resEnd = writeCountTable(
    ws,
    12,
    16,
    "Student Residency",
    ["Student Residency", "Total", "Percentage"],
    labeledRows(u.residency),
    { intCols: [1], pctCols: [2], total: true },
  );
  ws.set(resEnd, 16, `*${resNote}. Other includes Middle Brook / unmapped buildings.`, NOTE);

  writeCountTable(ws, 21, 6, "Religion", ["Religion", "Students", "Percentage"], labeledRows(u.religion), {
    intCols: [1],
    pctCols: [2],
    total: true,
  });
  writeCountTable(
    ws,
    29,
    6,
    "All UG Students — Athlete / Non-Athlete",
    ["Athlete / Non-Athlete", "Students", "Percentage"],
    labeledRows(u.athlete),
    { intCols: [1], pctCols: [2], total: true },
  );
  writeCountTable(
    ws,
    35,
    6,
    "Incoming Students — Athlete / Non-Athlete",
    ["Athlete / Non-Athlete", "Students", "Percentage"],
    labeledRows(u.incomingAthlete),
    { intCols: [1], pctCols: [2], total: true },
  );

  writeCountTable(
    ws,
    21,
    16,
    "Graduation",
    ["", "All", ""],
    [
      ["Fall / Spring / Summer graduates", data.allUgRetention.graduates, ""],
      ["Retention pool (prior UG minus graduates)", data.allUgRetention.pool, ""],
    ],
    { intCols: [1] },
  );

  writeCountTable(
    ws,
    26,
    16,
    "Fall 2025 FTCA Retention Rate",
    ["", "", ""],
    [
      ["Fall 2025 FTCA cohort", data.ftcaAttrition.cohort, ""],
      ["Fall 2025 cohort enrolled for Fall 2026", data.ftcaAttrition.enrolledThisFall, ""],
      ["Retention rate F25–F26", data.ftcaAttrition.retentionRate, ""],
    ],
    { intCols: [1] },
  );
  applyFmt(ws, 29, 17, "pct");

  writeCountTable(
    ws,
    32,
    16,
    "Historical FTCA Retention Rate",
    ["", "Rate"],
    data.historicalFtcaRetention.map((r) => [r.label, r.rate]),
    { pctCols: [1] },
  );

  writeCountTable(
    ws,
    42,
    16,
    "Fall 2025 All UG Retention Rate",
    ["", "All"],
    [
      ["Fall 2025 degree-seeking UG", data.allUgRetention.priorUg],
      ["Fall 2025 UG enrolled for Fall 2026", data.allUgRetention.enrolledThisFall],
      ["Minus Fall, Spring, Summer graduates", data.allUgRetention.graduates],
      ["All-student retention rate F25–F26", data.allUgRetention.retentionRate],
    ],
    { intCols: [1] },
  );
  applyFmt(ws, 46, 17, "pct");

  writeCountTable(
    ws,
    49,
    16,
    "Historical All UG Retention Rate",
    ["", "Rate"],
    data.historicalAllUgRetention.map((r) => [r.label, r.rate]),
    { pctCols: [1] },
  );

  writeCountTable(
    ws,
    49,
    6,
    "Athletic Religious Association",
    ["Religion", "Students", "Percentage"],
    labeledRows(u.athleticReligion),
    { intCols: [1], pctCols: [2], total: true },
  );

  writeCountTable(
    ws,
    58,
    2,
    "Florida — Athlete / Non-Athlete",
    ["Florida", "Students", "Percentage"],
    labeledRows(u.floridaAthlete),
    { intCols: [1], pctCols: [2], total: true },
  );
  writeCountTable(
    ws,
    66,
    2,
    "Florida — Catholic / Non-Catholic",
    ["Florida", "Students", "Percentage"],
    labeledRows(u.floridaCatholic),
    { intCols: [1], pctCols: [2], total: true },
  );
  writeCountTable(
    ws,
    58,
    6,
    "Non-Florida & Catholic — Athlete / Non-Athlete",
    ["Non-Florida & Catholic", "Students", "Percentage"],
    labeledRows(u.nonFloridaCatholicAthlete),
    { intCols: [1], pctCols: [2], total: true },
  );
  writeCountTable(
    ws,
    66,
    6,
    `Honors Program (${u.honorsN.toLocaleString()})`,
    ["Class", "Students", "Percentage"],
    labeledRows(u.honorsByClass),
    { intCols: [1], pctCols: [2], total: true },
  );

  const loadRows: CellValue[][] = u.genderLoad.map((g) => [
    `${g.gender} ${g.incomingReturning}`,
    g.full,
    g.half,
    g.less,
    g.other,
    g.total,
  ]);
  loadRows.push([
    "Total",
    u.genderLoad.reduce((sum, g) => sum + g.full, 0),
    u.genderLoad.reduce((sum, g) => sum + g.half, 0),
    u.genderLoad.reduce((sum, g) => sum + g.less, 0),
    u.genderLoad.reduce((sum, g) => sum + g.other, 0),
    u.genderLoad.reduce((sum, g) => sum + g.total, 0),
  ]);
  writeCountTable(
    ws,
    74,
    2,
    "UG by Gender / Incoming-Returning / Load",
    ["Row Labels", "Full", "Half", "Less", "Other (THRE)", "Total"],
    loadRows,
    { intCols: [1, 2, 3, 4, 5], total: true },
  );

  const majorRows: CellValue[][] = [
    ...u.majors.map((m) => [m.label, m.freshman, m.sophomore, m.junior, m.senior, m.total]),
    [
      "Total",
      u.majors.reduce((sum, m) => sum + m.freshman, 0),
      u.majors.reduce((sum, m) => sum + m.sophomore, 0),
      u.majors.reduce((sum, m) => sum + m.junior, 0),
      u.majors.reduce((sum, m) => sum + m.senior, 0),
      u.majors.reduce((sum, m) => sum + m.total, 0),
    ],
  ];
  writeCountTable(
    ws,
    58,
    16,
    "Majors by class",
    ["Major", "Freshman", "Sophomore", "Junior", "Senior", "Total"],
    majorRows,
    { intCols: [1, 2, 3, 4, 5], total: true },
  );
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
  });
  ws.autoFilter = `A1:${cellRef(1, headers.length)}`;
  ws.freezeRows = 1;
}

function writeSources(wb: XlsxWorkbook, data: CensusSnapshot, housingCount: number) {
  const ws = wb.addSheet("Sources");
  ws.width(1, 28);
  ws.width(2, 80);
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
      "Not in this file",
      "Student-level registration raw data, FTCA retention raw data, and All Not Retained lists stay off the dashboard (same as the live census page). Tables on Summary / Historical / Census Report / Attrition match the FA25 workbook layout.",
    ],
    ["Still to add", data.pending.length ? data.pending.join("; ") : "None"],
  ];
  rows.forEach((row, i) => {
    ws.set(i + 3, 1, row[0], { bold: true });
    ws.set(i + 3, 2, row[1], { wrap: true });
    ws.height(i + 3, 32);
  });
}

export function censusFileName(data: CensusSnapshot, exported = new Date()): string {
  const stamp = exported.toISOString().slice(0, 10);
  const fa = faLabel(data.historical.years[0] ?? 2026);
  return `${fa}_Census_${data.status === "final" ? "Final" : "DRAFT"}_${stamp}.xlsx`;
}

export async function buildCensusWorkbook(
  data: CensusSnapshot,
  housingRows: HousingAssignmentRow[] = [],
): Promise<Buffer> {
  const wb = new XlsxWorkbook();
  writeSummary(wb, data);
  writeHistorical(wb, data);
  writeCensusReport(wb, data);
  writeAttrition(wb, data);
  if (housingRows.length) writeHousing(wb, housingRows);
  writeSources(wb, data, housingRows.length);
  return wb.writeBuffer();
}
