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
};

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
