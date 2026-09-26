/**
 * One ordered, grouped spec for every census field shown to Academic Affairs.
 * The student profile and the bulk spreadsheet both read this list, so the two
 * cannot drift. Browser-safe: only lists-core and residency helpers (no node:*).
 *
 * Value mappings follow the Census report raw list (list-columns.ts
 * censusRawRow): residency via displayCensusResidency, athlete via
 * censusRawAthleteFlag.
 */
import { normalizePcid } from "../athletics-coaching/academics";
import { censusRawAthleteFlag, type CensusRawStudent } from "../census/lists-core";
import { displayCensusResidency } from "../census/residency";

export type CensusFieldValue = string | number | null;

export type CensusFieldGroupName =
  | "Census record"
  | "Enrollment"
  | "Residency"
  | "Associations"
  | "Athletics (census)"
  | "Demographics"
  | "Admissions"
  | "Interview";

export type CensusField = {
  group: CensusFieldGroupName;
  header: string;
  /** Census keys this column reads. Drives the coverage check. */
  keys: (keyof CensusRawStudent)[];
  /** "number" cells are written as numbers in Excel when they parse. */
  kind?: "text" | "number";
  /** False: export only (the profile header already shows it). */
  profile?: boolean;
  get: (student: CensusRawStudent) => CensusFieldValue;
};

const BLANKS = new Set(["", "-", "--", "n/a", "null", "undefined"]);

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return BLANKS.has(out.toLowerCase()) ? null : out;
}

/** Numeric strings become numbers; anything else stays text. */
function numeric(value: unknown): CensusFieldValue {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const out = text(value);
  if (out === null) return null;
  const n = Number(out);
  return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(out) ? n : out;
}

function field(
  group: CensusFieldGroupName,
  header: string,
  key: keyof CensusRawStudent,
  options: { kind?: "text" | "number"; profile?: boolean } = {},
): CensusField {
  const kind = options.kind ?? "text";
  return {
    group,
    header,
    keys: [key],
    kind,
    profile: options.profile,
    get: (student) => (kind === "number" ? numeric(student[key]) : text(student[key])),
  };
}

export const CENSUS_FIELDS: CensusField[] = [
  // Census's own identity columns. The Students sheet leads with AspireDU's
  // name, email, and PCID; these show what the census row itself says.
  {
    group: "Census record",
    header: "Census PCID",
    keys: ["pcid"],
    profile: false,
    // Same P + 9 digit form as the "PCID or SIS id" column; odd values stay as written.
    get: (s) => {
      const raw = text(s.pcid);
      return raw ? normalizePcid(raw) ?? raw : null;
    },
  },
  field("Census record", "Census first name", "first", { profile: false }),
  field("Census record", "Census last name", "last", { profile: false }),
  field("Census record", "Census email", "email", { profile: false }),

  field("Enrollment", "Program", "program"),
  field("Enrollment", "Degree", "degree"),
  field("Enrollment", "Session", "session"),
  field("Enrollment", "College attend", "collegeAttend"),
  field("Enrollment", "Curriculum", "curriculum"),
  field("Enrollment", "Curriculum name", "curriculumName"),
  {
    group: "Enrollment",
    header: "Declared majors",
    keys: ["declaredMajors"],
    get: (s) => {
      const majors = (s.declaredMajors || []).map((m) => text(m)).filter((m): m is string => Boolean(m));
      return majors.length ? [...new Set(majors)].join(", ") : null;
    },
  },
  field("Enrollment", "Class level", "classLevel"),
  field("Enrollment", "Full or part time", "fullPart"),
  field("Enrollment", "Credits", "credits", { kind: "number" }),
  field("Enrollment", "Cumulative GPA", "gpa", { kind: "number" }),
  field("Enrollment", "Earned credits", "earnedCredits", { kind: "number" }),
  field("Enrollment", "Incoming or returning", "incomingReturning"),
  field("Enrollment", "Admit term", "admitTerm"),
  field("Enrollment", "Dual enrollment type", "deType"),

  {
    group: "Residency",
    header: "Resident or commuter",
    keys: ["residency"],
    get: (s) => text(displayCensusResidency(s.residency || "")),
  },

  field("Associations", "Household", "household"),
  field("Associations", "Institute", "institute"),
  field("Associations", "Honors", "honors"),
  field("Associations", "FSP", "fsp"),
  field("Associations", "Mary's Marines", "marines"),

  field("Athletics (census)", "Census sport", "sport"),
  {
    group: "Athletics (census)",
    header: "Athlete or non-athlete",
    keys: ["athlete"],
    // Same derivation as the Census raw list, not the raw column.
    get: (s) => censusRawAthleteFlag(s),
  },
  field("Athletics (census)", "Athletic type", "athleticType"),
  field("Athletics (census)", "Roster status", "rosterStatus"),

  field("Demographics", "Gender", "gender"),
  field("Demographics", "Ethnicity", "ethnicity"),
  field("Demographics", "Religion", "religion"),
  field("Demographics", "Catholic, Christian, or other", "cathGroup"),
  field("Demographics", "City", "city"),
  field("Demographics", "State", "state"),
  field("Demographics", "Citizenship", "citizenship"),
  field("Demographics", "Visa", "visa"),
  field("Demographics", "Date of birth", "dob"),

  field("Admissions", "Application decision", "appDecision"),
  field("Admissions", "Application major", "applicationMajor"),
  field("Admissions", "School type", "schoolType"),
  field("Admissions", "High school", "highSchoolName"),
  field("Admissions", "HS GPA", "hsGpa", { kind: "number" }),
  field("Admissions", "ACT", "act", { kind: "number" }),
  field("Admissions", "SAT", "sat", { kind: "number" }),
  field("Admissions", "CLT", "clt", { kind: "number" }),

  field("Interview", "Interview total", "interviewTotal", { kind: "number" }),
  field("Interview", "Interview faith", "interviewFaith", { kind: "number" }),
  field("Interview", "Interview courage", "interviewCourage", { kind: "number" }),
  field("Interview", "Interview desire", "interviewDesire", { kind: "number" }),
  field("Interview", "Interview HS involvement", "interviewHsInvolvement", { kind: "number" }),
  field("Interview", "Interview college and career", "interviewCollegeCareer", { kind: "number" }),
  field("Interview", "Interview plans at AMU", "interviewPlans", { kind: "number" }),
  field("Interview", "AC comments", "acComments"),
];

