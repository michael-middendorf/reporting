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

export type OfficeHoursSource = "history" | "unknown";

export type OfficeHoursRow = {
  name: string;
  email: string;
  pcid: string;
  course: string;
  grade: number | null;
  letter: string;
  missing: number | null;
  firstSeen: string | null;
  daysBelow: number | null;
  source: OfficeHoursSource | null;
  lowerBound: boolean | null;
};

export type OfficeHoursLedgerEntry = {
  firstSeen: string;
  letter: string;
  grade: number;
  source: OfficeHoursSource;
  lowerBound?: boolean;
};

export type OfficeHoursHistoryCourse = {
  email?: string;
  studentSisId?: string;
  pcid?: string;
  sisId?: string;
  course?: string;
  courseSisId?: string;
  courseGrade?: number | null;
};

export type OfficeHoursGradeSnapshot = {
  asOf: string;
  courses: OfficeHoursHistoryCourse[];
};

export type OfficeHoursHistoryHit = {
  firstSeen: string;
  lowerBound: boolean;
};

export type OfficeHoursHistoryBackfill = Record<string, OfficeHoursHistoryHit>;

export type OfficeHoursLedger = {
  updatedAt: string;
  entries: Record<string, OfficeHoursLedgerEntry>;
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

export function officeHoursLedgerObjectKey(sport: string): string {
  const safe = (sport || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "") || "unknown";
  return `athletics-coaching-academics/office-hours-below-ab/${safe}.json`;
}

/** Stable S3 ledger id: email if present, otherwise PCID, then course. */
export function officeHoursLedgerKey(email: string, pcid: string, course: string): string {
  const id = normalizeEmail(email) || (pcid || "").trim();
  return `${id}|${course}`;
}

/** Whole days from firstSeen to asOf, never negative. Invalid dates count as 0. */
export function daysBelow(firstSeenIso: string, asOfIso: string): number {
  const first = Date.parse(firstSeenIso);
  const asOf = Date.parse(asOfIso);
  if (Number.isNaN(first) || Number.isNaN(asOf)) return 0;
  return Math.max(0, Math.floor((asOf - first) / DAY_MS));
}

function isBelowABPercent(grade: number): boolean {
  return !isAB(letterFromPercent(grade));
}

function ledgerSource(value: unknown): OfficeHoursSource {
  return value === "history" ? "history" : "unknown";
}

function sameOfficeHoursStudent(item: OfficeHoursHistoryCourse, email: string, pcid: string): boolean {
  const wantEmail = normalizeEmail(email);
  const itemEmail = normalizeEmail(asString(item.email));
  if (wantEmail && itemEmail && wantEmail === itemEmail) return true;
  const wantPcid = normalizePcid(pcid) || asString(pcid).toUpperCase();
  const itemPcid =
    normalizePcid(asString(item.studentSisId) || asString(item.pcid) || asString(item.sisId)) ||
    asString(item.studentSisId || item.pcid || item.sisId).toUpperCase();
  return Boolean(wantPcid && itemPcid && wantPcid === itemPcid);
}

function sameOfficeHoursCourse(
  item: OfficeHoursHistoryCourse,
  course: string,
  courseSisId?: string,
): boolean {
  const wantCourse = asString(course).toLowerCase();
  const itemCourse = asString(item.course).toLowerCase();
  if (wantCourse && itemCourse && wantCourse === itemCourse) return true;
  const wantSis = asString(courseSisId);
  const itemSis = asString(item.courseSisId);
  return Boolean(wantSis && itemSis && wantSis === itemSis);
}

function observedGrade(
  snapshot: OfficeHoursGradeSnapshot,
  target: { email: string; pcid: string; course: string; courseSisId?: string },
): number | null {
  for (const item of snapshot.courses) {
    if (!sameOfficeHoursStudent(item, target.email, target.pcid)) continue;
    if (!sameOfficeHoursCourse(item, target.course, target.courseSisId)) continue;
    const grade = asFiniteNumber(item.courseGrade);
    if (grade !== null) return grade;
  }
  return null;
}

/** Earliest asOf of the current stretch below 80%. Oldest-first snapshots. */
export function firstSeenBelowAB(
  snapshots: OfficeHoursGradeSnapshot[],
  target: { email: string; pcid: string; course: string; courseSisId?: string },
): OfficeHoursHistoryHit | null {
  const observations: { asOf: string; below: boolean }[] = [...snapshots]
    .sort((a, b) => (Date.parse(a.asOf) || 0) - (Date.parse(b.asOf) || 0))
    .flatMap((snapshot) => {
      const grade = observedGrade(snapshot, target);
      if (grade === null || !asString(snapshot.asOf)) return [];
      return [{ asOf: snapshot.asOf, below: isBelowABPercent(grade) }];
    });
  if (!observations.length) return null;

  let lastRecoveryIndex = -1;
  for (let i = 0; i < observations.length; i += 1) {
    if (!observations[i].below) lastRecoveryIndex = i;
  }
  const firstBelow = observations.slice(lastRecoveryIndex + 1).find((row) => row.below);
  if (!firstBelow) return null;
  return {
    firstSeen: firstBelow.asOf,
    lowerBound: lastRecoveryIndex < 0,
  };
}

export function officeHoursHistoryFromSnapshots(
  officeHoursRows: Pick<OfficeHoursRow, "email" | "pcid" | "course">[],
  snapshots: OfficeHoursGradeSnapshot[],
): OfficeHoursHistoryBackfill {
  const out: OfficeHoursHistoryBackfill = {};
  for (const row of officeHoursRows) {
    const course = (row.course || "").trim();
    if (!course) continue;
    const hit = firstSeenBelowAB(snapshots, { email: row.email, pcid: row.pcid, course });
    if (!hit) continue;
    out[officeHoursLedgerKey(row.email, row.pcid, course)] = hit;
  }
  return out;
}

export function officeHoursNeedsHistory(
  officeHoursRows: Pick<OfficeHoursRow, "email" | "pcid" | "course">[],
  ledger: OfficeHoursLedger | null | undefined,
): boolean {
  if (!officeHoursRows.length) return false;
  const entries =
    ledger?.entries && typeof ledger.entries === "object" && !Array.isArray(ledger.entries) ? ledger.entries : {};
  return officeHoursRows.some((row) => {
    const course = (row.course || "").trim();
    if (!course) return false;
    return entries[officeHoursLedgerKey(row.email, row.pcid, course)]?.source !== "history";
  });
}

export function officeHoursDurationLabel(
  daysBelowValue: number | null,
  options?: { source?: OfficeHoursSource | null; lowerBound?: boolean | null },
): string {
  if (daysBelowValue === null || options?.source !== "history") return "unknown";
  const n = Math.max(0, daysBelowValue);
  if (options?.lowerBound) {
    if (n <= 1) return "at least 1 day";
    return `at least ${n} days`;
  }
  if (n <= 0) return "today";
  if (n === 1) return "1 day";
  return `${n} days`;
}

function ledgerEntryFromRow(
  row: Pick<OfficeHoursRow, "letter" | "grade">,
  existing: OfficeHoursLedgerEntry | undefined,
  firstSeen: string,
  source: OfficeHoursSource,
  lowerBound: boolean,
): OfficeHoursLedgerEntry {
  const grade =
    typeof row.grade === "number" && Number.isFinite(row.grade)
      ? row.grade
      : typeof existing?.grade === "number" && Number.isFinite(existing.grade)
        ? existing.grade
        : 0;
  return {
    firstSeen,
    letter: row.letter,
    grade,
    source,
    ...(lowerBound ? { lowerBound: true } : {}),
  };
}

export function mergeOfficeHoursLedger(
  prev: OfficeHoursLedger | null | undefined,
  officeHoursRows: Pick<OfficeHoursRow, "email" | "pcid" | "course" | "letter" | "grade">[],
  asOfIso: string,
  backfill?: OfficeHoursHistoryBackfill | null,
): OfficeHoursLedger {
  const prevEntries =
    prev?.entries && typeof prev.entries === "object" && !Array.isArray(prev.entries) ? prev.entries : {};
  const entries: Record<string, OfficeHoursLedgerEntry> = {};
  for (const row of officeHoursRows) {
    const course = (row.course || "").trim();
    if (!course) continue;
    const key = officeHoursLedgerKey(row.email, row.pcid, course);
    const existing = prevEntries[key];
    const existingSource = ledgerSource(existing?.source);
    const history = backfill?.[key];
    if (existingSource === "history" && typeof existing?.firstSeen === "string" && existing.firstSeen) {
      entries[key] = ledgerEntryFromRow(
        row,
        existing,
        existing.firstSeen,
        "history",
        existing.lowerBound === true,
      );
      continue;
    }
    if (history?.firstSeen) {
      entries[key] = ledgerEntryFromRow(row, existing, history.firstSeen, "history", history.lowerBound === true);
      continue;
    }
    entries[key] = ledgerEntryFromRow(row, existing, asOfIso, "unknown", false);
  }
  return { updatedAt: asOfIso, entries };
}

function withOfficeHoursDuration(
  rows: OfficeHoursRow[],
  ledger: OfficeHoursLedger | null | undefined,
  asOfIso: string,
): OfficeHoursRow[] {
  if (!ledger) {
    return rows.map((row) => ({ ...row, firstSeen: null, daysBelow: null, source: null, lowerBound: null }));
  }
  return rows.map((row) => {
    const key = officeHoursLedgerKey(row.email, row.pcid, row.course);
    const entry = ledger.entries[key];
    const firstSeen = (typeof entry?.firstSeen === "string" && entry.firstSeen) || asOfIso;
    const source = ledgerSource(entry?.source);
    const lowerBound = entry?.lowerBound === true;
    return {
      ...row,
      firstSeen,
      daysBelow: daysBelow(firstSeen, asOfIso),
      source,
      lowerBound,
    };
  });
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
  const latestAbsenceDate = asString(record.latestAbsenceDate);
  let timesAbsent = asFiniteNumber(record.timesAbsent);
  if (timesAbsent === null && latestAbsenceDate) timesAbsent = 1;
  const timesPresent = asFiniteNumber(record.timesPresent);
  const percentageAttendance = asFiniteNumber(record.percentageAttendance);
  if (
    !course &&
    grade === null &&
    missing === null &&
    !lastAccess &&
    !latestAbsenceDate &&
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
    if (sessionAbsences >= 2) {
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
          firstSeen: null,
          daysBelow: null,
          source: null,
          lowerBound: null,
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
  officeHoursLedger?: OfficeHoursLedger | null;
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
  const asOf = lambdaAsOf(input.lambdaResult) || input.rosterPulledAt || null;
  const kpis = summarizeMatchedAthletes(athletes);
  kpis.officeHours = withOfficeHoursDuration(
    kpis.officeHours,
    input.officeHoursLedger,
    asOf || now.toISOString(),
  );
  return {
    sport: input.sport,
    sportLabel,
    rosterAvailable: true,
    asOf,
    matchRate: rosterCount ? matchedCount / rosterCount : null,
    matchedCount,
    rosterCount,
    athletes,
    ...kpis,
  };
}
