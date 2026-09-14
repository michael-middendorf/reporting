import { canAccessReport } from "../../access";
import { normalizeEmail } from "../../auth";
import type { SlateRow } from "../athletics/types";
import {
  enrollmentAccess,
  normalizeRosterRow,
  rosterMatchesSport,
  ROSTER_UNAVAILABLE_REASON,
  type NormalizedRosterRow,
} from "./enrollment";
import { sportByKey } from "./sports";

export { enrollmentAccess, ROSTER_UNAVAILABLE_REASON };

export const COACHING_LAMBDA_UNAVAILABLE =
  "Academic snapshots are not available yet. The AspireDU coaching lookup is not enabled.";

const DAY_MS = 86_400_000;
const PCID_PATTERN = /^P\d{9}$/;

const LETTER_POINTS: Record<string, number> = {
  "A+": 4.0,
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  "C-": 1.7,
  "D+": 1.3,
  D: 1.0,
  "D-": 0.7,
  F: 0,
};

export type AttendancePulseBand = "attending" | "watch" | "inactive";
export type AttendancePulseSource = "session" | "last-attended";

export type AttendancePulse = {
  band: AttendancePulseBand;
  source: AttendancePulseSource;
  lastAttended: string | null;
  present: number | null;
  absent: number | null;
  late: number | null;
  sessionCount: number | null;
};

export type AcademicsCourse = {
  course: string;
  grade: number | null;
  missing: number | null;
  lastAccess: string | null;
  timesAbsent: number | null;
  timesPresent: number | null;
  percentageAttendance: number | null;
};

export type AcademicsAthlete = {
  name: string;
  email: string;
  pcid: string;
  matched: boolean;
  risk: string | null;
  pulse: AttendancePulse | null;
  lastAttended: string | null;
  courses: AcademicsCourse[];
};

export type OfficeHoursRow = {
  name: string;
  email: string;
  pcid: string;
  course: string;
  grade: number | null;
  letter: string;
  missing: number | null;
};

export type MissingClassRow = {
  name: string;
  email: string;
  pcid: string;
  sessionAbsences: number;
  coursesWithAbsences: { course: string; timesAbsent: number }[];
};

export type AcademicsSummary = {
  sport: string;
  sportLabel: string;
  rosterAvailable: boolean;
  rosterReason?: typeof ROSTER_UNAVAILABLE_REASON;
  asOf: string | null;
  matchRate: number | null;
  matchedCount: number;
  rosterCount: number;
  teamGpa: number | null;
  teamAvgPercent: number | null;
  peopleMissingClass: number;
  classesWithAbsences: number;
  totalAbsenceSessions: number;
  officeHours: OfficeHoursRow[];
  missingClass: MissingClassRow[];
  athletes: AcademicsAthlete[];
};

export type CoachingLambdaPayload = {
  action: "coaching";
  callerEmail: string;
  sport: string;
  emails: string[];
  pcids: string[];
};

