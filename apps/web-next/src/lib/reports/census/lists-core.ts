/** Browser-safe census list types and pure helpers. Do not import node:fs here. */

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
  athleticType: string;
  rosterStatus: string;
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
  dob?: string;
  hsGpa?: number | string;
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
  religion?: string;
  state: string;
  gender: string;
  classLevel: string;
  collegeAttend: string;
  incomingReturning: string;
  program?: string;
};

export type CensusLists = {
  students: CensusRawStudent[];
  unretained: UnretainedStudent[];
  prior: CensusRawStudent[];
  graduates: { pcid: string; year?: string | number; term?: string; program?: string }[];
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

/** Pickleball is not a census sport for FA26 (club; dropped from NAIA athlete counts). */
export function isDroppedCensusSport(sport: string): boolean {
  return (sport || "").toLowerCase().includes("pickleball");
}

export function dropNonCensusSports(students: CensusRawStudent[]): CensusRawStudent[] {
  return students.map((s) => {
    if (!isDroppedCensusSport(s.sport || "")) return s;
    return { ...s, sport: "", athlete: "Non-Athlete", athleticType: "", rosterStatus: "" };
  });
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
