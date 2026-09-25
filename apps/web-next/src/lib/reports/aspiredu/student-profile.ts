/**
 * Academic Affairs single-student profile.
 *
 * Pure view-model builder: takes the AspireDU `profile` Lambda payload plus the
 * athletics roster, eRez residents, and census students, finds the ONE matching
 * record in each source, and returns only that record. Bulk rows never leave
 * the server.
 *
 * Join order per source: PCID (P + 9 digits) -> raw SIS id -> lowercase email
 * (with @avemaria.edu / @my.avemaria.edu variants).
 */
import type { SlateRow } from "../athletics/types";
import {
  gpaPointsFromPercent,
  isAB,
  letterFromPercent,
  normalizePcid,
  type AttendancePulse,
} from "../athletics-coaching/academics";
import { normalizeRosterRow, type NormalizedRosterRow } from "../athletics-coaching/enrollment";
import type { CensusRawStudent } from "../census/lists-core";
import { censusResidencyOf } from "../census/residency";
import { HALL_REGISTRY } from "../housing/names";
import type { Resident } from "../housing/types";

export const PROFILE_UNAVAILABLE = "Student profiles are not enabled yet.";
export const STUDENT_KEY_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

/* ---------- Lambda contract (action "profile") ---------- */

export type ProfileAsOf = {
  courses: string | null;
  attendance: string | null;
  attendanceSummary: string | null;
  notes: string | null;
  alerts: string | null;
};

export type ProfileLambdaStudent = {
  studentKey: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  studentSisId: string | null;
  risk: number | null;
  riskTrend: number | null;
  lastLogin: string | null;
};

export type ProfileLambdaCourse = {
  course: string;
  courseSisId: string | null;
  sectionSisId: string | null;
  term: string | null;
  grade: number | null;
  riskScore: number | null;
  riskTrend: number | null;
  missing: number | null;
  zero: number | null;
  lda: string | null;
  lastAccess: string | null;
  latestAttendance: string | null;
  timesPresent: number | null;
  timesAbsent: number | null;
  percentageAttendance: number | null;
  latestAbsenceDate: string | null;
};

export type ProfileSession = { classDate: string; course: string; status: string };

export type ProfileNote = {
  datetime: string | null;
  author: string | null;
  course: string | null;
  text: string;
  tags: string | null;
  alert: string | null;
  term: string | null;
};

export type ProfileAlert = {
  datetime: string | null;
  author: string | null;
  course: string | null;
  text: string;
};

/* ---------- View model ---------- */

export type ProfileCourse = ProfileLambdaCourse & {
  letter: string;
  belowAB: boolean;
};

export type AthleticsAssociation = {
  pcid: string | null;
  sports: string[];
  primarySport: string | null;
  secondSport: string | null;
  amuStatus: string | null;
  classYear: string | null;
  incomingReturning: string | null;
  asOf: string | null;
};

export type HousingAssociation = {
  hall: string | null;
  buildingCode: string | null;
  room: string | null;
  residency: string | null;
  session: string | null;
  moveIn: string | null;
  asOf: string | null;
};

export type CensusAssociation = {
  pcid: string | null;
  classLevel: string | null;
  program: string | null;
  majors: string[];
  fullPart: string | null;
  incomingReturning: string | null;
  residency: string | null;
  household: string | null;
  institute: string | null;
  honors: string | null;
  fsp: string | null;
  marines: string | null;
  sport: string | null;
  cumulativeGpa: number | null;
  credits: number | null;
  earnedCredits: number | null;
  asOf: string | null;
};

/** matched: record found. not_found: source loaded, no match. unavailable: source could not be read. */
export type AssociationStatus = "matched" | "not_found" | "unavailable";

export type StudentProfile = {
  studentKey: string;
  identity: {
    name: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    pcid: string | null;
    studentSisId: string | null;
    classYear: string | null;
  };
  asOf: ProfileAsOf;
  kpis: {
    gpaEstimate: number | null;
    avgGrade: number | null;
    gradedCourses: number;
    courseCount: number;
    belowAbCount: number;
    totalAbsences: number | null;
    totalMissing: number | null;
    risk: number | null;
    riskTrend: number | null;
    lastLogin: string | null;
  };
  courses: ProfileCourse[];
  sessions: ProfileSession[];
  pulse: AttendancePulse | null;
  notes: ProfileNote[];
  alerts: ProfileAlert[];
  associations: {
    athletics: AthleticsAssociation | null;
    housing: HousingAssociation | null;
    census: CensusAssociation | null;
  };
  associationStatus: {
    athletics: AssociationStatus;
    housing: AssociationStatus;
    census: AssociationStatus;
  };
  gaps: string[];
};

