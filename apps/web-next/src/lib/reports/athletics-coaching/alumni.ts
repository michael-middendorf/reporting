import type { SlateRow } from "../athletics/types";
import { normalizePcid } from "./academics";
import { resolveGenderedSportKey, resolvePcAssociation, sportByKey } from "./sports";

/**
 * Sport Alumni: graduated former athletes for one coaching sport.
 *
 * Sources (all optional; a missing feed degrades instead of failing):
 *   powercampus/athletic_alumni  one row per PCID + ASSOCIATION code, already
 *                                limited to living graduates who were on the
 *                                roster while enrolled (see queries.py).
 *   powercampus/graduates        every living graduate: decides who graduated.
 *   athletics/association_history Slate sport history (PCID, CurrentSport,
 *                                SecondSport, MF). Adds sport memberships only
 *                                for PCIDs that are in graduates.
 *
 * Contact data is limited to one personal email. No address, no phone.
 */

export type AlumniSource = "powercampus" | "slate";

export type AlumniRow = {
  pcid: string;
  firstName: string;
  lastName: string;
  name: string;
  classYear: number | null;
  degree: string;
  degreeTitle: string;
  graduationDate: string | null;
  firstYear: number | null;
  lastYear: number | null;
  yearsCount: number | null;
  /** Every coaching sport this person is linked to, by label (this sport first). */
  sports: string[];
  sources: AlumniSource[];
  email: string | null;
};

export type AlumniClassYearCount = { label: string; count: number };

export type AlumniSummary = {
  sport: string;
  sportLabel: string;
  available: boolean;
  reason?: "awaiting_powercampus";
  slateAvailable: boolean;
  generatedAt: string | null;
  total: number;
  byClassYear: AlumniClassYearCount[];
  emailsHidden: boolean;
  rows: AlumniRow[];
};

type Graduate = {
  pcid: string;
  firstName: string;
  lastName: string;
  suffix: string;
  degree: string;
  degreeTitle: string;
  graduationDate: string | null;
  classYear: number | null;
  email: string | null;
};

type Membership = {
  sport: string;
  firstYear: number | null;
  lastYear: number | null;
  yearsCount: number | null;
  source: AlumniSource;
};

function text(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  const wanted = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const [key, value] of Object.entries(row)) {
    if (!wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) continue;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function intOrNull(raw: string): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/** "2012-05-12 00:00:00" or "2012-05-12T00:00:00" -> "2012-05-12". */
function isoDate(raw: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : null;
}

function pcidOf(row: Record<string, unknown>): string | null {
  const raw = text(row, "PEOPLE_CODE_ID", "pcid", "PCID", "PcId");
  return raw ? normalizePcid(raw) : null;
}

function graduateFrom(row: Record<string, unknown>, pcid: string): Graduate {
  const graduationDate = isoDate(text(row, "GRADUATION_DATE"));
  const classYear =
    intOrNull(text(row, "CLASS_YEAR")) ?? (graduationDate ? Number(graduationDate.slice(0, 4)) : null);
  return {
    pcid,
    firstName: text(row, "FIRST_NAME"),
    lastName: text(row, "LAST_NAME"),
    suffix: text(row, "SUFFIX"),
    degree: text(row, "DEGREE"),
    degreeTitle: text(row, "FORMAL_TITLE"),
    graduationDate,
    classYear,
    email: text(row, "EMAIL") || null,
  };
}

function displayName(grad: Graduate): string {
  const name = [grad.firstName, grad.lastName].filter(Boolean).join(" ");
  const full = grad.suffix ? `${name} ${grad.suffix}` : name;
  return full || grad.pcid;
}

function mergeMembership(into: Membership, next: Membership): Membership {
  const firstYear =
    into.firstYear === null ? next.firstYear : next.firstYear === null ? into.firstYear : Math.min(into.firstYear, next.firstYear);
  const lastYear =
    into.lastYear === null ? next.lastYear : next.lastYear === null ? into.lastYear : Math.max(into.lastYear, next.lastYear);
  let yearsCount: number | null =
    into.yearsCount === null ? next.yearsCount : next.yearsCount === null ? into.yearsCount : into.yearsCount + next.yearsCount;
  // Varsity and JV codes for the same sport can share a year; never claim
  // more seasons than the first-to-last span.
  if (yearsCount !== null && firstYear !== null && lastYear !== null) {
    yearsCount = Math.min(yearsCount, lastYear - firstYear + 1);
  }
  const source: AlumniSource = into.source === "powercampus" || next.source === "powercampus" ? "powercampus" : "slate";
  return { sport: into.sport, firstYear, lastYear, yearsCount, source };
}

/** Slate sport keys for one association_history row (CurrentSport and SecondSport, gendered by MF). */
export function slateSportKeys(row: SlateRow): string[] {
  const gender = text(row, "MF", "mf", "gender", "Gender", "PersonGender", "Sex");
  const keys = new Set<string>();
  for (const raw of [
    text(row, "CurrentSport", "currentsport", "PersonSport", "Sport"),
    text(row, "SecondSport", "secondsport", "_2ndsport", "2ndsport", "Sport2"),
  ]) {
    if (!raw) continue;
    const key = resolveGenderedSportKey(raw, gender);
    if (key) keys.add(key);
  }
  return [...keys];
}

function classYearCounts(rows: AlumniRow[]): AlumniClassYearCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = row.classYear === null ? "Unknown" : String(row.classYear);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      if (a.label === "Unknown") return 1;
      if (b.label === "Unknown") return -1;
      return Number(b.label) - Number(a.label);
    });
}

