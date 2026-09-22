import { canAccessReport } from "../../access";
import { eligibleIncomingSigned } from "../athletics/normalize";
import type { AthleticsRecord, SlateRow } from "../athletics/types";
import { canAccessSport } from "./access";
import { isSportKey, resolveGenderedSportKey, sportByKey } from "./sports";

export const ROSTER_UNAVAILABLE_REASON = "awaiting_roster_secret" as const;

export type EnrollmentAccessOk = {
  ok: true;
  email: string;
  sport: string;
};

export type EnrollmentAccessDeny = {
  ok: false;
  status: 401 | 400 | 403;
  error: string;
};

export type EnrollmentAccess = EnrollmentAccessOk | EnrollmentAccessDeny;

export type EnrollmentCount = {
  available: boolean;
  count: number | null;
  reason?: typeof ROSTER_UNAVAILABLE_REASON | "unavailable";
};

export type ClassYearMix = { label: string; count: number };

export type NormalizedRosterRow = {
  email: string;
  pcid: string;
  personReferenceId: string;
  firstName: string;
  lastName: string;
  currentSport: string;
  secondSport: string;
  amuStatus: string;
  incomingReturning: string;
  classYear: string;
  sportKey: string | null;
  secondSportKey: string | null;
};

export type EnrollmentSummary = {
  sport: string;
  sportLabel: string;
  generatedAt: string | null;
  roster: EnrollmentCount & { classYearMix: ClassYearMix[] };
  signed: EnrollmentCount;
  applications: EnrollmentCount;
};

function field(row: SlateRow, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  const wanted = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const [key, candidate] of Object.entries(row)) {
    const folded = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!wanted.has(folded)) continue;
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return "";
}

export function normalizeRosterRow(row: SlateRow): NormalizedRosterRow {
  const currentSport = field(
    row,
    "currentsport",
    "currentSport",
    "CurrentSport",
    "PersonSport",
    "Sport",
    "AthletePrimaryTeam",
  );
  const secondSport = field(
    row,
    "_2ndsport",
    "2ndsport",
    "secondsport",
    "secondSport",
    "Sport2",
    "SecondarySport",
    "CurrentSport2",
    "PersonSport2",
  );
  const gender = field(row, "gender", "Gender", "PersonGender", "Sex");
  return {
    email: field(row, "email", "amuemail", "Email", "PersonEmail"),
    pcid: field(row, "pcid", "PCID", "PcId"),
    personReferenceId: field(row, "personreferenceid", "PersonReferenceID", "personReferenceId"),
    firstName: field(row, "firstname", "FirstName", "PersonFirstName"),
    lastName: field(row, "lastname", "LastName", "PersonLastName"),
    currentSport,
    secondSport,
    amuStatus: field(row, "amustatus", "AMUStatus", "amuStatus"),
    incomingReturning: field(row, "incomingreturning", "IncomingReturning", "incomingReturning"),
    classYear: field(
      row,
      "classyear",
      "class_year",
      "ClassYear",
      "studentclass",
      "classyr",
      "expectedgradyear",
    ),
    sportKey: resolveGenderedSportKey(currentSport, gender),
    secondSportKey: resolveGenderedSportKey(secondSport, gender),
  };
}

export function rosterMatchesSport(row: NormalizedRosterRow, sportKey: string): boolean {
  return row.sportKey === sportKey || row.secondSportKey === sportKey;
}

export function applicationMatchesSport(record: AthleticsRecord, sportKey: string): boolean {
  return resolveGenderedSportKey(record.sport, record.gender) === sportKey;
}

function rosterIdentity(row: NormalizedRosterRow, index: number): string {
  const id = row.personReferenceId || row.pcid || row.email.toLowerCase();
  if (id) return id;
  const name = `${row.firstName}|${row.lastName}`.trim().toLowerCase();
  return name && name !== "|" ? `name:${name}` : `row-${index}`;
}

function mixCounts(values: string[]): ClassYearMix[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function enrollmentAccess(email: string | null, sportParam: string | null): EnrollmentAccess {
  if (!email) return { ok: false, status: 401, error: "Authentication required" };
  if (!canAccessReport(email, "athletics-coaching")) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const sport = (sportParam || "").trim();
  if (!sport || !isSportKey(sport)) {
    return { ok: false, status: 400, error: "Unknown sport" };
  }
  if (!canAccessSport(email, sport)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, email, sport };
}

export function buildEnrollmentSummary(input: {
  sport: string;
  rosterRows: SlateRow[] | null;
  applicationRows: AthleticsRecord[] | null;
  rosterPulledAt?: string | null;
  applicationsPulledAt?: string | null;
}): EnrollmentSummary {
  const sportLabel = sportByKey[input.sport]?.label || input.sport;
  const generatedAt = input.rosterPulledAt || input.applicationsPulledAt || null;

  let roster: EnrollmentSummary["roster"];
  if (input.rosterRows === null) {
    roster = {
      available: false,
      count: null,
      reason: ROSTER_UNAVAILABLE_REASON,
      classYearMix: [],
    };
  } else {
    const matched: NormalizedRosterRow[] = [];
    const seen = new Set<string>();
    input.rosterRows.forEach((raw, index) => {
      const row = normalizeRosterRow(raw);
      if (!rosterMatchesSport(row, input.sport)) return;
      const id = rosterIdentity(row, index);
      if (seen.has(id)) return;
      seen.add(id);
      matched.push(row);
    });
    roster = {
      available: true,
      count: matched.length,
      classYearMix: mixCounts(matched.map((row) => row.classYear)),
    };
  }

  let signed: EnrollmentCount;
  let applications: EnrollmentCount;
  if (input.applicationRows === null) {
    signed = { available: false, count: null, reason: "unavailable" };
    applications = { available: false, count: null, reason: "unavailable" };
  } else {
    const sportApps = input.applicationRows.filter((record) =>
      applicationMatchesSport(record, input.sport),
    );
    applications = { available: true, count: sportApps.length };
    signed = {
      available: true,
      count: sportApps.filter(eligibleIncomingSigned).length,
    };
  }

  return {
    sport: input.sport,
    sportLabel,
    generatedAt,
    roster,
    signed,
    applications,
  };
}
