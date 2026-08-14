import { normalizeEmail } from "@/lib/auth";

/** Report ids used in routes and ACL checks. */
export const REPORT_IDS = [
  "enrollment",
  "housing",
  "institute",
  "mas",
  "points",
  "alumni",
  "annunciation",
] as const;

export type ReportId = (typeof REPORT_IDS)[number];

/** Always have access to every report. */
export const ADMIN_EMAILS = [
  "cole.j.cantu@avemaria.edu",
  "regina.m.pirolli@avemaria.edu",
] as const;

const ADMIN_SET = new Set(ADMIN_EMAILS.map(normalizeEmail));

/** Hardcoded defaults mirrored from each legacy project's ALLOWED_EMAILS. */
const DEFAULT_REPORT_ALLOWED: Record<ReportId, string> = {
  enrollment:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu",
  housing: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
  institute: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
  mas: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
  points: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
  alumni: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
  annunciation:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,cassandra.l.bournos@avemaria.edu,zena.weist@avemaria.edu",
};

const ENV_KEYS: Record<ReportId, string> = {
  enrollment: "ENROLLMENT_ALLOWED_EMAILS",
  housing: "HOUSING_ALLOWED_EMAILS",
  institute: "INSTITUTE_ALLOWED_EMAILS",
  mas: "MAS_ALLOWED_EMAILS",
  points: "POINTS_ALLOWED_EMAILS",
  alumni: "ALUMNI_ALLOWED_EMAILS",
  annunciation: "ANNUNCIATION_ALLOWED_EMAILS",
};

export function parseEmailCsv(csv: string): Set<string> {
  return new Set(
    csv
      .split(",")
      .map((e) => normalizeEmail(e))
      .filter(Boolean),
  );
}

export function isAdmin(email: string): boolean {
  return ADMIN_SET.has(normalizeEmail(email));
}

export function allowedEmailsForReport(report: ReportId): Set<string> {
  const envKey = ENV_KEYS[report];
  const raw = (process.env[envKey] || "").trim() || DEFAULT_REPORT_ALLOWED[report];
  return parseEmailCsv(raw);
}

export function canAccessReport(email: string, report: ReportId): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  if (isAdmin(e)) return true;
  return allowedEmailsForReport(report).has(e);
}

/** Union of all report lists + admins — who may request a magic link. */
export function canLogin(email: string): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  if (isAdmin(e)) return true;
  return REPORT_IDS.some((r) => allowedEmailsForReport(r).has(e));
}

export function reportsForEmail(email: string): ReportId[] {
  return REPORT_IDS.filter((r) => canAccessReport(email, r));
}

/** All emails that should receive daily magic links. */
export function allLoginEmails(): string[] {
  const set = new Set<string>(ADMIN_SET);
  for (const r of REPORT_IDS) {
    for (const e of allowedEmailsForReport(r)) set.add(e);
  }
  return [...set].sort();
}

export function isReportId(value: string): value is ReportId {
  return (REPORT_IDS as readonly string[]).includes(value);
}