type Snapshot = {
  email: string;
  pcid: string;
  risk: string | null;
  lastAttended: string | null;
  present: number | null;
  absent: number | null;
  late: number | null;
  sessionCount: number | null;
  latestSession: "present" | "absent" | "late" | null;
  courses: AcademicsCourse[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** Convert a 0-100 course percent to a letter. Null grade is "None". */
export function letterFromPercent(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "None";
  if (percent >= 97) return "A+";
  if (percent >= 93) return "A";
  if (percent >= 90) return "A-";
  if (percent >= 87) return "B+";
  if (percent >= 83) return "B";
  if (percent >= 80) return "B-";
  if (percent >= 77) return "C+";
  if (percent >= 73) return "C";
  if (percent >= 70) return "C-";
  if (percent >= 67) return "D+";
  if (percent >= 63) return "D";
  if (percent >= 60) return "D-";
  return "F";
}

/** 4.0-scale points for a 0-100 course percent. */
export function gpaPointsFromPercent(percent: number): number {
  return LETTER_POINTS[letterFromPercent(percent)] ?? 0;
}

/** True when the letter is A/A+/A- or B/B+/B-. */
export function isAB(letter: string): boolean {
  return letter.startsWith("A") || letter.startsWith("B");
}

export function normalizePcid(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return null;
  let digits = cleaned;
  if (digits.startsWith("P")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits) || digits.length > 9) return null;
  const pcid = `P${digits.padStart(9, "0")}`;
  return PCID_PATTERN.test(pcid) ? pcid : null;
}

function rosterIdentity(row: NormalizedRosterRow, index: number): string {
  const id = row.personReferenceId || row.pcid || row.email.toLowerCase();
  if (id) return id;
  const name = `${row.firstName}|${row.lastName}`.trim().toLowerCase();
  return name && name !== "|" ? `name:${name}` : `row-${index}`;
}

export function matchedRosterRows(rows: SlateRow[], sport: string): NormalizedRosterRow[] {
  const matched: NormalizedRosterRow[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const row = normalizeRosterRow(raw);
    if (!rosterMatchesSport(row, sport)) return;
    const id = rosterIdentity(row, index);
    if (seen.has(id)) return;
    seen.add(id);
    matched.push(row);
  });
  return matched;
}

export function rosterJoinKeys(rows: NormalizedRosterRow[]): { emails: string[]; pcids: string[] } {
  const emails = new Set<string>();
  const pcids = new Set<string>();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (email) emails.add(email);
    const pcid = normalizePcid(row.pcid);
    if (pcid) pcids.add(pcid);
  }
  return {
    emails: [...emails].sort(),
    pcids: [...pcids].sort(),
  };
}

export function coachingLambdaPayload(
  callerEmail: string,
  sport: string,
  rows: NormalizedRosterRow[],
): CoachingLambdaPayload {
  const keys = rosterJoinKeys(rows);
  return {
    action: "coaching",
    callerEmail: normalizeEmail(callerEmail),
    sport,
    emails: keys.emails,
    pcids: keys.pcids,
  };
}

export function coachingMfaUrl(sport: string): string {
  const next = `/athletics/coaching/${sport}/academics`;
  return `/athletics/coaching/mfa?next=${encodeURIComponent(next)}`;
}

/** Named-athlete academics: hub MFA, Academic Affairs, or leftover coaching TOTP cookie. */
export function academicsMfaUnlocked(input: {
  email: string;
  hubMfa: boolean;
  ferpa: boolean;
}): boolean {
  return input.ferpa || input.hubMfa || canAccessReport(input.email, "aspiredu");
}

export function safeCoachingNext(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value.startsWith("/athletics/coaching")) return "/athletics/coaching";
  if (value.startsWith("//") || value.includes("://")) return "/athletics/coaching";
  return value;
}

export function isCoachingActionUnavailable(result: unknown): boolean {
  if (result == null) return false;
  const text =
    result instanceof Error
      ? result.message
      : typeof result === "string"
        ? result
        : JSON.stringify(result);
  if (/unknown action|unsupported action/i.test(text)) return true;
  const record = asRecord(result);
  const status = record?.status ?? record?.statusCode;
  if (status === 501) return true;
  return /\b501\b/.test(text) && /action|not implemented|unknown|unsupported/i.test(text);
}

function daysSince(iso: string, now: Date): number | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const diff = now.getTime() - parsed;
  if (diff < 0) return 0;
  return Math.floor(diff / DAY_MS);
}

function normalizeSessionStatus(value: unknown): "present" | "absent" | "late" | null {
  const text = asString(value).toLowerCase();
  if (!text) return null;
  if (text === "present" || text === "p") return "present";
  if (text === "absent" || text === "a") return "absent";
  if (text === "late" || text === "l" || text === "tardy") return "late";
  return null;
}

