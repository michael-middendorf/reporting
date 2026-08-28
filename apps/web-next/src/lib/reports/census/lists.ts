import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonObject } from "../housing/store";
import type { HousingAssignmentRow } from "./residency";
import type { CensusRawStudent, UnretainedStudent } from "./lists-core";

export {
  deriveUnretained,
  dropNonCensusSports,
  isDroppedCensusSport,
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

function isIrelandHousing(h: HousingAssignmentRow): boolean {
  const b = (h.building || "").trim().toUpperCase();
  const p = (h.priceType || "").trim().toUpperCase();
  return b === "CIARA" || b === "MALAC" || p === "ISTA";
}

/**
 * Ireland (Ciara / Malachy) for now: Returning, Resident, and sport Ireland
 * when they do not already have a team. Session 03Ireland without an Ireland
 * house is Returning only.
 */
export function markIrelandReturning(
  students: CensusRawStudent[],
  housing: HousingAssignmentRow[] = [],
): CensusRawStudent[] {
  const ireland = new Set(
    housing.filter(isIrelandHousing).map((h) => (h.pcid || "").trim().toUpperCase()).filter(Boolean),
  );
  return students.map((s) => {
    const id = (s.pcid || "").trim().toUpperCase();
    const sess = (s.session || "").toLowerCase();
    const inIrelandHouse = ireland.has(id);
    if (!inIrelandHouse && !sess.includes("ireland")) return s;
    const sport = (s.sport || "").trim();
    const irelandSport = inIrelandHouse && !sport;
    return {
      ...s,
      incomingReturning: "Returning",
      residency: inIrelandHouse || sess.includes("ireland") ? "Ireland" : s.residency,
      sport: irelandSport ? "Ireland" : s.sport,
      athlete: irelandSport || s.athlete === "Athlete" ? "Athlete" : s.athlete,
    };
  });
}

export function applyErezResidency(
  students: CensusRawStudent[],
  housing: HousingAssignmentRow[],
): CensusRawStudent[] {
  if (!housing.length) return markIrelandReturning(students);
  const byPcid = new Map(housing.map((h) => [h.pcid.toUpperCase(), h]));
  const withResidency = students.map((s) => {
    const hit = byPcid.get((s.pcid || "").toUpperCase());
    if (!hit) return s;
    const sess = (s.session || "").toLowerCase().replace(/\s+/g, "");
    const mallary = sess.includes("03mm") || sess.includes("mallary");
    const residency = mallary
      ? "Mont Mallary"
      : isIrelandHousing(hit)
        ? "Ireland"
        : hit.residency === "Resident"
          ? "On Campus"
          : hit.residency;
    return { ...s, residency };
  });
  return markIrelandReturning(withResidency, housing);
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
  return { students: dropNonCensusSports(students), unretained, prior, graduates };
}