export function compareAlumni(a: AlumniRow, b: AlumniRow): number {
  const ay = a.classYear ?? -Infinity;
  const by = b.classYear ?? -Infinity;
  if (ay !== by) return by - ay;
  return (
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: "base" }) ||
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" }) ||
    a.pcid.localeCompare(b.pcid)
  );
}

export function buildAlumniSummary(input: {
  sport: string;
  athleticAlumniRows: Record<string, unknown>[] | null;
  graduateRows: Record<string, unknown>[] | null;
  slateRows: SlateRow[] | null;
  generatedAt?: string | null;
  showEmails: boolean;
}): AlumniSummary {
  const sportLabel = sportByKey[input.sport]?.label || input.sport;
  const empty: AlumniSummary = {
    sport: input.sport,
    sportLabel,
    available: false,
    reason: "awaiting_powercampus",
    slateAvailable: input.slateRows !== null,
    generatedAt: input.generatedAt ?? null,
    total: 0,
    byClassYear: [],
    emailsHidden: !input.showEmails,
    rows: [],
  };
  if (input.athleticAlumniRows === null && input.graduateRows === null) return empty;

  const graduates = new Map<string, Graduate>();
  for (const row of input.graduateRows || []) {
    const pcid = pcidOf(row);
    if (pcid && !graduates.has(pcid)) graduates.set(pcid, graduateFrom(row, pcid));
  }

  // pcid -> sport key -> membership
  const memberships = new Map<string, Map<string, Membership>>();
  const add = (pcid: string, membership: Membership) => {
    let bySport = memberships.get(pcid);
    if (!bySport) {
      bySport = new Map();
      memberships.set(pcid, bySport);
    }
    const existing = bySport.get(membership.sport);
    bySport.set(membership.sport, existing ? mergeMembership(existing, membership) : membership);
  };

  for (const row of input.athleticAlumniRows || []) {
    const pcid = pcidOf(row);
    const sport = resolvePcAssociation(text(row, "ASSOCIATION"));
    if (!pcid || !sport) continue;
    // athletic_alumni already carries the graduate fields; fill gaps when the
    // graduates feed is missing or older.
    if (!graduates.has(pcid)) graduates.set(pcid, graduateFrom(row, pcid));
    add(pcid, {
      sport,
      firstYear: intOrNull(text(row, "FIRST_YEAR")),
      lastYear: intOrNull(text(row, "LAST_YEAR")),
      yearsCount: intOrNull(text(row, "YEARS_COUNT")),
      source: "powercampus",
    });
  }

  // Slate adds sport memberships; PowerCampus graduates decides who graduated.
  if (input.graduateRows !== null) {
    for (const row of input.slateRows || []) {
      const pcid = pcidOf(row);
      if (!pcid || !graduates.has(pcid)) continue;
      for (const sport of slateSportKeys(row)) {
        add(pcid, { sport, firstYear: null, lastYear: null, yearsCount: null, source: "slate" });
      }
    }
  }

  const rows: AlumniRow[] = [];
  for (const [pcid, bySport] of memberships) {
    const mine = bySport.get(input.sport);
    const grad = graduates.get(pcid);
    if (!mine || !grad) continue;
    const otherLabels = [...bySport.keys()]
      .filter((key) => key !== input.sport)
      .map((key) => sportByKey[key]?.label || key)
      .sort((a, b) => a.localeCompare(b));
    const sources = new Set<AlumniSource>();
    for (const membership of bySport.values()) sources.add(membership.source);
    rows.push({
      pcid,
      firstName: grad.firstName,
      lastName: grad.lastName,
      name: displayName(grad),
      classYear: grad.classYear,
      degree: grad.degree,
      degreeTitle: grad.degreeTitle,
      graduationDate: grad.graduationDate,
      firstYear: mine.firstYear,
      lastYear: mine.lastYear,
      yearsCount: mine.yearsCount,
      sports: [sportLabel, ...otherLabels],
      sources: [...sources].sort(),
      email: input.showEmails ? grad.email : null,
    });
  }
  rows.sort(compareAlumni);

  return {
    sport: input.sport,
    sportLabel,
    available: true,
    slateAvailable: input.slateRows !== null,
    generatedAt: input.generatedAt ?? null,
    total: rows.length,
    byClassYear: classYearCounts(rows),
    emailsHidden: !input.showEmails,
    rows,
  };
}