function bandFromSession(
  latest: "present" | "absent" | "late" | null,
  present: number | null,
  absent: number | null,
  late: number | null,
): AttendancePulseBand | null {
  if (latest === "present") return "attending";
  if (latest === "late") return "watch";
  if (latest === "absent") return "inactive";
  const hasCounts = present !== null || absent !== null || late !== null;
  if (!hasCounts) return null;
  const p = present ?? 0;
  const a = absent ?? 0;
  const l = late ?? 0;
  if (p === 0 && a === 0 && l === 0) return null;
  if (p > 0 && a === 0 && l === 0) return "attending";
  if (a > 0 && a >= p && a >= l) return "inactive";
  if (l > 0 && l >= a) return "watch";
  if (p > a && p > l) return "attending";
  return "watch";
}

function bandFromLastAttended(lastAttended: string, now: Date): AttendancePulseBand | null {
  const days = daysSince(lastAttended, now);
  if (days === null) return null;
  if (days <= 7) return "attending";
  if (days <= 14) return "watch";
  return "inactive";
}

export function attendancePulse(input: {
  present?: number | null;
  absent?: number | null;
  late?: number | null;
  sessionCount?: number | null;
  latestSession?: string | null;
  lastAttended?: string | null;
  now?: Date;
}): AttendancePulse | null {
  const now = input.now || new Date();
  const lastAttended = asString(input.lastAttended) || null;
  const latest = normalizeSessionStatus(input.latestSession);
  const counts = {
    present: input.present ?? null,
    absent: input.absent ?? null,
    late: input.late ?? null,
    sessionCount: input.sessionCount ?? null,
  };
  const sessionBand = bandFromSession(
    latest,
    input.present ?? null,
    input.absent ?? null,
    input.late ?? null,
  );
  if (sessionBand) {
    return { band: sessionBand, source: "session", lastAttended, ...counts };
  }
  if (lastAttended) {
    const band = bandFromLastAttended(lastAttended, now);
    if (band) return { band, source: "last-attended", lastAttended, ...counts };
  }
  return null;
}

function pickLastAttended(
  record: Record<string, unknown>,
  attendance: Record<string, unknown> | null,
  pulse: Record<string, unknown> | null,
): string | null {
  const candidates = [
    pulse?.latestClassDate,
    pulse?.latestAttendanceDate,
    attendance?.lastAttended,
    attendance?.latestAttendanceDate,
    attendance?.latestAttendance,
    attendance?.latestClassDate,
    record.lastAttended,
    record.latestAttendanceDate,
    record.latestAttendance,
    record.courseLda,
  ];
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return null;
}

function mapCourse(value: unknown): AcademicsCourse | null {
  const record = asRecord(value);
  if (!record) return null;
  const course = asString(record.course) || asString(record.courseName) || asString(record.courseCode);
  const grade = asFiniteNumber(record.courseGrade ?? record.grade);
  const missing = asFiniteNumber(record.missingAssignments ?? record.missing);
  const lastAccess = asString(record.courseLastAccess) || asString(record.lastAccess) || null;
  const timesAbsent = asFiniteNumber(record.timesAbsent);
  const timesPresent = asFiniteNumber(record.timesPresent);
  const percentageAttendance = asFiniteNumber(record.percentageAttendance);
  if (
    !course &&
    grade === null &&
    missing === null &&
    !lastAccess &&
    timesAbsent === null &&
    timesPresent === null &&
    percentageAttendance === null
  ) {
    return null;
  }
  return {
    course: course || "Course",
    grade,
    missing,
    lastAccess,
    timesAbsent,
    timesPresent,
    percentageAttendance,
  };
}

