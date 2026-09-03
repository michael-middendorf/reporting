import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonObject } from "../housing/store";
import {
  MOUNT_MELLERAY,
  isMountMellerayResidency,
  type HousingAssignmentRow,
} from "./residency";
import {
  dropNonCensusSports,
  isSpringOrSummerAdmit,
  isUgDegreeSeekingRow,
  normPcid,
  S26_LOA_ROSTER,
  type CensusRawStudent,
  type LoaStudent,
  type UnretainedStudent,
} from "./lists-core";

export {
  attachLoaStatus,
  canonicalCensusSport,
  censusAppDecision,
  deriveUnretained,
  dropNonCensusSports,
  isDroppedCensusSport,
  isInterveningGraduate,
  isUgDegreeSeekingRow,
  normPcid,
  S26_LOA_ROSTER,
  footballRosterPcids,
  withoutFootballPlayers,
  withoutFootballRoster,
  type CensusLists,
  type CensusRawStudent,
  type LoaStudent,
  type LoaStatus,
  type LoaWithStatus,
  type UnretainedStudent,
} from "./lists-core";

export const CENSUS_STUDENTS_KEY = "cache/census/students.json";
export const CENSUS_UNRETAINED_KEY = "cache/census/unretained.json";
export const CENSUS_PRIOR_KEY = "cache/census/prior.json";
export const CENSUS_GRADUATES_KEY = "cache/census/graduates.json";
export const CENSUS_LOA_KEY = "cache/census/loa.json";

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

const EREZ_CAMPUS = new Set(["On Campus", "Commuter", "Rome", "Study Abroad"]);

function mallaryFromRegistration(s: CensusRawStudent): boolean {
  const sess = (s.session || "").toLowerCase().replace(/\s+/g, "");
  return sess.includes("03mm") || sess.includes("mallary");
}

function irelandFromRegistration(s: CensusRawStudent): boolean {
  const sess = (s.session || "").toLowerCase().replace(/\s+/g, "");
  if (sess.includes("ireland")) return true;
  return isMountMellerayResidency(s.residency || "");
}

function registrationResidency(raw: string): string {
  const t = (raw || "").trim();
  if (!t || t === "-" || t === "Unassigned") return "";
  if (t === "Resident") return "On Campus";
  if (isMountMellerayResidency(t)) return MOUNT_MELLERAY;
  return t;
}

/**
 * eRez wins for On Campus / Commuter. Registration session wins for Mount Melleray.
 * Use the other source when the preferred one is blank. Unassigned only if both are empty.
 */
export function resolveCensusResidency(
  s: CensusRawStudent,
  hit?: HousingAssignmentRow,
): string {
  if (mallaryFromRegistration(s)) return "Mont Mallary";
  if (irelandFromRegistration(s) || (hit && isIrelandHousing(hit))) return MOUNT_MELLERAY;
  const erez = hit && hit.residency !== "Unassigned" ? hit.residency : "";
  if (erez && (EREZ_CAMPUS.has(erez) || erez === "Study Abroad")) return erez;
  const reg = registrationResidency(s.residency);
  if (reg) return reg;
  if (erez) return erez;
  return "Unassigned";
}

/**
 * Mount Melleray (Ciara / Malachy) for now: Returning and Mount Melleray residency.
 * Session 03Ireland without an Ireland house is Returning only.
 * Ireland is a campus, not a sport — keep any real team sport they already have.
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
    return {
      ...s,
      incomingReturning: "Returning",
      residency: inIrelandHouse || sess.includes("ireland") ? MOUNT_MELLERAY : s.residency,
    };
  });
}

function isFtcaFreshman(s: CensusRawStudent): boolean {
  return (
    (s.collegeAttend || "").trim().toUpperCase() === "FTCA" &&
    (s.classLevel || "").trim().toLowerCase().startsWith("fresh")
  );
}

/**
 * Last year's dual enrollment is not a prior college year. A true freshman FTCA
 * who was only DE / non-degree on the last census is Incoming, not Returning.
 */
export function promoteFormerDualFtca(
  students: CensusRawStudent[],
  prior: CensusRawStudent[],
): CensusRawStudent[] {
  if (!students.length || !prior.length) return students;
  const priorById = new Map(prior.map((s) => [normPcid(s.pcid), s]));
  return students.map((s) => {
    if (isSpringOrSummerAdmit(s.admitTerm)) return s;
    if (!isFtcaFreshman(s)) return s;
    if ((s.incomingReturning || "").trim().toLowerCase().startsWith("incoming")) return s;
    const prev = priorById.get(normPcid(s.pcid));
    if (!prev) return { ...s, incomingReturning: "Incoming" };
    if (isUgDegreeSeekingRow(prev.program, prev.collegeAttend)) return s;
    return { ...s, incomingReturning: "Incoming" };
  });
}

/** Spring/summer starters are Returning on the fall census, like last year. */
export function markSpringAdmitsReturning(students: CensusRawStudent[]): CensusRawStudent[] {
  return students.map((s) => {
    if (!isSpringOrSummerAdmit(s.admitTerm)) return s;
    if (!(s.incomingReturning || "").trim().toLowerCase().startsWith("incoming")) return s;
    return { ...s, incomingReturning: "Returning" };
  });
}

export function applyErezResidency(
  students: CensusRawStudent[],
  housing: HousingAssignmentRow[],
): CensusRawStudent[] {
  if (!housing.length) {
    return markIrelandReturning(students.map((s) => ({ ...s, residency: resolveCensusResidency(s) })));
  }
  const byPcid = new Map(housing.map((h) => [h.pcid.toUpperCase(), h]));
  const withResidency = students.map((s) => {
    const hit = byPcid.get((s.pcid || "").toUpperCase());
    return { ...s, residency: resolveCensusResidency(s, hit) };
  });
  return markIrelandReturning(withResidency, housing);
}

export async function loadCensusLists(): Promise<import("./lists-core").CensusLists> {
  const preferLocal = process.env.CENSUS_LOCAL === "1";
  let students = preferLocal ? [] : await fromS3<CensusRawStudent>(CENSUS_STUDENTS_KEY);
  let unretained = preferLocal ? [] : await fromS3<UnretainedStudent>(CENSUS_UNRETAINED_KEY);
  let prior = preferLocal ? [] : await fromS3<CensusRawStudent>(CENSUS_PRIOR_KEY);
  let graduates = preferLocal
    ? []
    : await fromS3<{ pcid: string; year?: string | number; term?: string; program?: string }>(CENSUS_GRADUATES_KEY);
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
  let loa = preferLocal ? [] : await fromS3<LoaStudent>(CENSUS_LOA_KEY);
  if (!loa.length) loa = fromFile<LoaStudent>(join(localDir, "loa.json"));
  if (!loa.length) loa = S26_LOA_ROSTER;
  const cleanedPrior = dropNonCensusSports(prior);
  return {
    students: markSpringAdmitsReturning(promoteFormerDualFtca(dropNonCensusSports(students), cleanedPrior)),
    unretained,
    prior: cleanedPrior,
    graduates,
    loa,
    loaFall: [],
  };
}
