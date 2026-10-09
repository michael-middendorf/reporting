import { XlsxWorkbook, type CellStyle, type XlsxSheet } from "@/lib/reports/census/xlsx";
import type { CurrentTable, MajorsReady, TrendTable } from "./shape";

const NAVY = "1A3F6F";
const HEAD: CellStyle = { bold: true, color: "FFFFFF", fill: NAVY, hAlign: "center", vAlign: "center", wrap: true };
const HEAD_LEFT: CellStyle = { ...HEAD, hAlign: "left" };
const TITLE: CellStyle = { bold: true, size: 14, color: NAVY };
const NOTE: CellStyle = { italic: true, color: "4A6490" };
const INT: CellStyle = { numFmt: "int" };
const PCT: CellStyle = { numFmt: "pct" };
const TOTAL: CellStyle = { bold: true, fill: "F0F5FF" };

function headerRow(ws: XlsxSheet, row: number, labels: string[]) {
  labels.forEach((label, i) => ws.set(row, i + 1, label, i === 0 ? HEAD_LEFT : HEAD));
}

function num(n: number | null): number | string {
  return n == null ? "" : n;
}

function incomingSheet(wb: XlsxWorkbook, p: MajorsReady) {
  const inc = p.incoming;
  const ws = wb.addSheet(`Incoming ${inc.year}`);
  ws.set(1, 1, `Accepted Applicants by Major, Fall ${inc.year}`, TITLE);
  ws.set(2, 1, "Counts only. % is the share of the grand total.", NOTE);
  headerRow(ws, 4, [
    "Major",
    "Degree",
    "FTCA All Accepts",
    "FTCA Active Deposits",
    "Transfer All Accepts",
    "Transfer Active Deposits",
    "Total Accepts",
    "Accepts %",
    "Total Active Deposits",
    "Deposits %",
    `Prior Year (${inc.priorYear}) Accepts`,
    `Prior Year (${inc.priorYear}) Deposits`,
  ]);
  let r = 5;
  for (const row of inc.rows) {
    ws.set(r, 1, row.major);
    ws.set(r, 2, row.degreeLabel);
    ws.set(r, 3, row.ftcaAccepts, INT);
    ws.set(r, 4, row.ftcaDeposits, INT);
    ws.set(r, 5, row.tranAccepts, INT);
    ws.set(r, 6, row.tranDeposits, INT);
    ws.set(r, 7, row.totalAccepts, INT);
    ws.set(r, 8, row.acceptsPct, PCT);
    ws.set(r, 9, row.totalDeposits, INT);
    ws.set(r, 10, row.depositsPct, PCT);
    ws.set(r, 11, num(row.priorAccepts), INT);
    ws.set(r, 12, num(row.priorDeposits), INT);
    r += 1;
  }
  const t = inc.totals;
  ws.set(r, 1, "Grand Total", TOTAL);
  ws.set(r, 2, "", TOTAL);
  const vals: [number | string, CellStyle][] = [
    [t.ftcaAccepts, INT],
    [t.ftcaDeposits, INT],
    [t.tranAccepts, INT],
    [t.tranDeposits, INT],
    [t.totalAccepts, INT],
    [t.acceptsPct, PCT],
    [t.totalDeposits, INT],
    [t.depositsPct, PCT],
    [num(t.priorAccepts), INT],
    [num(t.priorDeposits), INT],
  ];
  vals.forEach(([v, s], i) => ws.set(r, i + 3, v, { ...s, ...TOTAL }));
  ws.box(4, 1, r, 12);
  ws.width(1, 40);
  ws.width(2, 12);
  for (let c = 3; c <= 12; c++) ws.width(c, 13);
  ws.height(4, 32);
  ws.freezeRows = 4;
}

function currentSheet(wb: XlsxWorkbook, name: string, title: string, table: CurrentTable) {
  const ws = wb.addSheet(name);
  ws.set(1, 1, title, TITLE);
  ws.set(2, 1, "Active registered and active deposited undergraduates. Counts only.", NOTE);
  headerRow(ws, 4, ["Curriculum", "Freshman", "Sophomore", "Junior", "Senior", "Total", "% Overall", "Rank"]);
  let r = 5;
  for (const row of table.rows) {
    ws.set(r, 1, row.label);
    ws.set(r, 2, row.fres, INT);
    ws.set(r, 3, row.soph, INT);
    ws.set(r, 4, row.jr, INT);
    ws.set(r, 5, row.sr, INT);
    ws.set(r, 6, row.total, INT);
    ws.set(r, 7, row.pct, PCT);
    ws.set(r, 8, row.rank, INT);
    r += 1;
  }
  const t = table.totals;
  ws.set(r, 1, "Total", TOTAL);
  [t.fres, t.soph, t.jr, t.sr, t.total].forEach((v, i) => ws.set(r, i + 2, v, { ...INT, ...TOTAL }));
  ws.set(r, 7, t.pct, { ...PCT, ...TOTAL });
  ws.set(r, 8, "", TOTAL);
  ws.box(4, 1, r, 8);
  ws.width(1, 42);
  for (let c = 2; c <= 8; c++) ws.width(c, 12);
  ws.freezeRows = 4;
}

