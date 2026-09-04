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

export type AttendancePulseBand = "attending" | "watch" | "inactive";
export type AttendancePulseSource = "session" | "last-attended";

export type AttendancePulse = {
  band: AttendancePulseBand;
  source: AttendancePulseSource;
  lastAttended: string | null;
};

export type AcademicsCourse = {
  course: string;
  grade: number | null;
  missing: number | null;
  lastAccess: string | null;
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

export type AcademicsSummary = {
  sport: string;
  sportLabel: string;
  rosterAvailable: boolean;
  rosterReason?: typeof ROSTER_UNAVAILABLE_REASON;
  asOf: string | null;
  matchRate: number | null;
  matchedCount: number;
  rosterCount: number;
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
  const next = `/athletics/coaching/${sport}`;
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
  latestSession?: string | null;
  lastAttended?: string | null;
  now?: Date;
}): AttendancePulse | null {
  const now = input.now || new Date();
  const lastAttended = asString(input.lastAttended) || null;
  const latest = normalizeSessionStatus(input.latestSession);
  const sessionBand = bandFromSession(
    latest,
    input.present ?? null,
    input.absent ?? null,
    input.late ?? null,
  );
  if (sessionBand) {
    return { band: sessionBand, source: "session", lastAttended };
  }
  if (lastAttended) {
    const band = bandFromLastAttended(lastAttended, now);
    if (band) return { band, source: "last-attended", lastAttended };
  }
  return null;
}

function pickLastAttended(record: Record<string, unknown>, attendance: Record<string, unknown> | null): string | null {
  const candidates = [
    attendance?.lastAttended,
    attendance?.latestAttendanceDate,
    attendance?.latestAttendance,
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
  if (!course && grade === null && missing === null && !lastAccess) return null;
  return {
    course: course || "Course",
    grade,
    missing,
    lastAccess,
  };
}

function mapSnapshot(value: unknown): Snapshot | null {
  const record = asRecord(value);
  if (!record) return null;
  const attendance = asRecord(record.attendance);
  const email = normalizeEmail(asString(record.email));
  const pcid =
    normalizePcid(asString(record.pcid) || asString(record.studentSisId) || asString(record.sisId)) || "";
  const riskValue = record.riskBand ?? record.risk ?? record.riskScore;
  const risk = riskValue === undefined || riskValue === null || riskValue === "" ? null : String(riskValue);
  const latestFromSessions = asArray(record.sessions)
    .map((session) => {
      const item = asRecord(session);
      return item ? { status: normalizeSessionStatus(item.status ?? item.attendance), at: asString(item.date ?? item.classDate ?? item.timestamp) } : null;
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
    lastAttended: pickLastAttended(record, attendance) || latestFromSessions?.at || null,
    present: asFiniteNumber(attendance?.present ?? record.timesPresent ?? record.present),
    absent: asFiniteNumber(attendance?.absent ?? record.timesAbsent ?? record.absent),
    late: asFiniteNumber(attendance?.late ?? record.timesLate ?? record.late),
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
  };
}
