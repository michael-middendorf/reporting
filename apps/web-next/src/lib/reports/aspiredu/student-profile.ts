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
  attendancePulse,
  gpaPointsFromPercent,
  isAB,
  letterFromPercent,
  normalizePcid,
  type AttendancePulse,
} from "../athletics-coaching/academics";
import { normalizeRosterRow, type NormalizedRosterRow } from "../athletics-coaching/enrollment";
import { isUgDegreeSeekingRow, type CensusRawStudent } from "../census/lists-core";
import { censusResidencyOf } from "../census/residency";
import { censusProfileGroups, type CensusProfileGroup } from "./census-fields";
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
  /** True when percentageAttendance was computed here from session counts. */
  attendanceDerived: boolean;
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
  /** The full census row (every field), for this one student only. */
  record: CensusRawStudent;
  /** Profile sections from census-fields.ts, blanks already dropped. */
  groups: CensusProfileGroup[];
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

export type JoinCandidate = { pcid?: string | null; ids?: (string | null | undefined)[]; email?: string | null };

/** 1 = PCID, 2 = SIS id, 3 = email, 0 = no match. Lower is stronger. */
function matchTier(keys: JoinKeys, candidate: JoinCandidate): number {
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
export function bestMatches<T>(keys: JoinKeys, items: T[], toCandidate: (item: T) => JoinCandidate): T[] {
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

/**
 * Indexed form of bestMatches for bulk joins (the spreadsheet joins every
 * student). Same tiers and same result order as bestMatches.
 */
export function buildJoinIndex<T>(
  items: T[],
  toCandidate: (item: T) => JoinCandidate,
): { lookup: (keys: JoinKeys) => T[] } {
  const byPcid = new Map<string, number[]>();
  const byId = new Map<string, number[]>();
  const byEmail = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, index: number) => {
    const list = map.get(key);
    if (!list) map.set(key, [index]);
    else if (list[list.length - 1] !== index) list.push(index);
  };
  items.forEach((item, index) => {
    const candidate = toCandidate(item);
    const pcid = candidate.pcid ? normalizePcid(candidate.pcid) : null;
    if (pcid) add(byPcid, pcid, index);
    for (const id of [candidate.pcid, ...(candidate.ids || [])]) {
      const raw = rawId(id);
      if (raw) add(byId, raw, index);
    }
    const email = (candidate.email || "").trim().toLowerCase();
    if (email) add(byEmail, email, index);
  });
  const pick = (indexes: number[]) => [...new Set(indexes)].sort((a, b) => a - b).map((i) => items[i]!);
  return {
    lookup(keys) {
      if (keys.pcid) {
        const hits = byPcid.get(keys.pcid);
        if (hits?.length) return pick(hits);
      }
      if (keys.sisId) {
        const hits = byId.get(keys.sisId);
        if (hits?.length) return pick(hits);
      }
      const emailHits = keys.emails.flatMap((email) => byEmail.get(email) ?? []);
      return emailHits.length ? pick(emailHits) : [];
    },
  };
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
  return athleticsFromHits(bestMatches<NormalizedRosterRow>(keys, normalized, rosterCandidate), asOf);
}

export function rosterCandidate(row: NormalizedRosterRow): JoinCandidate {
  return { pcid: row.pcid, ids: [row.personReferenceId], email: row.email };
}

export function athleticsFromHits(hits: NormalizedRosterRow[], asOf: string | null): AthleticsAssociation | null {
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

/**
 * residents.json only holds the current term (TARGET_SESSION plus the extra
 * Ireland session), but one student can have more than one row. Prefer a row
 * with an actual building, then the latest eRez start date.
 */
export function pickCurrentResident(hits: Resident[]): Resident | undefined {
  const score = (r: Resident) => (r.building && r.building !== "Commuter" ? 1 : 0);
  const start = (r: Resident) => Date.parse(r.move_in_erez || "") || 0;
  return [...hits].sort((a, b) => score(b) - score(a) || start(b) - start(a))[0];
}

export function housingAssociation(
  keys: JoinKeys,
  residents: Resident[],
  asOf: string | null,
): HousingAssociation | null {
  return housingFromHits(bestMatches(keys, residents, residentCandidate), asOf);
}

export function residentCandidate(resident: Resident): JoinCandidate {
  return { pcid: resident.pcid, email: resident.email };
}

export function housingFromHits(hits: Resident[], asOf: string | null): HousingAssociation | null {
  const hit = pickCurrentResident(hits);
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
  return censusFromHits(bestMatches(keys, students, censusCandidate), asOf);
}

export function censusCandidate(student: CensusRawStudent): JoinCandidate {
  return { pcid: student.pcid, email: student.email };
}

/**
 * A dual UG+GRAD student has two census rows under one PCID. Prefer the
 * primary undergraduate row (Program UNDERG, degree-seeking), then any UNDERG
 * row, then the first.
 */
export function pickCensusRow(hits: CensusRawStudent[]): CensusRawStudent | undefined {
  const ug = (s: CensusRawStudent) => (s.program || "").trim().toUpperCase() === "UNDERG";
  return (
    hits.find((s) => ug(s) && isUgDegreeSeekingRow(s.program, s.collegeAttend, s.degree)) ??
    hits.find(ug) ??
    hits[0]
  );
}

export function censusFromHits(hits: CensusRawStudent[], asOf: string | null): CensusAssociation | null {
  const hit = pickCensusRow(hits);
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
    record: hit,
    groups: censusProfileGroups(hit),
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

/**
 * AspireDU's own percentage when it sent one. Otherwise, when the Lambda only
 * had session counts (no attendance-summary row matched), compute
 * round((present + late) / (present + late + absent) * 100).
 */
export function attendancePercent(record: Record<string, unknown>): {
  percentageAttendance: number | null;
  attendanceDerived: boolean;
} {
  const delivered = num(record.percentageAttendance);
  if (delivered !== null) return { percentageAttendance: delivered, attendanceDerived: false };
  const present = num(record.timesPresent);
  const absent = num(record.timesAbsent);
  if (present === null || absent === null) return { percentageAttendance: null, attendanceDerived: false };
  const attended = present + (num(record.timesLate) ?? 0);
  const total = attended + absent;
  if (total <= 0) return { percentageAttendance: null, attendanceDerived: false };
  return { percentageAttendance: Math.round((attended / total) * 100), attendanceDerived: true };
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
    ...attendancePercent(record),
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

/** Same buckets as the Lambda's attendanceStatusBucket(). */
export function sessionBucket(status: string | null | undefined): "present" | "absent" | "late" | null {
  const value = (status || "").trim().toLowerCase();
  if (!value) return null;
  if (/late|tardy/.test(value)) return "late";
  if (/absent/.test(value)) return "absent";
  if (value === "p" || /\bpresent\b/.test(value)) return "present";
  return null;
}

/**
 * The profile Lambda sends pulseFromSessions() counts:
 * { present, absent, late, other, sessionCount, latestClassDate? }.
 * Derive the band with the same attendancePulse() the coaching page uses.
 * `sessions` is newest first. An already-banded pulse is also accepted.
 */
export function normalizePulse(
  value: unknown,
  sessions: ProfileSession[] = [],
  now?: Date,
): AttendancePulse | null {
  const record = asRecord(value);
  if (!record) return null;
  const band = record.band;
  if (band === "attending" || band === "watch" || band === "inactive") {
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
  const sessionCount = num(record.sessionCount);
  if (!sessionCount) return null;
  // "Last attended" is the newest present/late session. latestClassDate is the
  // newest class of any status, so it is only a fallback when the Lambda sent
  // counts without the session list.
  const attended = sessions.find((session) => {
    const bucket = sessionBucket(session.status);
    return bucket === "present" || bucket === "late";
  });
  const lastAttended = attended?.classDate ?? (sessions.length ? null : str(record.latestClassDate));
  return attendancePulse({
    present: num(record.present),
    absent: num(record.absent),
    late: num(record.late),
    sessionCount,
    latestSession: sessions[0] ? sessionBucket(sessions[0].status) : null,
    lastAttended,
    now,
  });
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/**
 * Grade KPIs shared by the profile and the spreadsheet: unweighted GPA
 * estimate from letter points, average percent, and graded classes under 80%.
 */
export function gradeKpis(grades: (number | null)[]): {
  gpaEstimate: number | null;
  avgGrade: number | null;
  gradedCourses: number;
  belowAbCount: number;
} {
  const graded = grades.filter((g): g is number => g !== null && Number.isFinite(g));
  return {
    gpaEstimate: graded.length
      ? round(graded.reduce((sum, g) => sum + gpaPointsFromPercent(g), 0) / graded.length, 2)
      : null,
    avgGrade: graded.length ? round(graded.reduce((sum, g) => sum + g, 0) / graded.length, 1) : null,
    gradedCourses: graded.length,
    belowAbCount: graded.filter((g) => !isAB(letterFromPercent(g))).length,
  };
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
  // Newest first, regardless of delivery order.
  sessions.sort((a, b) => (Date.parse(b.classDate) || 0) - (Date.parse(a.classDate) || 0));
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

  const grades = gradeKpis(courses.map((c) => c.grade));

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
      gpaEstimate: grades.gpaEstimate,
      avgGrade: grades.avgGrade,
      gradedCourses: grades.gradedCourses,
      courseCount: courses.length,
      belowAbCount: grades.belowAbCount,
      totalAbsences: sumOrNull(courses.map((c) => c.timesAbsent)),
      totalMissing: sumOrNull(courses.map((c) => c.missing)),
      risk: student.risk,
      riskTrend: student.riskTrend,
      lastLogin: student.lastLogin,
    },
    courses,
    sessions,
    pulse: normalizePulse(record.pulse, sessions),
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