function trendBlock(ws: XlsxSheet, start: number, title: string, table: TrendTable): number {
  ws.set(start, 1, title, { bold: true, color: NAVY });
  const change5 = table.compareYear ? `Change vs Fall ${table.compareYear}` : "Change vs 5 years ago";
  const labels = ["Curriculum", ...table.years.map((y) => `Fall ${y}`), "Change vs prior fall", change5];
  headerRow(ws, start + 1, labels);
  let r = start + 2;
  for (const row of [...table.rows, table.totals]) {
    const style = row === table.totals ? TOTAL : {};
    ws.set(r, 1, row.label, style);
    row.counts.forEach((v, i) => ws.set(r, i + 2, v, { ...INT, ...style }));
    ws.set(r, table.years.length + 2, num(row.changePrior), { ...INT, ...style });
    ws.set(r, table.years.length + 3, num(row.change5), { ...INT, ...style });
    r += 1;
  }
  ws.box(start + 1, 1, r - 1, labels.length);
  return r + 1;
}

function trendsSheet(wb: XlsxWorkbook, p: MajorsReady) {
  const ws = wb.addSheet("Trends");
  ws.set(1, 1, "Majors and Minors Trends (Fall terms)", TITLE);
  let r = 3;
  r = trendBlock(ws, r, "Majors (with Undeclared)", p.trends.majorsWithUndeclared);
  r = trendBlock(ws, r, "Minors", p.trends.minors);

  const inc = p.trends.incoming;
  ws.set(r, 1, "Incoming Accepts and Active Deposits by Major", { bold: true, color: NAVY });
  const yearLabel = (y: string) => `Fall ${y}${inc.inProgress.includes(y) ? " (in progress)" : ""}`;
  const labels = [
    "Major",
    ...inc.years.map((y) => `${yearLabel(y)} Accepts`),
    ...inc.years.map((y) => `${yearLabel(y)} Deposits`),
    "Accepts change vs prior",
    "Deposits change vs prior",
  ];
  headerRow(ws, r + 1, labels);
  let row = r + 2;
  for (const line of [...inc.rows, inc.totals]) {
    const style = line === inc.totals ? TOTAL : {};
    ws.set(row, 1, line.label, style);
    line.accepts.forEach((v, i) => ws.set(row, i + 2, v, { ...INT, ...style }));
    line.deposits.forEach((v, i) => ws.set(row, i + 2 + inc.years.length, v, { ...INT, ...style }));
    ws.set(row, 2 + 2 * inc.years.length, num(line.acceptsChangePrior), { ...INT, ...style });
    ws.set(row, 3 + 2 * inc.years.length, num(line.depositsChangePrior), { ...INT, ...style });
    row += 1;
  }
  ws.box(r + 1, 1, row - 1, labels.length);
  ws.width(1, 42);
  for (let c = 2; c <= labels.length; c++) ws.width(c, 14);
}

/** Aggregate counts only; there is no per-student sheet. */
export function buildMajorsWorkbook(p: MajorsReady): Buffer {
  const wb = new XlsxWorkbook();
  incomingSheet(wb, p);
  const term = p.current.label;
  currentSheet(wb, "Majors", `Undergraduate Majors (without Undeclared), ${term}`, p.current.majors);
  currentSheet(wb, "Majors incl Undeclared", `Undergraduate Majors (with Undeclared), ${term}`, p.current.majorsWithUndeclared);
  currentSheet(wb, "Minors", `Undergraduate Minors, ${term}`, p.current.minors);
  trendsSheet(wb, p);
  return wb.writeBuffer();
}

export function majorsFileName(p: MajorsReady): string {
  const term = p.current.label.replace(/\s+/g, "_") || "term";
  return `Majors_and_Minors_${term}_Incoming_${p.incoming.year || "none"}.xlsx`;
}