export type ProfileSources = {
  roster: { rows: SlateRow[]; asOf: string | null } | null;
  housing: { residents: Resident[]; asOf: string | null } | null;
  census: { students: CensusRawStudent[]; asOf: string | null } | null;
};

/* ---------- coercion helpers ---------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/* ---------- join keys ---------- */

const AMU_DOMAINS = ["avemaria.edu", "my.avemaria.edu"];

/** Lowercase email plus its @avemaria.edu / @my.avemaria.edu twin. */
export function emailVariants(raw: string | null | undefined): string[] {
  const email = (raw || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return [];
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!AMU_DOMAINS.includes(domain)) return [email];
  return AMU_DOMAINS.map((d) => `${local}@${d}`);
}

function rawId(value: string | null | undefined): string | null {
  const text = (value || "").trim().toUpperCase();
  return text || null;
}

export type JoinKeys = { pcid: string | null; sisId: string | null; emails: string[] };

export function profileJoinKeys(student: {
  studentSisId?: string | null;
  email?: string | null;
}): JoinKeys {
  const sis = student.studentSisId ?? null;
  return {
    pcid: sis ? normalizePcid(sis) : null,
    sisId: rawId(sis),
    emails: emailVariants(student.email),
  };
}

type Candidate = { pcid?: string | null; ids?: (string | null | undefined)[]; email?: string | null };

/** 1 = PCID, 2 = SIS id, 3 = email, 0 = no match. Lower is stronger. */
function matchTier(keys: JoinKeys, candidate: Candidate): number {
  if (keys.pcid && candidate.pcid) {
    const pcid = normalizePcid(candidate.pcid);
    if (pcid && pcid === keys.pcid) return 1;
  }
  if (keys.sisId) {
    for (const id of [candidate.pcid, ...(candidate.ids || [])]) {
      if (rawId(id) === keys.sisId) return 2;
    }
  }
  if (keys.emails.length && candidate.email) {
    const email = candidate.email.trim().toLowerCase();
    if (email && keys.emails.includes(email)) return 3;
  }
  return 0;
}

/** Every item that matches at the strongest tier any item reaches. */
export function bestMatches<T>(keys: JoinKeys, items: T[], toCandidate: (item: T) => Candidate): T[] {
  let best = 0;
  let hits: T[] = [];
  for (const item of items) {
    const tier = matchTier(keys, toCandidate(item));
    if (!tier) continue;
    if (!best || tier < best) {
      best = tier;
      hits = [item];
    } else if (tier === best) {
      hits.push(item);
    }
  }
  return hits;
}

/* ---------- association builders ---------- */

