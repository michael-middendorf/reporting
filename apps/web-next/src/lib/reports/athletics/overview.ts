import { canAccessReport, sportsScopeForAthleticsEmail } from "../../access";
import { canAccessSport, isCoachingLeadership } from "../athletics-coaching/access";
import type { EnrollmentAccess } from "../athletics-coaching/enrollment";
import { isSportKey, SPORTS, resolveSportKey, sportByKey, type SportDef } from "../athletics-coaching/sports";

export {
  coachingSportKeyForRecord,
  recordMatchesCoachingSport,
  recruitingOverviewStats,
  type RecruitingOverviewStats,
} from "./overview-stats";

function coachingKeysForAssignment(sports: readonly string[], genders?: readonly string[]): string[] {
  const keys = new Set<string>();
  const genderSet = new Set((genders || []).map((item) => item.toUpperCase()));
  for (const name of sports) {
    const direct = resolveSportKey(name);
    if (direct) {
      keys.add(direct);
      continue;
    }
    const folded = name.trim().toLowerCase();
    if (folded === "basketball" || folded === "soccer" || folded === "golf") {
      const men = !genderSet.size || genderSet.has("M");
      const women = !genderSet.size || genderSet.has("F");
      if (folded === "basketball") {
        if (men) keys.add("mens-basketball");
        if (women) keys.add("womens-basketball");
      }
      if (folded === "soccer") {
        if (men) keys.add("mens-soccer");
        if (women) keys.add("womens-soccer");
      }
      if (folded === "golf") {
        if (men) keys.add("mens-golf");
        if (women) keys.add("womens-golf");
      }
      continue;
    }
    for (const sport of SPORTS) {
      const names = [sport.label, sport.key, ...sport.slateNames].map((item) => item.toLowerCase());
      if (!names.includes(folded)) continue;
      if (sport.gender === "M" && genderSet.size && !genderSet.has("M")) continue;
      if (sport.gender === "W" && genderSet.size && !genderSet.has("F")) continue;
      keys.add(sport.key);
    }
  }
  return [...keys];
}

export function visibleOverviewSports(email: string): SportDef[] {
  if (isCoachingLeadership(email)) return [...SPORTS];
  const fromCoaching = SPORTS.filter((sport) => canAccessSport(email, sport.key));
  const scope = sportsScopeForAthleticsEmail(email);
  const fromMaster =
    scope === "all"
      ? [...SPORTS]
      : coachingKeysForAssignment(scope.sports, scope.genders)
          .map((key) => sportByKey[key])
          .filter((sport): sport is SportDef => Boolean(sport));
  const seen = new Set<string>();
  const out: SportDef[] = [];
  for (const sport of [...fromCoaching, ...fromMaster]) {
    if (seen.has(sport.key)) continue;
    seen.add(sport.key);
    out.push(sport);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function canSeeOverviewSport(email: string, sportKey: string): boolean {
  if (!sportByKey[sportKey]) return false;
  return visibleOverviewSports(email).some((sport) => sport.key === sportKey);
}

/** Fundraising/academics APIs for Coaching and Master Overview. */
export function sportDashboardAccess(email: string | null, sportParam: string | null): EnrollmentAccess {
  if (!email) return { ok: false, status: 401, error: "Authentication required" };
  const sport = (sportParam || "").trim();
  if (!sport || !isSportKey(sport)) {
    return { ok: false, status: 400, error: "Unknown sport" };
  }
  if (canAccessReport(email, "athletics-coaching") && canAccessSport(email, sport)) {
    return { ok: true, email, sport };
  }
  if (canAccessReport(email, "athletics") && canSeeOverviewSport(email, sport)) {
    return { ok: true, email, sport };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}
