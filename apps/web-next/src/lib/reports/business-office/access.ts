import { isBusinessOfficeUser } from "../../access";
import { normalizeEmail } from "../../auth";
import { coachingRole, coachSportKeys } from "../athletics-coaching/access";
import { sportByKey } from "../athletics-coaching/sports";

/**
 * Who sees which athletics finances (DST-2983).
 *
 * - Business Office list (REPORT_ALLOWED["business-office"]) and hub admins:
 *   every team, department-wide, and the unassigned departments.
 * - Coaching leadership: every team and department-wide, not unassigned.
 * - Head coaches: only their own sport(s), never a cross-team list.
 * - Everyone else: null (403).
 */
export type FinanceScope =
  | { all: true; showUnassigned: boolean }
  | { all: false; sports: string[] };

export function financeScope(email: string | null | undefined): FinanceScope | null {
  const e = normalizeEmail(email || "");
  if (!e) return null;
  if (isBusinessOfficeUser(e)) return { all: true, showUnassigned: true };
  const role = coachingRole(e);
  if (role === "leadership") return { all: true, showUnassigned: false };
  if (role === "coach") {
    const keys = coachSportKeys(e);
    const sports = keys === "all" ? [] : keys.filter((key) => Boolean(sportByKey[key]));
    return sports.length ? { all: false, sports } : null;
  }
  return null;
}

export function financeScopeAllowsSport(scope: FinanceScope, sportKey: string): boolean {
  if (!sportByKey[sportKey]) return false;
  return scope.all || scope.sports.includes(sportKey);
}
