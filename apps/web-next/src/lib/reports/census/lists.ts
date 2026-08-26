import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonObject } from "../housing/store";
import type { HousingAssignmentRow } from "./residency";

export const CENSUS_STUDENTS_KEY = "cache/census/students.json";
export const CENSUS_UNRETAINED_KEY = "cache/census/unretained.json";

export type CensusRawStudent = {
  pcid: string;
  first: string;
  last: string;
  incomingReturning: string;
  state: string;
  religion: string;
  cathGroup: string;
  ethnicity: string;
  gender: string;
  program: string;
  collegeAttend: string;
  curriculum: string;
  curriculumName: string;
  classLevel: string;
  fullPart: string;
  city: string;
  credits: number | string;
  gpa: number | string;
  earnedCredits: number | string;
  residency: string;
  sport: string;
  athlete: string;
  honors: string;
  fsp: string;
  household: string;
  institute: string;
  marines: string;
  appDecision: string;
  session: string;
  degree: string;
  email: string;
  citizenship: string;
  visa: string;
};

export type UnretainedStudent = {
  pcid: string;
  first: string;
  last: string;
  retention: string;
  gpa: number | string;
  fsp: string;
  household: string;
  marines: string;
  honors: string;
  sport: string;
  state: string;
  gender: string;
  classLevel: string;
  collegeAttend: string;
  incomingReturning: string;
  program?: string;
};

const NON_DS = new Set(["DUAL", "EACO", "ND"]);

export function normPcid(pcid: string | null | undefined): string {
  return (pcid || "").trim().toUpperCase();
}

/** Fall 2025, Spring 2026, and Summer 2026 — the year between FA25 and FA26 census. */
export function isInterveningGraduate(year: string | number | null | undefined, term: string | null | undefined): boolean {
  const y = String(year ?? "").trim();
  const t = String(term ?? "").trim().toUpperCase();
  return (y === "2025" && t === "FALL") || (y === "2026" && (t === "SPRING" || t === "SUMMER"));
}

export function isUgDegreeSeekingRow(program: string, collegeAttend: string): boolean {
  return (program || "").trim().toUpperCase() === "UNDERG" && !NON_DS.has((collegeAttend || "").trim().toUpperCase());
}

/**
 * Last census raw, minus intervening graduates, minus anyone registered this term.
 * Registration is the all-student count for the current term.
 */
export function deriveUnretained(
  prior: UnretainedStudent[],
  registeredPcids: Iterable<string>,
  graduatePcids: Iterable<string>,
): UnretainedStudent[] {
  const registered = new Set([...registeredPcids].map(normPcid).filter(Boolean));
  const graduated = new Set([...graduatePcids].map(normPcid).filter(Boolean));
  return prior
    .filter((s) => {
      const id = normPcid(s.pcid);
      return Boolean(id) && !registered.has(id) && !graduated.has(id);
    })
    .map((s) => ({ ...s, retention: "Not Retained" }));
}

export type CensusLists = {
  students: CensusRawStudent[];
  unretained: UnretainedStudent[];
};

type Wrapped<T> = { students?: T[]; count?: number };

function fromFile<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as Wrapped<T>;
  return raw.students || [];
}

async function fromS3<T>(key: string): Promise<T[]> {
  try {
    const raw = await readJsonObject<Wrapped<T>>(key);
    return raw?.students || [];
  } catch {
    return [];
  }
}

export function applyErezResidency(
  students: CensusRawStudent[],
  housing: HousingAssignmentRow[],
): CensusRawStudent[] {
  if (!housing.length) return students;
  const byPcid = new Map(housing.map((h) => [h.pcid.toUpperCase(), h]));
  return students.map((s) => {
    const hit = byPcid.get((s.pcid || "").toUpperCase());
    if (!hit) return s;
    return { ...s, residency: hit.residency };
  });
}

export async function loadCensusLists(): Promise<CensusLists> {
  let students = await fromS3<CensusRawStudent>(CENSUS_STUDENTS_KEY);
  let unretained = await fromS3<UnretainedStudent>(CENSUS_UNRETAINED_KEY);
  const localDir = join(process.cwd(), "src/lib/reports/census/data");
  if (!students.length) students = fromFile<CensusRawStudent>(join(localDir, "students.json"));
  if (!students.length) students = fromFile<CensusRawStudent>("/tmp/census-lists/students.json");
  if (!unretained.length) unretained = fromFile<UnretainedStudent>(join(localDir, "unretained.json"));
  if (!unretained.length) unretained = fromFile<UnretainedStudent>("/tmp/census-lists/unretained.json");
  return { students, unretained };
}
