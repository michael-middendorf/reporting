import { normalizeEmail } from "@/lib/auth";

/** Report ids used in routes and ACL checks. */
export const REPORT_IDS = [
  "enrollment",
  "housing",
  "institute",
  "advancement",
  "points",
  "annunciation",
  "aspiredu",
] as const;

export type ReportId = (typeof REPORT_IDS)[number];

/** Always have access to every report. */
export const ADMIN_EMAILS = [
  "cole.j.cantu@avemaria.edu",
  "michael.t.middendorf@avemaria.edu",
  "regina.m.pirolli@avemaria.edu",
] as const;

const ADMIN_SET = new Set(ADMIN_EMAILS.map(normalizeEmail));

/**
 * Per-report access lists. THIS FILE IS THE SOURCE OF TRUTH for grants — add or
 * remove people here.
 *
 * The matching *_ALLOWED_EMAILS env vars (injected on ECS from the Secrets
 * Manager secret `amu-reporting/production/runtime`, and hardcoded in
 * sst.config.ts for the SST runtime) are merged in ADDITIVELY by
 * allowedEmailsForReport() rather than overriding this map.
 *
 * They used to override it, which made any grant added here dead code whenever
 * the env var happened to be set. That silently broke DST-1360: annie.esposito@
 * was granted Points access in 6869e092, but the deployed POINTS_ALLOWED_EMAILS
 * did not list her, so she stayed locked out and the sign-in page — correctly
 * enumeration-safe — told her to check her email anyway. Additive means a grant
 * here always takes effect, and nobody an env var currently allows loses access.
 */
const REPORT_ALLOWED: Record<ReportId, string> = {
  enrollment:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu,dan.donaldson@avemaria.edu,andres.a.jimenez@avemaria.edu,susan.gallagher@avemaria.edu,mark.middendorf@avemaria.edu",
  housing:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,susan.gallagher@avemaria.edu,mark.middendorf@avemaria.edu",
  institute: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
  advancement:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,cassandra.l.bournos@avemaria.edu,zena.weist@avemaria.edu,susan.gallagher@avemaria.edu,mark.middendorf@avemaria.edu",
  points: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,annie.esposito@avemaria.edu",
  annunciation:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,cassandra.l.bournos@avemaria.edu,zena.weist@avemaria.edu,susan.gallagher@avemaria.edu,mark.middendorf@avemaria.edu",
  aspiredu:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu",
};

const ENV_KEYS: Record<ReportId, string> = {
  enrollment: "ENROLLMENT_ALLOWED_EMAILS",
  housing: "HOUSING_ALLOWED_EMAILS",
  institute: "INSTITUTE_ALLOWED_EMAILS",
  advancement: "ADVANCEMENT_ALLOWED_EMAILS",
  points: "POINTS_ALLOWED_EMAILS",
  annunciation: "ANNUNCIATION_ALLOWED_EMAILS",
  aspiredu: "ASPIREDU_ALLOWED_EMAILS",
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
  // Union, not override — see the note on REPORT_ALLOWED above.
  const allowed = parseEmailCsv(REPORT_ALLOWED[report]);
  for (const email of parseEmailCsv(process.env[ENV_KEYS[report]] || "")) {
    allowed.add(email);
  }
  return allowed;
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
