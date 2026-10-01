import { normalizeEmail } from "@/lib/auth";
import { coachingGrantEmails, hasCoachingGrant } from "./reports/athletics-coaching/access";

/** Report ids used in routes and ACL checks. */
export const REPORT_IDS = [
  "enrollment",
  "census",
  "athletics",
  "athletics-coaching",
  "housing",
  "institute",
  "advancement",
  "chapel",
  "points",
  "portfolios",
  "annunciation",
  "aspiredu",
  "marketing",
  "mgo-analysis",
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
  census:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu,mark.middendorf@avemaria.edu,susan.gallagher@avemaria.edu,roger.nutt@avemaria.edu,daniel.davy@avemaria.edu",
  athletics: [
    "cole.j.cantu@avemaria.edu",
    "regina.m.pirolli@avemaria.edu",
    "michael.t.middendorf@avemaria.edu",
    "eric.vanheusen@avemaria.edu",
    "john.weisbrod@avemaria.edu",
    "elizabeth.feger@avemaria.edu",
  ].join(","),
  "athletics-coaching":
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu,eric.vanheusen@avemaria.edu,john.weisbrod@avemaria.edu,elizabeth.feger@avemaria.edu,joshua.lewis@avemaria.edu",
  housing: [
    "cole.j.cantu@avemaria.edu",
    "regina.m.pirolli@avemaria.edu",
    "susan.gallagher@avemaria.edu",
    "mark.middendorf@avemaria.edu",
    "dan.donaldson@avemaria.edu",
    // DST-1385 Level 1: requester, Housing Manager, Dean of Students, DRL
    "lauren.lahr@avemaria.edu",
    "jeffrey.stankovsky@avemaria.edu",
    "danielw.lendman@avemaria.edu",
    "brady.fehringer@avemaria.edu",
    // DST-1385 Level 2: Residence Area Managers
    "patrick.m.baalman@avemaria.edu",
    "colleen.carney@avemaria.edu",
    "nate.byers@avemaria.edu",
    "claudia.gerbic@avemaria.edu",
  ].join(","),
  institute:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,liam.j.orourke@avemaria.edu,garrett.j.hallinan@avemaria.edu,gabriel.f.mellino@avemaria.edu",
  advancement:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,cassandra.l.bournos@avemaria.edu,zena.weist@avemaria.edu,sarah.chichester@avemaria.edu,susan.gallagher@avemaria.edu,mark.middendorf@avemaria.edu,leslie.sonnen@avemaria.edu,julie.musselman@avemaria.edu,jim.thomas@avemaria.edu,becca.kennedy@avemaria.edu,michaelene.hayward@avemaria.edu",
  // Chapel Naming + Stained Glass only. Advancement grants also cover these
  // pages (see canAccessReport). Do not add chapel-only people to advancement.
  chapel: "robert.musselman@avemaria.edu",
  points:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,annie.esposito@avemaria.edu,leslie.sonnen@avemaria.edu,alanna.f.mccann@avemaria.edu,sean.e.kelly@avemaria.edu,joseph.c.blaso@avemaria.edu,elena.j.barnes@avemaria.edu,caleb.m.metzen@avemaria.edu,betsy.scaletty@avemaria.edu,natalia.p.abrams@avemaria.edu",
  // MGO + MA officers, Leslie (both teams), Annie (MA team). Jim is already an MGO.
  // Do not add Zena, Cassandra, Sarah, Susan, or Becca. Annie stays off advancement.
  portfolios:
    "beatrice.sanford@avemaria.edu,brigid.luzarraga@avemaria.edu,colleen.dolnick@avemaria.edu,jim.thomas@avemaria.edu,julie.musselman@avemaria.edu,marita.emond@avemaria.edu,mark.middendorf@avemaria.edu,matthew.buzzanca@avemaria.edu,patrick.oconnell@avemaria.edu,alanna.f.mccann@avemaria.edu,betsy.scaletty@avemaria.edu,caleb.m.metzen@avemaria.edu,elena.j.barnes@avemaria.edu,joseph.c.blaso@avemaria.edu,natalia.p.abrams@avemaria.edu,sean.e.kelly@avemaria.edu,leslie.sonnen@avemaria.edu,annie.esposito@avemaria.edu",
  annunciation:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,cassandra.l.bournos@avemaria.edu,zena.weist@avemaria.edu,susan.gallagher@avemaria.edu,mark.middendorf@avemaria.edu,leslie.sonnen@avemaria.edu,julie.musselman@avemaria.edu,jim.thomas@avemaria.edu,becca.kennedy@avemaria.edu",
  aspiredu:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu,daniel.davy@avemaria.edu,michaelene.hayward@avemaria.edu,maria.t.gomez@avemaria.edu,alexandra.r.baalman@avemaria.edu",
  marketing:
    "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu,zena.weist@avemaria.edu,susan.gallagher@avemaria.edu",
  // DST-2830: MGO Analysis and Management is Leslie and Jim only (admins via isAdmin).
  // Do not add other Advancement users here.
  "mgo-analysis": "leslie.sonnen@avemaria.edu,jim.thomas@avemaria.edu",
};

