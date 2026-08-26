import {
  isInterveningGraduate,
  isUgDegreeSeekingRow,
  normPcid,
  type CensusRawStudent,
  type UnretainedStudent,
} from "./lists";

export type GraduateRecord = {
  pcid: string;
  year?: string | number;
  term?: string;
  program?: string;
};

export type FtcaRawRow = {
  pcid: string;
  first: string;
  last: string;
  retained: "Retained" | "Not Retained" | "Graduated";
  religion: string;
  cathGroup: string;
  fa25Sport: string;
  fa25Curriculum: string;
  fa25FullPart: string;
  fa25Credits: number | string;
  fa25Residency: string;
  fa25Gpa: number | string;
  fa26Sport: string;
  fa26Curriculum: string;
  fa26Class: string;
  fa26FullPart: string;
  fa26Credits: number | string;
  fa26Gpa: number | string;
  fa26Residency: string;
};

export type SportRetentionRow = {
  sport: string;
  roster: number;
  notRetained: number;
  retained: number;
  graduated: number;
  retentionPct: number | null;
  graduatedPct: number | null;
};

function blank(v: string | number | null | undefined): string {
  const t = v == null ? "" : String(v).trim();
  return !t || t === "-" ? "" : t;
}

function sportOf(s: { sport?: string }): string {
  const t = blank(s.sport);
  return t;
}

export function ayGraduatePcids(grads: GraduateRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const g of grads) {
    if (isInterveningGraduate(g.year, g.term)) ids.add(normPcid(g.pcid));
  }
  return ids;
}

export function deriveFtcaRaw(
  prior: CensusRawStudent[],
  current: CensusRawStudent[],
  grads: GraduateRecord[],
): FtcaRawRow[] {
  const registered = new Map(current.map((s) => [normPcid(s.pcid), s]));
  const graduated = ayGraduatePcids(grads);
  return prior
    .filter((s) => (s.collegeAttend || "").trim().toUpperCase() === "FTCA")
    .map((s) => {
      const id = normPcid(s.pcid);
      const now = registered.get(id);
      const retained: FtcaRawRow["retained"] = graduated.has(id)
        ? "Graduated"
        : now
          ? "Retained"
          : "Not Retained";
      return {
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        retained,
        religion: s.religion || "",
        cathGroup: s.cathGroup || s.religion || "",
        fa25Sport: s.sport || "",
        fa25Curriculum: s.curriculumName || s.curriculum || "",
        fa25FullPart: s.fullPart || "",
        fa25Credits: s.credits,
        fa25Residency: s.residency || "",
        fa25Gpa: s.gpa,
        fa26Sport: now?.sport || "",
        fa26Curriculum: now?.curriculumName || now?.curriculum || "",
        fa26Class: now?.classLevel || "",
        fa26FullPart: now?.fullPart || "",
        fa26Credits: now?.credits ?? "",
        fa26Gpa: now?.gpa ?? "",
        fa26Residency: now?.residency || "",
      };
    })
    .sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}

/** Fall 2025 sport on the prior census. Leavers count against that sport. */
export function buildSportRetention(
  prior: CensusRawStudent[],
  currentPcids: Iterable<string>,
  grads: GraduateRecord[],
  excludedSports: string[] = [],
): SportRetentionRow[] {
  const registered = new Set([...currentPcids].map(normPcid));
  const graduated = ayGraduatePcids(grads);
  const excluded = new Set(excludedSports.map((s) => s.toLowerCase()));
  const map = new Map<string, SportRetentionRow>();

  for (const s of prior) {
    if (!isUgDegreeSeekingRow(s.program, s.collegeAttend)) continue;
    const sport = sportOf(s);
    if (!sport) continue;
    if (excluded.has(sport.toLowerCase())) continue;
    const row = map.get(sport) || {
      sport,
      roster: 0,
      notRetained: 0,
      retained: 0,
      graduated: 0,
      retentionPct: null,
      graduatedPct: null,
    };
    row.roster += 1;
    const id = normPcid(s.pcid);
    if (graduated.has(id)) row.graduated += 1;
    else if (registered.has(id)) row.retained += 1;
    else row.notRetained += 1;
    map.set(sport, row);
  }

  return [...map.values()]
    .map((r) => {
      const pool = r.roster - r.graduated;
      return {
        ...r,
        retentionPct: pool > 0 ? r.retained / pool : null,
        graduatedPct: r.roster > 0 ? r.graduated / r.roster : null,
      };
    })
    .sort((a, b) => a.sport.localeCompare(b.sport));
}

export function toUnretainedSeed(prior: CensusRawStudent[]): UnretainedStudent[] {
  return prior.map((s) => ({
    pcid: s.pcid,
    first: s.first,
    last: s.last,
    retention: "",
    gpa: s.gpa,
    fsp: s.fsp,
    household: s.household,
    marines: s.marines,
    honors: s.honors,
    sport: s.sport,
    state: s.state,
    gender: s.gender,
    classLevel: s.classLevel,
    collegeAttend: s.collegeAttend,
    incomingReturning: s.incomingReturning,
    program: s.program,
  }));
}
