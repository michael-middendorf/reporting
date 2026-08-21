/** Withdrawn deposits + withdrawn deferred from Slate withdrawn × admissions. */

export const WD_DEPOSITS = "Withdrawn Enrolled";
export const WD_DEFERRED = "Withdrawn Deferred";

export type CycleKey = "fa24" | "fa25" | "fa26" | "fa27" | "other";
export type WithdrawalKind = "deposits" | "deferred";

export type WithdrawalRow = {
  personReferenceId: string;
  name: string;
  term: string;
  cycle: CycleKey;
  ac: string;
  withdrawnDate: string;
  enrollingDate: string;
  depositDate: string;
  athlete: string;
  sport: string;
  scholarship: string;
  reason: string;
  otherSchool: string;
  kind: WithdrawalKind;
};

export type CohortStats = {
  total: number;
  athlete: number;
  nonAthlete: number;
  counselorCount: number;
  latestDate: string | null;
  byAC: Record<string, number>;
  byReason: Record<string, number>;
  rows: WithdrawalRow[];
};

export type CycleWithdrawn = {
  deposits: CohortStats;
  deferred: CohortStats;
  otherCount: number;
};

export type WithdrawnBundle = {
  fa24: CycleWithdrawn;
  fa25: CycleWithdrawn;
  fa26: CycleWithdrawn;
  fa27: CycleWithdrawn;
  other: CycleWithdrawn;
  otherCount: number;
};

type Loose = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** Normalize Slate dates (M/D/YYYY or YYYY-MM-DD) to YYYY-MM-DD. */
export function normalizeDate(raw: unknown): string {
  const t = str(raw).slice(0, 10);
  if (!t) return "";
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  return "";
}

/**
 * Fall YYYY + following Spring → faYY. Summer YYYY rides with that Fall.
 * Spring 2027 → fa26; Fall 2026 → fa26; Summer 2026 → fa26.
 */
export function cycleForTerm(term: string): CycleKey {
  const m = String(term || "").trim().match(/^(Fall|Spring|Summer)\s+(\d{4})$/i);
  if (!m) return "other";
  const season = m[1].toLowerCase();
  const year = Number(m[2]);
  const fallYear = season === "spring" ? year - 1 : year;
  if (fallYear === 2024) return "fa24";
  if (fallYear === 2025) return "fa25";
  if (fallYear === 2026) return "fa26";
  if (fallYear === 2027) return "fa27";
  return "other";
}

function kindOf(type: string): WithdrawalKind | null {
  if (type === WD_DEPOSITS) return "deposits";
  if (type === WD_DEFERRED) return "deferred";
  return null;
}

export function emptyCohort(): CohortStats {
  return {
    total: 0,
    athlete: 0,
    nonAthlete: 0,
    counselorCount: 0,
    latestDate: null,
    byAC: {},
    byReason: {},
    rows: [],
  };
}

function isAthlete(label: string): boolean {
  const s = label.toLowerCase();
  if (!s) return false;
  if (s.includes("non")) return false;
  return s.includes("athlete");
}

export function statsFrom(rows: WithdrawalRow[]): CohortStats {
  const byAC: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  let athlete = 0;
  let nonAthlete = 0;
  let latestDate: string | null = null;
  const counselors = new Set<string>();
  for (const r of rows) {
    const acKey = r.ac || "";
    byAC[acKey] = (byAC[acKey] || 0) + 1;
    if (r.ac) counselors.add(r.ac);
    const reason = r.reason || "Unspecified";
    byReason[reason] = (byReason[reason] || 0) + 1;
    if (isAthlete(r.athlete)) athlete += 1;
    else if (r.athlete) nonAthlete += 1;
    if (r.withdrawnDate && (!latestDate || r.withdrawnDate > latestDate)) latestDate = r.withdrawnDate;
  }
  const sorted = [...rows].sort((a, b) => {
    const d = (b.withdrawnDate || "").localeCompare(a.withdrawnDate || "");
    if (d) return d;
    return a.name.localeCompare(b.name);
  });
  return {
    total: rows.length,
    athlete,
    nonAthlete,
    counselorCount: counselors.size,
    latestDate,
    byAC,
    byReason,
    rows: sorted,
  };
}

function pid(row: Loose): string {
  return str(row.PersonReferenceID || row.personreferenceid);
}

