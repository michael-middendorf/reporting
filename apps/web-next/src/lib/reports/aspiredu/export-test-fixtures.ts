/** FAKE fixture data for the Academic Affairs export tests. No real students. */
import type { CensusRawStudent } from "../census/lists-core";
import { colLetter } from "../census/xlsx";
import { CENSUS_RAW_KEYS } from "./census-fields";

export function fakeCensus(overrides: Partial<CensusRawStudent> = {}): CensusRawStudent {
  const base = Object.fromEntries(CENSUS_RAW_KEYS.map((k) => [k, ""])) as unknown as CensusRawStudent;
  return { ...base, declaredMajors: [], program: "UNDERG", collegeAttend: "RETURN", ...overrides };
}

export function fakeCourse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    studentKey: "sk-1",
    studentHmac: "hmac-1",
    courseKey: "ck-1",
    firstName: "Alex",
    lastName: "Example",
    email: "alex.example@my.avemaria.edu",
    studentSisId: "000111",
    course: "THEO 101 Intro",
    courseSisId: "THEO101",
    sectionSisId: "THEO101-01",
    courseTerm: "Fall 2026",
    courseGrade: 91,
    courseRiskScore: 2,
    risk: 3,
    missingAssignments: 1,
    zeroAssignments: 0,
    courseLda: "2026-09-20T14:00:00Z",
    courseLastAccess: "2026-09-21T09:00:00Z",
    latestAttendance: "2026-09-19",
    lastLogin: "2026-09-22T08:00:00Z",
    ...overrides,
  };
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Sheet XML to a row-major grid of strings and numbers (1-based rows as array index 0). */
export function sheetGrid(xml: string): (string | number | null)[][] {
  const grid: (string | number | null)[][] = [];
  const re = /<c r="([A-Z]+)(\d+)"[^>]*?(?:\/>|>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)?<\/c>)/g;
  for (const m of xml.matchAll(re)) {
    const col = colNumber(m[1]!) - 1;
    const row = Number(m[2]) - 1;
    const value = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? unescapeXml(m[4]) : null;
    grid[row] ??= [];
    grid[row]![col] = value;
  }
  return grid;
}

export { colLetter };
