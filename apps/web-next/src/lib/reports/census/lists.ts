import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonObject } from "../housing/store";
import type { HousingAssignmentRow } from "./residency";
import type { CensusRawStudent, UnretainedStudent } from "./lists-core";

export {
  deriveUnretained,
  isInterveningGraduate,
  isUgDegreeSeekingRow,
  normPcid,
  type CensusLists,
  type CensusRawStudent,
  type UnretainedStudent,
} from "./lists-core";

export const CENSUS_STUDENTS_KEY = "cache/census/students.json";
export const CENSUS_UNRETAINED_KEY = "cache/census/unretained.json";
export const CENSUS_PRIOR_KEY = "cache/census/prior.json";
export const CENSUS_GRADUATES_KEY = "cache/census/graduates.json";

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

export async function loadCensusLists(): Promise<import("./lists-core").CensusLists> {
  let students = await fromS3<CensusRawStudent>(CENSUS_STUDENTS_KEY);
  let unretained = await fromS3<UnretainedStudent>(CENSUS_UNRETAINED_KEY);
  let prior = await fromS3<CensusRawStudent>(CENSUS_PRIOR_KEY);
  let graduates = await fromS3<{ pcid: string; year?: string | number; term?: string; program?: string }>(
    CENSUS_GRADUATES_KEY,
  );
  const localDir = join(process.cwd(), "src/lib/reports/census/data");
  if (!students.length) students = fromFile<CensusRawStudent>(join(localDir, "students.json"));
  if (!students.length) students = fromFile<CensusRawStudent>("/tmp/census-lists/students.json");
  if (!unretained.length) unretained = fromFile<UnretainedStudent>(join(localDir, "unretained.json"));
  if (!unretained.length) unretained = fromFile<UnretainedStudent>("/tmp/census-lists/unretained.json");
  if (!prior.length) prior = fromFile<CensusRawStudent>(join(localDir, "prior.json"));
  if (!graduates.length) {
    graduates = fromFile<{ pcid: string; year?: string | number; term?: string; program?: string }>(
      join(localDir, "graduates.json"),
    );
  }
  return { students, unretained, prior, graduates };
}