function mapSnapshot(value: unknown): Snapshot | null {
  const record = asRecord(value);
  if (!record) return null;
  const pulse = asRecord(record.pulse);
  const attendance = asRecord(record.attendance);
  const counts = pulse || attendance;
  const email = normalizeEmail(asString(record.email));
  const pcid =
    normalizePcid(asString(record.pcid) || asString(record.studentSisId) || asString(record.sisId)) || "";
  const riskValue = record.overallRisk ?? record.riskBand ?? record.risk ?? record.riskScore;
  const risk = riskValue === undefined || riskValue === null || riskValue === "" ? null : String(riskValue);
  const latestFromSessions = asArray(record.sessions)
    .map((session) => {
      const item = asRecord(session);
      return item
        ? { status: normalizeSessionStatus(item.status ?? item.attendance), at: asString(item.date ?? item.classDate ?? item.timestamp) }
        : null;
    })
    .filter((item): item is { status: "present" | "absent" | "late" | null; at: string } => Boolean(item))
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))[0];
  const latestSession =
    normalizeSessionStatus(attendance?.latest ?? attendance?.latestSession ?? record.latestSession) ||
    latestFromSessions?.status ||
    null;
  return {
    email,
    pcid,
    risk,
    lastAttended: pickLastAttended(record, attendance, pulse) || latestFromSessions?.at || null,
    present: asFiniteNumber(counts?.present ?? record.timesPresent ?? record.present),
    absent: asFiniteNumber(counts?.absent ?? record.timesAbsent ?? record.absent),
    late: asFiniteNumber(counts?.late ?? record.timesLate ?? record.late),
    sessionCount: asFiniteNumber(counts?.sessionCount ?? record.sessionCount),
    latestSession,
    courses: asArray(record.courses).map(mapCourse).filter((course): course is AcademicsCourse => Boolean(course)),
  };
}

export function lambdaSnapshots(result: unknown): Snapshot[] {
  const record = asRecord(result);
  const rows = [
    ...asArray(record?.students),
    ...asArray(record?.snapshots),
    ...asArray(record?.athletes),
  ];
  return rows.map(mapSnapshot).filter((item): item is Snapshot => Boolean(item));
}

function lambdaAsOf(result: unknown): string | null {
  const record = asRecord(result);
  return asString(record?.asOf) || asString(record?.generatedAt) || null;
}

function findSnapshot(row: NormalizedRosterRow, byEmail: Map<string, Snapshot>, byPcid: Map<string, Snapshot>): Snapshot | null {
  const email = normalizeEmail(row.email);
  if (email && byEmail.has(email)) return byEmail.get(email) || null;
  const pcid = normalizePcid(row.pcid);
  if (pcid && byPcid.has(pcid)) return byPcid.get(pcid) || null;
  return null;
}

function athleteName(row: NormalizedRosterRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || row.email || row.pcid || "Unnamed";
}

function emptyKpis(): Pick<
  AcademicsSummary,
  | "teamGpa"
  | "teamAvgPercent"
  | "peopleMissingClass"
  | "classesWithAbsences"
  | "totalAbsenceSessions"
  | "officeHours"
  | "missingClass"
> {
  return {
    teamGpa: null,
    teamAvgPercent: null,
    peopleMissingClass: 0,
    classesWithAbsences: 0,
    totalAbsenceSessions: 0,
    officeHours: [],
    missingClass: [],
  };
}

function sessionAbsencesFor(athlete: AcademicsAthlete): number {
  if (athlete.pulse?.absent != null) return athlete.pulse.absent;
  return athlete.courses.reduce((sum, course) => sum + (course.timesAbsent ?? 0), 0);
}

function summarizeMatchedAthletes(athletes: AcademicsAthlete[]): Pick<
  AcademicsSummary,
  | "teamGpa"
  | "teamAvgPercent"
  | "peopleMissingClass"
  | "classesWithAbsences"
  | "totalAbsenceSessions"
  | "officeHours"
  | "missingClass"