const ENV_KEYS: Record<ReportId, string> = {
  enrollment: "ENROLLMENT_ALLOWED_EMAILS",
  census: "CENSUS_ALLOWED_EMAILS",
  athletics: "ATHLETICS_ALLOWED_EMAILS",
  "athletics-coaching": "ATHLETICS_COACHING_ALLOWED_EMAILS",
  housing: "HOUSING_ALLOWED_EMAILS",
  institute: "INSTITUTE_ALLOWED_EMAILS",
  advancement: "ADVANCEMENT_ALLOWED_EMAILS",
  chapel: "CHAPEL_ALLOWED_EMAILS",
  points: "POINTS_ALLOWED_EMAILS",
  portfolios: "PORTFOLIOS_ALLOWED_EMAILS",
  annunciation: "ANNUNCIATION_ALLOWED_EMAILS",
  aspiredu: "ASPIREDU_ALLOWED_EMAILS",
  marketing: "MARKETING_ALLOWED_EMAILS",
  "mgo-analysis": "MGO_ANALYSIS_ALLOWED_EMAILS",
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
  if (allowedEmailsForReport(report).has(e)) return true;
  // Advancement includes the chapel subset (naming + stained glass).
  if (report === "chapel" && allowedEmailsForReport("advancement").has(e)) return true;
  // Coaches in the sport map get this report without an allowlist CSV row.
  if (report === "athletics-coaching" && hasCoachingGrant(e)) return true;
  return false;
}

/** Academic Affairs and coaching users finish TOTP or passkey at sign-in. */
export function needsMfaAtSignIn(email: string): boolean {
  return canAccessReport(email, "aspiredu") || canAccessReport(email, "athletics-coaching");
}

/** Magic-link complete: MFA users always pending, even with a hub session. */
export function sessionDecisionAtComplete(
  email: string,
  _alreadySignedIn: boolean,
): "session" | "mfa_pending" {
  return needsMfaAtSignIn(email) ? "mfa_pending" : "session";
}

/** Union of all report lists + admins — who may request a magic link. */
export function canLogin(email: string): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  if (isAdmin(e)) return true;
  if (REPORT_IDS.some((r) => allowedEmailsForReport(r).has(e))) return true;
  return hasCoachingGrant(e);
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
  for (const e of coachingGrantEmails()) set.add(e);
  return [...set].sort();
}

export function isReportId(value: string): value is ReportId {
  return (REPORT_IDS as readonly string[]).includes(value);
}

/**
 * Athletics row scope. `"all"` is hub admins plus an explicit unrestricted
 * set (athletics leadership). Coaches get sports, and optional Gender tokens.
 * Unknown non-admins fail closed (`sports: []`).
 *
 * Slate PersonSport is ungendered (Basketball, not "Men's Basketball").
 * Gender on the 2026-09-04 extracts is `M` / `F`.
 */