function uniq(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = (value || "").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

export function athleticsAssociation(
  keys: JoinKeys,
  rows: SlateRow[],
  asOf: string | null,
): AthleticsAssociation | null {
  const normalized = rows.map(normalizeRosterRow);
  const hits = bestMatches<NormalizedRosterRow>(keys, normalized, (row) => ({
    pcid: row.pcid,
    ids: [row.personReferenceId],
    email: row.email,
  }));
  if (!hits.length) return null;
  const first = hits[0]!;
  return {
    pcid: normalizePcid(first.pcid),
    sports: uniq(hits.flatMap((row) => [row.currentSport, row.secondSport])),
    primarySport: str(first.currentSport),
    secondSport: str(hits.map((row) => row.secondSport).find((value) => str(value)) ?? null),
    amuStatus: str(first.amuStatus),
    classYear: str(first.classYear),
    incomingReturning: str(first.incomingReturning),
    asOf,
  };
}

export function housingAssociation(
  keys: JoinKeys,
  residents: Resident[],
  asOf: string | null,
): HousingAssociation | null {
  const hit = bestMatches(keys, residents, (resident) => ({
    pcid: resident.pcid,
    email: resident.email,
  }))[0];
  if (!hit) return null;
  const code = str(hit.building);
  // Same residency buckets the census uses (On Campus, Commuter, Ireland, Rome...).
  const residency = censusResidencyOf(hit);
  const hall = code ? HALL_REGISTRY[code.toUpperCase()]?.name ?? (residency === "Commuter" ? null : code) : null;
  return {
    hall,
    buildingCode: code,
    room: hall ? str(hit.room) : null,
    residency,
    session: str(hit.session),
    moveIn: str(hit.move_in),
    asOf,
  };
}

export function censusAssociation(
  keys: JoinKeys,
  students: CensusRawStudent[],
  asOf: string | null,
): CensusAssociation | null {
  const hit = bestMatches(keys, students, (student) => ({
    pcid: student.pcid,
    email: student.email,
  }))[0];
  if (!hit) return null;
  return {
    pcid: normalizePcid(hit.pcid || ""),
    classLevel: str(hit.classLevel),
    program: str(hit.curriculumName) ?? str(hit.program),
    majors: uniq(hit.declaredMajors || []),
    fullPart: str(hit.fullPart),
    incomingReturning: str(hit.incomingReturning),
    residency: str(hit.residency),
    household: str(hit.household),
    institute: str(hit.institute),
    honors: str(hit.honors),
    fsp: str(hit.fsp),
    marines: str(hit.marines),
    sport: str(hit.sport),
    cumulativeGpa: num(hit.gpa),
    credits: num(hit.credits),
    earnedCredits: num(hit.earnedCredits),
    asOf,
  };
}

const NO_VALUES = new Set(["", "n", "no", "0", "false", "-", "none", "not listed", "unassigned"]);

/** True for Y / Yes / 1 / a program name; false for blank, N, No, 0, dash. */
export function isYesFlag(value: string | null | undefined): boolean {
  return !NO_VALUES.has((value || "").trim().toLowerCase());
}

/* ---------- Lambda payload normalization ---------- */

function normalizeStudent(value: unknown, studentKey: string): ProfileLambdaStudent | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    studentKey: str(record.studentKey) ?? studentKey,
    firstName: str(record.firstName),
    lastName: str(record.lastName),
    email: str(record.email),
    studentSisId: str(record.studentSisId),
    risk: num(record.risk),
    riskTrend: num(record.riskTrend),
    lastLogin: str(record.lastLogin),
  };
}

function normalizeCourse(value: unknown): ProfileCourse | null {
  const record = asRecord(value);
  if (!record) return null;
  const course = str(record.course) ?? str(record.courseSisId);
  if (!course) return null;
  const grade = num(record.grade);
  const letter = letterFromPercent(grade);
  return {
    course,
    courseSisId: str(record.courseSisId),
    sectionSisId: str(record.sectionSisId),
    term: str(record.term),
    grade,
    riskScore: num(record.riskScore),
    riskTrend: num(record.riskTrend),
    missing: num(record.missing),
    zero: num(record.zero),
    lda: str(record.lda),
    lastAccess: str(record.lastAccess),
    latestAttendance: str(record.latestAttendance),
    timesPresent: num(record.timesPresent),
    timesAbsent: num(record.timesAbsent),
    percentageAttendance: num(record.percentageAttendance),
    latestAbsenceDate: str(record.latestAbsenceDate),
    letter,
    // Ungraded courses are not "below A/B"; only a real grade under 80% is.
    belowAB: grade !== null && !isAB(letter),
  };
}

function normalizeAsOf(value: unknown): ProfileAsOf {
  const record = asRecord(value) || {};
  return {
    courses: str(record.courses),
    attendance: str(record.attendance),
    attendanceSummary: str(record.attendanceSummary),
    notes: str(record.notes),
    alerts: str(record.alerts),
  };
}

function list<T>(value: unknown, map: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const mapped = map(item);
    if (mapped) out.push(mapped);
  }
  return out;
}