> {
  const matched = athletes.filter((athlete) => athlete.matched);
  const studentGpas: number[] = [];
  const studentPercents: number[] = [];
  const officeHours: OfficeHoursRow[] = [];
  const missingClass: MissingClassRow[] = [];
  let classesWithAbsences = 0;
  let totalAbsenceSessions = 0;

  for (const athlete of matched) {
    const grades = athlete.courses
      .map((course) => course.grade)
      .filter((grade): grade is number => grade !== null);
    if (grades.length) {
      studentGpas.push(mean(grades.map(gpaPointsFromPercent)) as number);
      studentPercents.push(mean(grades) as number);
    }

    const sessionAbsences = sessionAbsencesFor(athlete);
    totalAbsenceSessions += sessionAbsences;
    const coursesWithAbsences = athlete.courses
      .filter((course) => (course.timesAbsent ?? 0) > 0)
      .map((course) => ({ course: course.course, timesAbsent: course.timesAbsent ?? 0 }));
    classesWithAbsences += coursesWithAbsences.length;
    if ((athlete.pulse?.absent ?? 0) > 0 || coursesWithAbsences.length) {
      missingClass.push({
        name: athlete.name,
        email: athlete.email,
        pcid: athlete.pcid,
        sessionAbsences,
        coursesWithAbsences,
      });
    }

    for (const course of athlete.courses) {
      const letter = letterFromPercent(course.grade);
      if (course.grade !== null && !isAB(letter)) {
        officeHours.push({
          name: athlete.name,
          email: athlete.email,
          pcid: athlete.pcid,
          course: course.course,
          grade: course.grade,
          letter,
          missing: course.missing,
        });
      }
    }
  }

  return {
    teamGpa: studentGpas.length ? roundTo(mean(studentGpas) as number, 2) : null,
    teamAvgPercent: studentPercents.length ? roundTo(mean(studentPercents) as number, 1) : null,
    peopleMissingClass: missingClass.length,
    classesWithAbsences,
    totalAbsenceSessions,
    officeHours,
    missingClass,
  };
}

export function buildAcademicsSummary(input: {
  sport: string;
  rosterRows: SlateRow[] | null;
  lambdaResult?: unknown;
  rosterPulledAt?: string | null;
  now?: Date;
}): AcademicsSummary {
  const sportLabel = sportByKey[input.sport]?.label || input.sport;
  if (input.rosterRows === null) {
    return {
      sport: input.sport,
      sportLabel,
      rosterAvailable: false,
      rosterReason: ROSTER_UNAVAILABLE_REASON,
      asOf: null,
      matchRate: null,
      matchedCount: 0,
      rosterCount: 0,
      athletes: [],
      ...emptyKpis(),
    };
  }

  const roster = matchedRosterRows(input.rosterRows, input.sport);
  const snapshots = lambdaSnapshots(input.lambdaResult);
  const byEmail = new Map<string, Snapshot>();
  const byPcid = new Map<string, Snapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.email && !byEmail.has(snapshot.email)) byEmail.set(snapshot.email, snapshot);
    if (snapshot.pcid && !byPcid.has(snapshot.pcid)) byPcid.set(snapshot.pcid, snapshot);
  }

  const now = input.now || new Date();
  const athletes = roster.map((row) => {
    const snapshot = findSnapshot(row, byEmail, byPcid);
    const lastAttended = snapshot?.lastAttended || null;
    const pulse = snapshot
      ? attendancePulse({
          present: snapshot.present,
          absent: snapshot.absent,
          late: snapshot.late,
          sessionCount: snapshot.sessionCount,
          latestSession: snapshot.latestSession,
          lastAttended,
          now,
        })
      : null;
    return {
      name: athleteName(row),
      email: normalizeEmail(row.email),
      pcid: normalizePcid(row.pcid) || row.pcid,
      matched: Boolean(snapshot),
      risk: snapshot?.risk || null,
      pulse,
      lastAttended,
      courses: snapshot?.courses || [],
    };
  });

  const matchedCount = athletes.filter((athlete) => athlete.matched).length;
  const rosterCount = athletes.length;
  return {
    sport: input.sport,
    sportLabel,
    rosterAvailable: true,
    asOf: lambdaAsOf(input.lambdaResult) || input.rosterPulledAt || null,
    matchRate: rosterCount ? matchedCount / rosterCount : null,
    matchedCount,
    rosterCount,
    athletes,
    ...summarizeMatchedAthletes(athletes),
  };
}
