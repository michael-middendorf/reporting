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
  deType?: string;
  session: string;
  degree: string;
  email: string;
  citizenship: string;
  visa: string;
  dob?: string;
  hsGpa?: number | string;
  act?: number | string;
  sat?: number | string;
  clt?: number | string;
  admitTerm?: string;
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
  credits?: number | string;
  earnedCredits?: number | string;
  athleticType?: string;
  rosterStatus?: string;
};

export type LoaStudent = {
  pcid: string;
  first: string;
  last: string;
  sport: string;
  classLevel: string;
  incomingReturning: string;
  collegeAttend: string;
  credits: number | string;
  gpa: number | string;
  earnedCredits: number | string;
  curriculum: string;
  residency: string;
  state: string;
  ethnicity: string;
  gender: string;
  honors: string;
  institute: string;
  household: string;
  fsp: string;
  finalGpa: number | string;
  religion: string;
  term: string;
};

export type LoaStatus = "Returned" | "Did not return" | "Graduated";

export type LoaWithStatus = LoaStudent & {
  status: LoaStatus;
  fa26Program: string;
  fa26Class: string;
  fa26Sport: string;
  fa26Curriculum: string;
  fa26Session: string;
  fa26Residency: string;
  fa26FullPart: string;
  fa26Credits: number | string;
};

/** Spring 2026 census Leave of Absence sheet (7 students). Status is attached at load time. */
export const S26_LOA_ROSTER: LoaStudent[] = [
  {
    pcid: "P000353941",
    first: "Jacob",
    last: "Mondarez",
    sport: "Football",
    classLevel: "Junior",
    incomingReturning: "Returning",
    collegeAttend: "FTCA",
    credits: 12,
    gpa: 2.56,
    earnedCredits: 76,
    curriculum: "Computer Science",
    residency: "Resident",
    state: "VA",
    ethnicity: "ASIAN",
    gender: "Male",
    honors: "",
    institute: "",
    household: "",
    fsp: "",
    finalGpa: 2.27,
    religion: "Catholic",
    term: "Spring 2026",
  },
  {
    pcid: "P000380327",
    first: "Jeremy",
    last: "Faccio",
    sport: "",
    classLevel: "Freshman",
    incomingReturning: "Returning",
    collegeAttend: "FTCA",
    credits: 16,
    gpa: 1.81,
    earnedCredits: 36,
    curriculum: "Communications",
    residency: "Commuter",
    state: "FL",
    ethnicity: "HISPAN",
    gender: "Male",
    honors: "",
    institute: "",
    household: "",
    fsp: "FSP",
    finalGpa: 2.29,
    religion: "Catholic",
    term: "Spring 2026",
  },
  {
    pcid: "P000380481",
    first: "Domenica",
    last: "Cedeno Medrano",
    sport: "",
    classLevel: "Sophomore",
    incomingReturning: "Returning",
    collegeAttend: "FTCA",
    credits: 16,
    gpa: 2.93,
    earnedCredits: 48,
    curriculum: "Finance",
    residency: "Commuter",
    state: "FL",
    ethnicity: "",
    gender: "Female",
    honors: "",
    institute: "",
    household: "",
    fsp: "",
    finalGpa: 3.03,
    religion: "Catholic",
    term: "Spring 2026",
  },
  {
    pcid: "P000380881",
    first: "Marin",
    last: "Kienbusch",
    sport: "",
    classLevel: "Sophomore",
    incomingReturning: "Returning",
    collegeAttend: "FTCA",
    credits: 16,
    gpa: 3.08,
    earnedCredits: 58,
    curriculum: "Psychology",
    residency: "Resident",
    state: "CO",
    ethnicity: "WHITE",
    gender: "Female",
    honors: "",
    institute: "",
    household: "",
    fsp: "",
    finalGpa: 3.05,
    religion: "Catholic",
    term: "Spring 2026",
  },
  {
    pcid: "P000382172",
    first: "Christopher",
    last: "Peloso",
    sport: "Ultimate Frisbee",
    classLevel: "Sophomore",
    incomingReturning: "Returning",
    collegeAttend: "FTCA",
    credits: 16,
    gpa: 3.6,
    earnedCredits: 48,
    curriculum: "Business",
    residency: "Resident",
    state: "",
    ethnicity: "",
    gender: "Male",
    honors: "",
    institute: "",
    household: "Called By Name",
    fsp: "",
    finalGpa: 3.53,
    religion: "Catholic",
    term: "Spring 2026",
  },
  {
    pcid: "P000384266",
    first: "Cecilia",
    last: "Ekblad",
    sport: "",
    classLevel: "Freshman",
    incomingReturning: "Incoming",
    collegeAttend: "FTCA",
    credits: 16,
    gpa: "",
    earnedCredits: 16,
    curriculum: "Prenursing",
    residency: "Resident",
    state: "MI",
    ethnicity: "WHITE",
    gender: "Female",
    honors: "",
    institute: "",
    household: "",
    fsp: "FSP",
    finalGpa: 3.78,
    religion: "Catholic",
    term: "Spring 2026",
  },
  {
    pcid: "P000385107",
    first: "Andrew",
    last: "Cucullu",
    sport: "Basketball-Men",
    classLevel: "Freshman",
    incomingReturning: "Incoming",
    collegeAttend: "FTCA",
    credits: 16,
    gpa: "",
    earnedCredits: 12,
    curriculum: "Business",
    residency: "Resident",
    state: "TN",
    ethnicity: "HISPAN",
    gender: "Male",
    honors: "",
    institute: "",
    household: "",
    fsp: "",
    finalGpa: 2.03,
    religion: "Catholic",
    term: "Spring 2026",
  },
];