function normalizePulse(value: unknown): AttendancePulse | null {
  const record = asRecord(value);
  if (!record) return null;
  const band = record.band;
  if (band !== "attending" && band !== "watch" && band !== "inactive") return null;
  return {
    band,
    source: record.source === "last-attended" ? "last-attended" : "session",
    lastAttended: str(record.lastAttended),
    present: num(record.present),
    absent: num(record.absent),
    late: num(record.late),
    sessionCount: num(record.sessionCount),
  };
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/* ---------- gaps ---------- */

export const ALWAYS_MISSING = [
  "Academic advisor",
  "Registrar holds",
  "Class meeting times and rooms",
  "Official midterm and final grades",
];

export function profileGaps(census: CensusAssociation | null): string[] {
  const gaps = [...ALWAYS_MISSING];
  if (!census) gaps.push("Cumulative GPA and earned credits (no census record)");
  return gaps;
}

/* ---------- main builder ---------- */

export type LambdaProfileStatus = "ok" | "not_found" | "awaiting_first_delivery";

/** Reads `status` / `student` off a profile payload without trusting its shape. */
export function lambdaProfileStatus(result: unknown): LambdaProfileStatus {
  const record = asRecord(result);
  if (!record) return "not_found";
  if (record.status === "awaiting_first_delivery") return "awaiting_first_delivery";
  if (record.status === "not_found" || !asRecord(record.student)) return "not_found";
  return "ok";
}

export function buildStudentProfile(input: {
  studentKey: string;
  lambdaResult: unknown;
  sources: ProfileSources;
}): StudentProfile | null {
  const record = asRecord(input.lambdaResult);
  if (!record) return null;
  const student = normalizeStudent(record.student, input.studentKey);
  if (!student) return null;

  const courses = list(record.courses, normalizeCourse);
  const sessions = list<ProfileSession>(record.sessions, (item) => {
    const r = asRecord(item);
    const classDate = str(r?.classDate);
    if (!r || !classDate) return null;
    return { classDate, course: str(r.course) ?? "", status: str(r.status) ?? "" };
  });
  const notes = list<ProfileNote>(record.notes, (item) => {
    const r = asRecord(item);
    const text = str(r?.text);
    if (!r || !text) return null;
    return {
      datetime: str(r.datetime),
      author: str(r.author),
      course: str(r.course),
      text,
      tags: str(r.tags),
      alert: str(r.alert),
      term: str(r.term),
    };
  });
  const alerts = list<ProfileAlert>(record.alerts, (item) => {
    const r = asRecord(item);
    const text = str(r?.text);
    if (!r || !text) return null;
    return { datetime: str(r.datetime), author: str(r.author), course: str(r.course), text };
  });

  const keys = profileJoinKeys(student);
  const { roster, housing, census } = input.sources;
  const athletics = roster ? athleticsAssociation(keys, roster.rows, roster.asOf) : null;
  const housingBlock = housing ? housingAssociation(keys, housing.residents, housing.asOf) : null;
  const censusBlock = census ? censusAssociation(keys, census.students, census.asOf) : null;
  const status = (source: unknown, block: unknown): AssociationStatus =>
    source ? (block ? "matched" : "not_found") : "unavailable";

  const graded = courses.filter((c): c is ProfileCourse & { grade: number } => c.grade !== null);
  const gpaEstimate = graded.length
    ? round(graded.reduce((sum, c) => sum + gpaPointsFromPercent(c.grade), 0) / graded.length, 2)
    : null;
  const avgGrade = graded.length ? round(graded.reduce((sum, c) => sum + c.grade, 0) / graded.length, 1) : null;

  const pcid = keys.pcid ?? censusBlock?.pcid ?? athletics?.pcid ?? null;

  const name = [student.firstName, student.lastName].filter(Boolean).join(" ") || "Unnamed student";

  return {
    studentKey: student.studentKey,
    identity: {
      name,
      firstName: student.firstName,
      lastName: student.lastName,
      email: student.email,
      pcid,
      studentSisId: student.studentSisId,
      classYear: athletics?.classYear ?? censusBlock?.classLevel ?? null,
    },
    asOf: normalizeAsOf(record.asOf),
    kpis: {
      gpaEstimate,
      avgGrade,
      gradedCourses: graded.length,
      courseCount: courses.length,
      belowAbCount: courses.filter((c) => c.belowAB).length,
      totalAbsences: sumOrNull(courses.map((c) => c.timesAbsent)),
      totalMissing: sumOrNull(courses.map((c) => c.missing)),
      risk: student.risk,
      riskTrend: student.riskTrend,
      lastLogin: student.lastLogin,
    },
    courses,
    sessions,
    pulse: normalizePulse(record.pulse),
    notes,
    alerts,
    associations: { athletics, housing: housingBlock, census: censusBlock },
    associationStatus: {
      athletics: status(roster, athletics),
      housing: status(housing, housingBlock),
      census: status(census, censusBlock),
    },
    gaps: profileGaps(censusBlock),
  };
}