/**
 * Pick the admissions application that belongs to this withdrawal.
 * Prefer WithdrawnDate match, then WithdrawnCode, then DepositCode for deposits.
 */
export function pickAdmissionsApp(
  wd: Loose,
  apps: Loose[],
  kind: WithdrawalKind,
): Loose | null {
  if (!apps.length) return null;
  const wdDate = normalizeDate(wd.WithdrawnDate);
  const dateMatch = wdDate
    ? apps.filter((a) => normalizeDate(a.WithdrawnDate) === wdDate)
    : [];
  const withWd = apps.filter((a) => str(a.WithdrawnCode));
  const ranked = (dateMatch.length ? dateMatch : withWd.length ? withWd : apps).slice();
  ranked.sort((a, b) => {
    const aDep = str(a.DepositCode) ? 1 : 0;
    const bDep = str(b.DepositCode) ? 1 : 0;
    if (kind === "deposits" && aDep !== bDep) return bDep - aDep;
    const aWd = str(a.WithdrawnCode) ? 1 : 0;
    const bWd = str(b.WithdrawnCode) ? 1 : 0;
    if (aWd !== bWd) return bWd - aWd;
    return str(b.ApplicationTerm).localeCompare(str(a.ApplicationTerm));
  });
  return ranked[0] || null;
}

function toDetail(wd: Loose, app: Loose | null, kind: WithdrawalKind): WithdrawalRow {
  const term = str(app?.ApplicationTerm);
  const athlete = str(wd["AthleteNon-Athlete"] || wd.AthleteorNonAthlete || app?.AthleteorNonAthlete);
  return {
    personReferenceId: pid(wd),
    name: str(wd.Name),
    term,
    cycle: cycleForTerm(term),
    ac: str(wd.ACAssignment || app?.ApplicationACAssignment),
    withdrawnDate: normalizeDate(wd.WithdrawnDate),
    enrollingDate: normalizeDate(wd.EnrollingDate) || normalizeDate(app?.DepositDate),
    depositDate: normalizeDate(app?.DepositDate),
    athlete,
    sport: str(app?.Sport),
    scholarship: str(wd.ScholarshipName),
    reason: str(wd.WithdrawnReasonSpecifics),
    otherSchool: str(wd.OtherSchool),
    kind,
  };
}

export function processWithdrawals(wdRows: Loose[] = [], admRows: Loose[] = []): WithdrawnBundle {
  const byPerson = new Map<string, Loose[]>();
  for (const a of admRows) {
    const id = pid(a);
    if (!id) continue;
    const list = byPerson.get(id);
    if (list) list.push(a);
    else byPerson.set(id, [a]);
  }

  const buckets: Record<CycleKey, { deposits: WithdrawalRow[]; deferred: WithdrawalRow[]; otherCount: number }> = {
    fa24: { deposits: [], deferred: [], otherCount: 0 },
    fa25: { deposits: [], deferred: [], otherCount: 0 },
    fa26: { deposits: [], deferred: [], otherCount: 0 },
    fa27: { deposits: [], deferred: [], otherCount: 0 },
    other: { deposits: [], deferred: [], otherCount: 0 },
  };
  let otherCount = 0;

  for (const wd of wdRows) {
    const kind = kindOf(str(wd.WithdrawnType || wd.WithdrawnDecision));
    if (!kind) {
      otherCount += 1;
      const apps = byPerson.get(pid(wd)) || [];
      const app = pickAdmissionsApp(wd, apps, "deposits");
      const cyc = cycleForTerm(str(app?.ApplicationTerm));
      buckets[cyc].otherCount += 1;
      continue;
    }
    const apps = byPerson.get(pid(wd)) || [];
    const app = pickAdmissionsApp(wd, apps, kind);
    const row = toDetail(wd, app, kind);
    buckets[row.cycle][kind].push(row);
  }

  const pack = (c: CycleKey): CycleWithdrawn => ({
    deposits: statsFrom(buckets[c].deposits),
    deferred: statsFrom(buckets[c].deferred),
    otherCount: buckets[c].otherCount,
  });

  return {
    fa24: pack("fa24"),
    fa25: pack("fa25"),
    fa26: pack("fa26"),
    fa27: pack("fa27"),
    other: pack("other"),
    otherCount,
  };
}

export function cycleLabel(cycle: "fa26" | "fa27"): string {
  return cycle === "fa26" ? "FA26 / SP27" : "FA27 / SP28";
}