export type AthleticsSportScope =
  | "all"
  | { sports: readonly string[]; genders?: readonly string[] };

/** All sports, including empty-sport rows. Not hub admins. */
const UNRESTRICTED_ATHLETICS_EMAILS = [
  "eric.vanheusen@avemaria.edu",
  "john.weisbrod@avemaria.edu",
  "elizabeth.feger@avemaria.edu",
] as const;

const UNRESTRICTED_ATHLETICS_SET = new Set(
  UNRESTRICTED_ATHLETICS_EMAILS.map(normalizeEmail),
);

/**
 * Head-coach assignments from avemariagyrenes.com. Do not add Michael
 * Middendorf (Ultimate Frisbee HC is also a hub admin). Ty Kaufman
 * (interim golf) has no public email and is omitted.
 */
const ATHLETICS_SPORT_ASSIGNMENTS: Record<
  string,
  { sports: readonly string[]; genders?: readonly string[] }
> = {
  "robert.cooper@avemaria.edu": { sports: ["Baseball"] },
  "jamon.copeland@avemaria.edu": { sports: ["Basketball"], genders: ["M"] },
  "jelani.akil@avemaria.edu": { sports: ["Basketball"], genders: ["F"] },
  "john.schmidt@avemaria.edu": { sports: ["Volleyball"] },
  "camryn.e.olive@avemaria.edu": { sports: ["Competitive Dance"] },
  "alan.webb@avemaria.edu": { sports: ["Cross Country", "Track and Field"] },
  "joseph.patterson@avemaria.edu": { sports: ["Football"] },
  "katelyn.j.sherman@avemaria.edu": { sports: ["Lacrosse"], genders: ["F"] },
  "ryan.dolnick@avemaria.edu": { sports: ["Rugby"] },
  "dariel.collazo@avemaria.edu": { sports: ["Soccer"], genders: ["M"] },
  "tyler.rosser@avemaria.edu": { sports: ["Soccer"], genders: ["F"] },
  "trinity.e.medina@avemaria.edu": { sports: ["Softball"] },
  "joshua.harriott@avemaria.edu": { sports: ["Swimming"] },
  "steve.smith@avemaria.edu": { sports: ["Tennis"] },
};

function normalizeAthleticsToken(value: string): string {
  return value.trim().toLowerCase();
}

export function sportsScopeForAthleticsEmail(email: string): AthleticsSportScope {
  const e = normalizeEmail(email);
  if (!e) return { sports: [] };
  if (isAdmin(e) || UNRESTRICTED_ATHLETICS_SET.has(e)) return "all";
  return ATHLETICS_SPORT_ASSIGNMENTS[e] ?? { sports: [] };
}

/** `null` means every sport (admin / unrestricted). */
export function athleticsSportsForEmail(email: string): string[] | null {
  const scope = sportsScopeForAthleticsEmail(email);
  return scope === "all" ? null : [...scope.sports];
}

export function filterAthleticsRecords<T extends { sport: string; gender: string }>(
  records: readonly T[],
  scope: AthleticsSportScope,
): T[] {
  if (scope === "all") return records.slice();
  const sports = new Set(scope.sports.map(normalizeAthleticsToken).filter(Boolean));
  const genders = scope.genders
    ? new Set(scope.genders.map(normalizeAthleticsToken).filter(Boolean))
    : null;
  return records.filter((row) => {
    const sport = normalizeAthleticsToken(row.sport);
    if (!sport || !sports.has(sport)) return false;
    if (genders) {
      const gender = normalizeAthleticsToken(row.gender);
      if (!gender || !genders.has(gender)) return false;
    }
    return true;
  });
}

/** Clone arrays so a user-scoped response cannot mutate the process cache. */
export function filterAthleticsPayload<
  T extends { sport: string; gender: string },
  P extends { applications: T[]; prospects: T[] },
>(payload: P, scope: AthleticsSportScope): P {
  return {
    ...payload,
    applications: filterAthleticsRecords(payload.applications, scope),
    prospects: filterAthleticsRecords(payload.prospects, scope),
  };
}
