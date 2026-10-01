import { ADMIN_EMAILS, isAdmin, parseEmailCsv } from "../../access";
import { normalizeEmail } from "../../auth";
import { ambiguousSportKeys, resolveSportKey, SPORTS, sportByKey, type SportDef } from "./sports";

const HARDCODED_LEADERSHIP = [
  "eric.vanheusen@avemaria.edu",
  "john.weisbrod@avemaria.edu",
  "elizabeth.feger@avemaria.edu",
  "joshua.lewis@avemaria.edu",
] as const;

/**
 * Head coaches → coaching dashboard sport keys only. Not Master.
 * Do not add Michael Middendorf (Ultimate Frisbee HC is a hub admin).
 * Ty Kaufman (interim golf) has no public email and is omitted.
 * Cross country and track keys fold into XC/Track and Field.
 */
const HARDCODED_COACHES: Record<string, string[]> = {
  "robert.cooper@avemaria.edu": ["mens-baseball"],
  "jamon.copeland@avemaria.edu": ["mens-basketball"],
  "jelani.akil@avemaria.edu": ["womens-basketball"],
  "john.schmidt@avemaria.edu": ["womens-volleyball"],
  "camryn.e.olive@avemaria.edu": ["dance-team"],
  "alan.webb@avemaria.edu": ["xc-track"],
  "joseph.patterson@avemaria.edu": ["football"],
  "katelyn.j.sherman@avemaria.edu": ["womens-lacrosse"],
  "ryan.dolnick@avemaria.edu": ["rugby"],
  "dariel.collazo@avemaria.edu": ["mens-soccer"],
  "tyler.rosser@avemaria.edu": ["womens-soccer"],
  "trinity.e.medina@avemaria.edu": ["womens-softball"],
  "joshua.harriott@avemaria.edu": ["swim-team"],
  "steve.smith@avemaria.edu": ["tennis"],
};

function leadershipEmails(): Set<string> {
  const emails = parseEmailCsv(HARDCODED_LEADERSHIP.join(","));
  for (const email of ADMIN_EMAILS) emails.add(normalizeEmail(email));
  for (const email of parseEmailCsv(process.env.ATHLETICS_COACHING_LEADERSHIP_EMAILS || "")) {
    emails.add(email);
  }
  return emails;
}

function normalizeSportKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = String(item || "");
    const expanded = ambiguousSportKeys(text);
    const resolved = expanded ?? [resolveSportKey(text)].filter((key): key is string => Boolean(key));
    for (const key of resolved) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function envCoachMap(): Record<string, string[]> {
  const raw = (process.env.ATHLETICS_COACHING_COACHES || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [email, sports] of Object.entries(parsed as Record<string, unknown>)) {
      const normalized = normalizeEmail(email);
      const keys = normalizeSportKeys(sports);
      if (normalized && keys.length) out[normalized] = keys;
    }
    return out;
  } catch {
    return {};
  }
}

function coachMap(): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [email, sports] of Object.entries(HARDCODED_COACHES)) {
    const keys = normalizeSportKeys(sports);
    if (keys.length) merged[normalizeEmail(email)] = keys;
  }
  for (const [email, sports] of Object.entries(envCoachMap())) {
    const existing = merged[email] || [];
    merged[email] = [...new Set([...existing, ...sports])];
  }
  return merged;
}

export function isCoachingLeadership(email: string): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  if (isAdmin(e)) return true;
  return leadershipEmails().has(e);
}

export function coachSportKeys(email: string): string[] | "all" {
  const e = normalizeEmail(email);
  if (!e) return [];
  if (isCoachingLeadership(e)) return "all";
  return coachMap()[e] || [];
}

export function canAccessSport(email: string, key: string): boolean {
  if (!sportByKey[key]) return false;
  const keys = coachSportKeys(email);
  if (keys === "all") return true;
  return keys.includes(key);
}

export function hasCoachingGrant(email: string): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  if (isCoachingLeadership(e)) return true;
  return (coachMap()[e] || []).length > 0;
}

export function coachingGrantEmails(): string[] {
  return [...new Set([...leadershipEmails(), ...Object.keys(coachMap())])].sort();
}

export function visibleSports(email: string): SportDef[] {
  const keys = coachSportKeys(email);
  if (keys === "all") return [...SPORTS];
  return keys.map((key) => sportByKey[key]).filter((sport): sport is SportDef => Boolean(sport));
}

export function coachingRole(email: string): "leadership" | "coach" | null {
  if (isCoachingLeadership(email)) return "leadership";
  if ((coachMap()[normalizeEmail(email)] || []).length) return "coach";
  return null;
}
