import { normPcid, type CensusRawStudent, type LoaStudent, type UnretainedStudent } from "./lists-core";
import type { GraduateRecord } from "./retention";

/** Dropped after FA25 census — out of the FA25 cohort for F26 retention. */
export const RETENTION_EXCLUDE = new Set(["P000384377", "P000378273"].map(normPcid)); // Aiden Wilson; Hannah Nelson (deceased)

/** AMSOL / still enrolled / finishing credits — count as retained even if not UG-registered. */
export const RETENTION_FORCE_RETAINED = new Set(
  ["P000352989", "P000380426", "P000343155", "P000379038"].map(normPcid),
); // Trumpore AMSOL; Harrell enrolled; Pritchard last credits; Parks AMSOL

/** Intervening graduates missing from the PowerCampus graduate extract. */
export const RETENTION_FORCE_GRADUATED: GraduateRecord[] = [
  ...["P000358025", "P000341586", "P000342817"].map((pcid) => ({ pcid, year: "2025", term: "FALL" })),
  { pcid: "P000346202", year: "2026", term: "SPRING" },
  ...[
    "P000347161",
    "P000354952",
    "P000357988",
    "P000345243",
    "P000379261",
    "P000343142",
    "P000354723",
    "P000346640",
    "P000347632",
    "P000345979",
    "P000343474",
    "P000349726",
    "P000381969",
    "P000354719",
    "P000383151",
    "P000358530",
  ].map((pcid) => ({ pcid, year: "2026", term: "SUMMER" })),
];

/**
 * Unretained notes col R: leave of absence (intend to return).
 * Off All Not Retained and out of the F26 retention cohort; they stay on the FA26 LOA tab.
 */
export const RETENTION_LOA = new Set(
  [
    "P000341593", // Alexander Earnhardt
    "P000346188", // Sophia Gomez
    "P000344532", // Derrick Guza
    "P000380481", // Domenica Cedeno Medrano
    "P000343982", // Matthew Pena
    "P000380315", // Charles Wagner
  ].map(normPcid),
);

export function markUnretainedNotes(rows: UnretainedStudent[]): UnretainedStudent[] {
  return rows.map((s) =>
    RETENTION_LOA.has(normPcid(s.pcid)) ? { ...s, retention: "Leave of Absence" } : s,
  );
}

export function loaStudentsFromNotes(prior: CensusRawStudent[]): LoaStudent[] {
  return prior
    .filter((s) => RETENTION_LOA.has(normPcid(s.pcid)))
    .map((s) => ({
      pcid: s.pcid,
      first: s.first,
      last: s.last,
      sport: s.sport || "",
      classLevel: s.classLevel,
      incomingReturning: s.incomingReturning,
      collegeAttend: s.collegeAttend,
      credits: s.credits,
      gpa: s.gpa,
      earnedCredits: s.earnedCredits,
      curriculum: s.curriculumName || s.curriculum || "",
      residency: s.residency,
      state: s.state,
      ethnicity: s.ethnicity || "",
      gender: s.gender,
      honors: s.honors || "",
      institute: s.institute || "",
      household: s.household || "",
      fsp: s.fsp || "",
      finalGpa: s.gpa,
      religion: s.religion || "",
      term: "Fall 2026",
    }));
}

/** Combined view only. Dashboard and Excel keep Spring and Fall LOA on separate tabs (Cedeno is on both). */
export function mergeLoaRosters(spring: LoaStudent[], fallNotes: LoaStudent[]): LoaStudent[] {
  const have = new Set(spring.map((s) => normPcid(s.pcid)));
  return [...spring, ...fallNotes.filter((s) => !have.has(normPcid(s.pcid)))];
}

/** Dropped after census, deceased, or approved LOA — not in the F26 retention cohort. */
export function isOutOfRetentionCohort(pcid: string): boolean {
  const id = normPcid(pcid);
  return RETENTION_EXCLUDE.has(id) || RETENTION_LOA.has(id);
}

export function applyCensusRetentionNotes(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
): { prior: CensusRawStudent[]; currentIds: string[]; graduates: GraduateRecord[] } {
  return {
    prior: prior.filter((s) => !isOutOfRetentionCohort(s.pcid)),
    currentIds: [...new Set([...currentPcids].map(normPcid).filter(Boolean)), ...RETENTION_FORCE_RETAINED],
    graduates: [...grads, ...RETENTION_FORCE_GRADUATED],
  };
}