export type CensusLists = {
  students: CensusRawStudent[];
  unretained: UnretainedStudent[];
  prior: CensusRawStudent[];
  graduates: { pcid: string; year?: string | number; term?: string; program?: string }[];
  /** Spring 2026 LOA census roster. */
  loa: LoaStudent[];
  /** Fall 2026 LOA from unretained notes (intend to return). */
  loaFall: LoaStudent[];
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

/** Slate/eRez Entry Term like "Spring 2026" or "2025SPRING01". */
export function isSpringOrSummerAdmit(admitTerm?: string): boolean {
  const t = (admitTerm || "").trim().toUpperCase();
  return t.includes("SPRING") || t.includes("SUMM");
}

/** Pickleball is club, not NAIA. Ireland is a campus (Mount Melleray), not a team. */
export function isDroppedCensusSport(sport: string): boolean {
  const t = (sport || "").trim().toLowerCase();
  return t.includes("pickleball") || t === "ireland";
}

/** AMU has men's rugby only. A woman on that roster (manager) is Rugby-Men, not a women's team. */
const SPORT_ALIASES: Record<string, string> = {
  "rugby-women": "Rugby-Men",
  rugby: "Rugby-Men",
};

export function canonicalCensusSport(sport: string): string {
  const t = (sport || "").trim();
  if (!t || t.toLowerCase() === "non-athlete" || isDroppedCensusSport(t)) return "";
  return SPORT_ALIASES[t.toLowerCase()] || t;
}

export function isCensusFootball(sport: string): boolean {
  return canonicalCensusSport(sport).toLowerCase() === "football";
}

export function withoutFootballPlayers<T extends { sport?: string }>(rows: T[]): T[] {
  return rows.filter((s) => !isCensusFootball(s.sport || ""));
}

/** S26 team players: Varsity / Non-Varsity / Non-NAIA. Band and managers are associated only. */
export function isTeamAthlete(s: { athleticType?: string; sport?: string; rosterStatus?: string }): boolean {
  const sport = canonicalCensusSport(s.sport || "").toLowerCase();
  if (!sport || sport === "band") return false;
  const t = (s.athleticType || "").trim().toUpperCase();
  if (t.includes("MANAGER") || t.includes("COACH")) return false;
  const status = (s.rosterStatus || "").trim().toLowerCase();
  if (status.includes("associated")) return false;
  return t === "VARSITY" || t === "NON-VARSITY" || t === "NON-NAIA";
}

export function dropNonCensusSports(students: CensusRawStudent[]): CensusRawStudent[] {
  return students.map((s) => {
    const sport = canonicalCensusSport(s.sport || "");
    if (!sport) {
      if (!isDroppedCensusSport(s.sport || "")) return s;
      return { ...s, sport: "", athlete: "Non-Athlete", athleticType: "", rosterStatus: "" };
    }
    if (sport === (s.sport || "").trim()) return s;
    return { ...s, sport };
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

/** Match an LOA roster to this fall's registration and intervening graduates. */
export function attachLoaStatus(
  loa: LoaStudent[],
  registered: CensusRawStudent[],
  graduatePcids: Iterable<string>,
): LoaWithStatus[] {
  const byId = new Map(registered.map((s) => [normPcid(s.pcid), s]));
  const graduated = new Set([...graduatePcids].map(normPcid).filter(Boolean));
  return loa.map((s) => {
    const now = byId.get(normPcid(s.pcid));
    const status: LoaStatus = now ? "Returned" : graduated.has(normPcid(s.pcid)) ? "Graduated" : "Did not return";
    return {
      ...s,
      status,
      fa26Program: now?.program || "",
      fa26Class: now?.classLevel || "",
      fa26Sport: now?.sport || "",
      fa26Curriculum: now?.curriculumName || now?.curriculum || "",
      fa26Session: now?.session || "",
      fa26Residency: now?.residency || "",
      fa26FullPart: now?.fullPart || "",
      fa26Credits: now?.credits ?? "",
    };
  });
}
