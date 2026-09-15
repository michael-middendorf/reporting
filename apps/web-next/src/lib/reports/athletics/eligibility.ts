import type { CensusRawStudent } from "../census/lists-core";
import { coachingSportKeyForRecord } from "./overview";
import type { SlateRow } from "./types";
import {
  normalizeRosterRow,
  type NormalizedRosterRow,
} from "../athletics-coaching/enrollment";
import { sportByKey } from "../athletics-coaching/sports";

export const ELIGIBILITY_CURRENT_TERM = "Fall 2026";
export const ELIGIBILITY_PRIOR_TERM = "Spring 2026";
export const ELIGIBILITY_SECOND_LAST_TERM = "Fall 2025";
export const ELIGIBILITY_SUMMER_TERM = "Summer 2026";

export type EligibilityAthlete = {
  name: string;
  email: string;
  pcid: string;
  sport: string;
  sportKey: string | null;
  classYear: string;
  currentHours: number | null;
  priorTermHours: number | null;
  secondLastHours: number | null;
  summerHours: number | null;
  earnedHours: number | null;
  cumGpa: number | null;
  fullTimeTerms: number | null;
  matriculation: string;
};

export type EligibilitySnapshot = {
  generatedAt: string | null;
  currentTerm: string;
  priorTerm: string;
  secondLastTerm: string;
  summerTerm: string;
  athletes: EligibilityAthlete[];
};

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pcidKey(value: string): string {
  return value.trim().toUpperCase();
}

function emailKey(value: string): string {
  return value.trim().toLowerCase();
}

export function censusIndex(students: CensusRawStudent[]): {
  byPcid: Map<string, CensusRawStudent>;
  byEmail: Map<string, CensusRawStudent>;
} {
  const byPcid = new Map<string, CensusRawStudent>();
  const byEmail = new Map<string, CensusRawStudent>();
  for (const student of students) {
    const pcid = pcidKey(student.pcid || "");
    const email = emailKey(student.email || "");
    if (pcid) byPcid.set(pcid, student);
    if (email) byEmail.set(email, student);
  }
  return { byPcid, byEmail };
}

function findCensus(
  row: NormalizedRosterRow,
  index: ReturnType<typeof censusIndex>,
): CensusRawStudent | null {
  const pcid = pcidKey(row.pcid);
  if (pcid && index.byPcid.has(pcid)) return index.byPcid.get(pcid) || null;
  const email = emailKey(row.email);
  if (email && index.byEmail.has(email)) return index.byEmail.get(email) || null;
  return null;
}

export function eligibilitySportKey(row: NormalizedRosterRow, census: CensusRawStudent | null): string | null {
  if (row.sportKey) return row.sportKey;
  return coachingSportKeyForRecord({
    sport: row.currentSport || census?.sport || "",
    gender: census?.gender || "",
  });
}

function athleteName(row: NormalizedRosterRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || row.email || row.pcid || "Unnamed";
}

export function buildEligibilityAthletes(
  rosterRows: SlateRow[],
  currentStudents: CensusRawStudent[],
  priorStudents: CensusRawStudent[],
): EligibilityAthlete[] {
  const current = censusIndex(currentStudents);
  const prior = censusIndex(priorStudents);
  const seen = new Set<string>();
  const athletes: EligibilityAthlete[] = [];
  rosterRows.forEach((raw, index) => {
    const row = normalizeRosterRow(raw);
    const id = pcidKey(row.pcid) || emailKey(row.email) || `row-${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    const now = findCensus(row, current);
    const then = findCensus(row, prior);
    const sportKey = eligibilitySportKey(row, now);
    athletes.push({
      name: athleteName(row),
      email: row.email,
      pcid: row.pcid,
      sport: sportByKey[sportKey || ""]?.label || row.currentSport || now?.sport || "",
      sportKey,
      classYear: row.classYear || now?.classLevel || "",
      currentHours: asNumber(now?.credits),
      priorTermHours: null,
      secondLastHours: asNumber(then?.credits),
      summerHours: null,
      earnedHours: asNumber(now?.earnedCredits),
      cumGpa: asNumber(now?.gpa),
      fullTimeTerms: null,
      matriculation: (now?.admitTerm || "").trim(),
    });
  });
  return athletes.sort((a, b) => a.sport.localeCompare(b.sport) || a.name.localeCompare(b.name));
}

export function filterEligibilityBySports(
  athletes: EligibilityAthlete[],
  sportKeys: string[] | null,
): EligibilityAthlete[] {
  if (!sportKeys) return athletes;
  const allowed = new Set(sportKeys);
  return athletes.filter((row) => row.sportKey && allowed.has(row.sportKey));
}

export function eligibilityExportRows(athletes: EligibilityAthlete[]): (string | number)[][] {
  return [
    [
      "Name",
      "Email",
      "PCID",
      "Sport",
      "Class year",
      `Current hours (${ELIGIBILITY_CURRENT_TERM})`,
      `Prior term hours (${ELIGIBILITY_PRIOR_TERM})`,
      `Second-to-last term hours (${ELIGIBILITY_SECOND_LAST_TERM})`,
      `Summer / non-term hours (${ELIGIBILITY_SUMMER_TERM})`,
      "Cumulative hours earned",
      "Cumulative GPA",
      "Full-time terms (TOA)",
      "Date of matriculation",
    ],
    ...athletes.map((row) => [
      row.name,
      row.email,
      row.pcid,
      row.sport,
      row.classYear,
      row.currentHours ?? "",
      row.priorTermHours ?? "",
      row.secondLastHours ?? "",
      row.summerHours ?? "",
      row.earnedHours ?? "",
      row.cumGpa ?? "",
      row.fullTimeTerms ?? "",
      row.matriculation,
    ]),
  ];
}