/** Group order on the profile; `open` groups start expanded. */
export const CENSUS_PROFILE_GROUPS: { group: CensusFieldGroupName; open: boolean }[] = [
  { group: "Enrollment", open: true },
  { group: "Residency", open: true },
  { group: "Associations", open: true },
  { group: "Athletics (census)", open: true },
  { group: "Demographics", open: false },
  { group: "Admissions", open: false },
  { group: "Interview", open: false },
];

/** Every CensusRawStudent key, listed once. The type check below fails if the type grows. */
export const CENSUS_RAW_KEYS = [
  "pcid",
  "first",
  "last",
  "incomingReturning",
  "state",
  "religion",
  "cathGroup",
  "ethnicity",
  "gender",
  "program",
  "collegeAttend",
  "curriculum",
  "curriculumName",
  "declaredMajors",
  "classLevel",
  "fullPart",
  "city",
  "credits",
  "gpa",
  "earnedCredits",
  "residency",
  "sport",
  "athlete",
  "athleticType",
  "rosterStatus",
  "honors",
  "fsp",
  "household",
  "institute",
  "marines",
  "appDecision",
  "deType",
  "session",
  "degree",
  "email",
  "citizenship",
  "visa",
  "dob",
  "hsGpa",
  "act",
  "sat",
  "clt",
  "admitTerm",
  "interviewTotal",
  "interviewFaith",
  "interviewCourage",
  "interviewDesire",
  "interviewHsInvolvement",
  "interviewCollegeCareer",
  "interviewPlans",
  "acComments",
  "applicationMajor",
  "schoolType",
  "highSchoolName",
] as const satisfies readonly (keyof CensusRawStudent)[];

// Compile-time guard: a new CensusRawStudent key that is missing above is a type error.
type MissingCensusKeys = Exclude<keyof CensusRawStudent, (typeof CENSUS_RAW_KEYS)[number]>;
const censusKeysComplete: [MissingCensusKeys] extends [never] ? true : MissingCensusKeys = true;
void censusKeysComplete;

export type CensusProfileField = { label: string; value: string };
export type CensusProfileGroup = { group: CensusFieldGroupName; open: boolean; fields: CensusProfileField[] };

/** Profile sections with blank values dropped; empty sections are omitted. */
export function censusProfileGroups(student: CensusRawStudent): CensusProfileGroup[] {
  const out: CensusProfileGroup[] = [];
  for (const { group, open } of CENSUS_PROFILE_GROUPS) {
    const fields: CensusProfileField[] = [];
    for (const f of CENSUS_FIELDS) {
      if (f.group !== group || f.profile === false) continue;
      const value = f.get(student);
      if (value === null || value === "") continue;
      fields.push({ label: f.header, value: String(value) });
    }
    if (fields.length) out.push({ group, open, fields });
  }
  return out;
}
