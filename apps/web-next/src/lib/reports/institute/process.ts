/**
 * The Institute dashboard — pure data logic ported from the standalone
 * institute_dashboard.html (build.py produces the payload; this file mirrors
 * the browser-side normalization, staging, filtering and aggregation).
 * No DOM, no React — safe to unit test.
 */

/* ---------- palette (mirrors :root in the original) ---------- */
export const COLORS = {
  navy: "#0c2231",
  navy2: "#123449",
  teal: "#0f8f88",
  teal2: "#16b3a6",
  teallt: "#7fd8cf",
  ink: "#132029",
  muted: "#5f7484",
  line: "#e2e8ee",
  bg: "#eef2f6",
  card: "#ffffff",
  gold: "#c69a3f",
  gold2: "#e0be6a",
  blue: "#2f6fed",
  rose: "#c0447a",
  green: "#1f9d63",
  amber: "#e08a1e",
  purple: "#7c56d6",
  slate: "#7a8ca0",
} as const;

/** Categorical palette, in the order the original cycled through it. */
export const PALETTE = [
  COLORS.teal,
  COLORS.blue,
  COLORS.gold,
  COLORS.rose,
  COLORS.green,
  COLORS.amber,
  COLORS.purple,
  COLORS.slate,
  COLORS.navy2,
];
export const colorFor = (i: number) => PALETTE[i % PALETTE.length];

/* ---------- payload shape (from build.payload) ---------- */
export type TermSummary = {
  total: number;
  byType?: Record<string, number>;
  byStatus?: Record<string, number>;
  byAthlete?: Record<string, number>;
};
export type ProspectSummary = {
  total?: number;
  byState?: Record<string, number>;
  byStatus?: Record<string, number>;
  byBin?: Record<string, number>;
  byColumn?: Record<string, number>;
  byPurchased?: Record<string, number>;
  purchased?: number;
  msa?: number;
  gpaAvg?: number | null;
  gpaCount?: number;
};
export type BinHistory = {
  current?: Record<string, number>;
  everTouched?: Record<string, number>;
};
export type PaceMeasure = { pace: number | null; byNow: number; final: number };
export type PaceTerm = {
  prior: string;
  asOf?: string;
  measures: Record<string, PaceMeasure>;
};
export type RecruitingKpi = {
  key: string;
  name: string;
  goal: number;
  value: number;
  target: number;
  pace: number;
  info: string;
};
export type RecruitingBlock = { asOf?: string; count?: number; kpis?: RecruitingKpi[] };
export type InstitutePayload = {
  generated_at?: string;
  source?: string;
  counts?: Record<string, number>;
  errors?: Record<string, string>;
  q2?: Record<string, unknown>[];
  q3?: Record<string, unknown>[];
  q4?: Record<string, unknown>[];
  q5?: Record<string, unknown>[];
  q1_summary?: Record<string, TermSummary>;
  q2_summary?: ProspectSummary;
  q6_summary?: Record<string, BinHistory>;
  config?: {
    goals?: Record<string, number | boolean>;
    pace?: Record<string, PaceTerm | string | null>;
    recruiting?: RecruitingBlock;
  };
  loading?: {
    complete?: boolean;
    pending?: string[];
    done?: number;
    total?: number;
    est_remaining_s?: number;
    core_ready?: boolean;
  };
};

export const BLANK = "(none)";

/* ---------- primitives ---------- */
export const clean = (v: unknown): string =>
  v == null || String(v).trim() === "" ? "" : String(v).trim();

export const numOr = (v: unknown, d: number | null = null): number | null => {
  const n = parseFloat(clean(v));
  return isNaN(n) ? d : n;
};

const truthy = (v: unknown): boolean => {
  const s = clean(v).toLowerCase();
  return s !== "" && s !== "0" && s !== "no" && s !== "false";
};

/** MM/DD/YYYY or YYYY-MM-DD -> Date (or null). */
export function parseDate(s: unknown): Date | null {
  const str = clean(s);
  if (!str) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/* ---------- pipeline stage grouping (mirrors the Qlik Match/If) ---------- */
export const STAGE5 = [
  "Application",
  "Interview",
  "Hold",
  "Staff Decision Scholar",
  "Scholar Decision",
] as const;

export function stage5(bin: unknown): string {
  const b = clean(bin).toLowerCase();
  const has = (...a: string[]) => a.includes(b);
  if (has("submitted", "denied")) return "Application"; // first match wins (Denied->Application, per Qlik)
  if (has("needed", "scheduled", "completed")) return "Interview";
  if (has("awaiting fellow recommendation", "recommendation recieved", "decision deadline"))
    return "Hold";
  if (has("accepted", "denied amu")) return "Staff Decision Scholar";
  if (
    has(
      "signed",
      "withdrawn no institute decision",
      "withdrawn - not signed",
      "withdrawn from program - signed",
      "removed from program",
      "withdrawn amu",
    )
  )
    return "Scholar Decision";
  return "Other";
}

export const STAGE5_COLOR: Record<string, string> = {
  Application: COLORS.blue,
  Interview: COLORS.amber,
  Hold: COLORS.purple,
  "Staff Decision Scholar": COLORS.gold,
  "Scholar Decision": COLORS.green,
  Other: COLORS.slate,
};

/* ---------- bin categories / colors ---------- */
const POS = ["Signed", "Accepted", "Completed", "Deposited", "Withdrawn from Program - Signed"];
const NEG = ["Denied", "Cold No Interview"];
export const binColor = (b: string): string =>
  POS.some((p) => b.startsWith(p))
    ? COLORS.green
    : NEG.some((p) => b.startsWith(p))
      ? COLORS.rose
      : /^Withdrawn/.test(b)
        ? COLORS.slate
        : COLORS.blue;

export const BIN_ORDER = [
  "Needed",
  "Submitted",
  "Scheduled",
  "Completed",
  "Decision Deadline",
  "Accepted",
  "Signed",
  "Denied",
  "Cold No Interview",
  "Withdrawn - Not Signed",
  "Withdrawn No Institute Decision",
  "Withdrawn from Program - Signed",
  "Withdrawn AMU",
];

/* ---------- normalized applicant (q4) ---------- */
export type Applicant = {
  pcid: string;
  first: string;
  last: string;
  name: string;
  city: string;
  state: string;
  country: string;
  term: string;
  gender: string;
  religion: string;
  sport: string;
  highschool: string;
  gpa: number | null;
  act: number | null;
  sat: number | null;
  clt: number | null;
  bin: string;
  binDate: string;
  stage: string;
  ath: string;
  deposited: boolean;
  withdrawn: boolean;
  accepted: boolean;
  acceptDate: string;
  signed: boolean;
  signedDate: string;
  interviewDate: string;
  interviewed: boolean;
  rating: number | null;
  score: number | null;
  applyDate: string;
  url: string;
  // index signature so filters/date-basis lookups by string key type-check
  [key: string]: string | number | boolean | null;
};

/** Slate PurchasedList flag (Y/Yes/1/true). Missing/blank is not purchased. */
export function isPurchased(v: unknown): boolean {
  const s = clean(v).toLowerCase();
  return s === "y" || s === "yes" || s === "1" || s === "true";
}

/* ---------- normalized prospect (q2) ---------- */
export type Prospect = {
  first: string;
  last: string;
  name: string;
  status: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  sat: number | null;
  highschool: string;
  hsCity: string;
  hsState: string;
  msa: boolean;
  gpa: number | null;
  guid: string;
  bin: string;
  column: string;
  purchased: boolean;
  purchasedLabel: string;
  url: string;
  [key: string]: string | number | boolean | null;
};

export function normalizeProspects(q2: Record<string, unknown>[]): Prospect[] {
  return q2.map((r) => {
    const guid = clean(r.PersonGUID);
    const purchased = isPurchased(r.PurchasedList);
    return {
      first: clean(r.FirstName),
      last: clean(r.LastName),
      name: (clean(r.FirstName) + " " + clean(r.LastName)).trim() || "(no name)",
      status: clean(r.Status) || BLANK,
      email: clean(r.Email),
      phone: clean(r.Phone),
      street: clean(r.Street1),
      city: clean(r.City),
      state: clean(r.Region) || BLANK,
      postal: clean(r.Postal),
      country: clean(r.Country),
      sat: numOr(r.SAT),
      highschool: clean(r.HighSchool),
      hsCity: clean(r.HighSchoolCity),
      hsState: clean(r.HighSchoolState),
      msa: truthy(r.MSATag),
      gpa: numOr(r["PersonGPA-Self-Reportedhighschool"]),
      guid,
      bin: clean(r.InstituteRecruitingBin) || BLANK,
      column: clean(r.InstituteRecruitingColumn) || BLANK,
      purchased,
      purchasedLabel: purchased ? "Yes" : "No",
      url: guid ? `https://apply.avemaria.edu/manage/lookup/record?id=${guid}` : "",
    };
  });
}

export type ProspectFilters = {
  search: string;
  state: string;
  purchased: string; // "" | "Y" | "N"
  status: string;
  bin: string;
};

export function emptyProspectFilters(): ProspectFilters {
  return { search: "", state: "", purchased: "", status: "", bin: "" };
}

export function passesProspect(d: Prospect, F: ProspectFilters): boolean {
  if (F.state && d.state !== F.state) return false;
  if (F.status && d.status !== F.status) return false;
  if (F.bin && d.bin !== F.bin) return false;
  if (F.purchased === "Y" && !d.purchased) return false;
  if (F.purchased === "N" && d.purchased) return false;
  if (F.search) {
    const q = F.search.toLowerCase();
    if (
      ![d.name, d.city, d.highschool, d.email, d.phone, d.state].join(" ").toLowerCase().includes(q)
    )
      return false;
  }
  return true;
}

export const uniqProspectValues = (
  data: Prospect[],
  key: keyof Prospect,
): string[] => {
  const s = [...new Set(data.map((d) => String(d[key])))].filter((x) => x && x !== BLANK);
  return s.sort((a, b) => a.localeCompare(b));
};

const PROSPECT_CSV_COLS: { k: keyof Prospect; t: string }[] = [
  { k: "last", t: "Last" },
  { k: "first", t: "First" },
  { k: "status", t: "Status" },
  { k: "street", t: "Street" },
  { k: "city", t: "City" },
  { k: "state", t: "State" },
  { k: "postal", t: "Postal" },
  { k: "highschool", t: "High School" },
  { k: "hsCity", t: "HS City" },
  { k: "hsState", t: "HS State" },
  { k: "phone", t: "Phone" },
  { k: "email", t: "Email" },
  { k: "sat", t: "SAT" },
  { k: "gpa", t: "GPA" },
  { k: "purchasedLabel", t: "Purchased List" },
  { k: "bin", t: "Recruiting Bin" },
  { k: "column", t: "Recruiting Column" },
  { k: "url", t: "Slate URL" },
];

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV of the filtered prospect roster for recruitment trips. */
export function prospectsToCsv(rows: Prospect[]): string {
  const header = PROSPECT_CSV_COLS.map((c) => csvCell(c.t)).join(",");
  const body = rows.map((d) => PROSPECT_CSV_COLS.map((c) => csvCell(d[c.k])).join(","));
  return [header, ...body].join("\n");
}

export function normalizeApplicants(q4: Record<string, unknown>[]): Applicant[] {
  return q4.map((r) => {
    const guid = clean(r.PersonGUID);
    const interviewDate = clean(r.InterviewDate) || clean(r.InstituteInterviewDate);
    return {
      pcid: clean(r.PCID),
      first: clean(r.FirstName),
      last: clean(r.LastName),
      name: (clean(r.FirstName) + " " + clean(r.LastName)).trim() || "(no name)",
      city: clean(r.City),
      state: clean(r.Region) || BLANK,
      country: clean(r.Country),
      term: clean(r.ApplicationTerm) || BLANK,
      gender: clean(r.Gender) || BLANK,
      religion: clean(r.Religion),
      sport: clean(r.Sport) || "(non-athlete)",
      highschool: clean(r.HighSchool),
      gpa: numOr(r["GPAAMURecalc-HighSchool"], numOr(r["GPA-Self-Reportedhighschool"])),
      act: numOr(r.ACT),
      sat: numOr(r.SAT),
      clt: numOr(r.CLT),
      bin: clean(r.Bin) || BLANK,
      binDate: clean(r.BinDate),
      stage: stage5(r.Bin),
      ath: clean(r.ApplicationAthleticDecision) || BLANK,
      deposited: truthy(r.Deposited),
      withdrawn: truthy(r.Withdrawn),
      accepted: truthy(r.Accepted),
      acceptDate: clean(r.AcceptDate),
      signed: truthy(r.Signed),
      signedDate: clean(r.SignedDate),
      interviewDate,
      interviewed: !!interviewDate,
      rating: numOr(r.InterviewTotalRating),
      score: numOr(r["TheInstitute-TotalScore"]),
      applyDate: clean(r.ApplyDate),
      url: guid ? `https://apply.avemaria.edu/manage/lookup/record?id=${guid}` : "",
    };
  });
}

/* ---------- term ordering ---------- */
export const termKey = (t: string): number => {
  const m = /(\d{4})/.exec(t);
  return m ? +m[1] : 0;
};

export function termsFrom(
  data: Applicant[],
  q1Summary: Record<string, TermSummary>,
  q6Summary: Record<string, BinHistory>,
): string[] {
  return [
    ...new Set([
      ...data.map((d) => d.term).filter((t) => t !== BLANK),
      ...Object.keys(q1Summary),
      ...Object.keys(q6Summary),
    ]),
  ]
    .filter((t) => t && t !== "(no term)")
    .sort((a, b) => termKey(b) - termKey(a));
}

export function defaultTerm(data: Applicant[]): string {
  const c: Record<string, number> = {};
  data.forEach((d) => (c[d.term] = (c[d.term] || 0) + 1));
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || "";
}

/* ---------- filter state ---------- */
export type Filters = {
  search: string;
  term: string;
  sport: string;
  gender: string;
  ath: string;
  bin: string;
  state: string;
  stage: string; // gauge stage: applicants|interviews|accepted|signed
  stage5: string; // bottleneck stage
  dateBasis: string; // applyDate|interviewDate|acceptDate|signedDate|binDate
  dateFrom: string;
  dateTo: string;
};

export function emptyFilters(defaultTermValue: string): Filters {
  return {
    search: "",
    term: defaultTermValue,
    sport: "",
    gender: "",
    ath: "",
    bin: "",
    state: "",
    stage: "",
    stage5: "",
    dateBasis: "applyDate",
    dateFrom: "",
    dateTo: "",
  };
}

export const STAGE_LBL: Record<string, string> = {
  applicants: "Applicant",
  interviews: "Interviewed",
  accepted: "Accepted",
  signed: "Signed",
};

function stagePass(d: Applicant, s: string): boolean {
  if (s === "interviews") return d.interviewed;
  if (s === "accepted") return d.accepted;
  if (s === "signed") return d.signed;
  return true;
}

/** Row predicate. `skip` excludes one facet so a chart can show the full
 * distribution for its own dimension (Qlik-style highlight, not collapse). */
export function passes(d: Applicant, F: Filters, skip?: string): boolean {
  if (F.term && d.term !== F.term) return false;
  if (skip !== "sport" && F.sport && d.sport !== F.sport) return false;
  if (F.gender && d.gender !== F.gender) return false;
  if (F.ath && d.ath !== F.ath) return false;
  if (F.bin && d.bin !== F.bin) return false;
  if (skip !== "state" && F.state && d.state !== F.state) return false;
  if (F.stage && !stagePass(d, F.stage)) return false;
  if (skip !== "stage5" && F.stage5 && d.stage !== F.stage5) return false;
  if (F.dateFrom || F.dateTo) {
    const dd = parseDate(d[F.dateBasis]);
    if (!dd) return false;
    if (F.dateFrom && dd < parseDate(F.dateFrom)!) return false;
    if (F.dateTo && dd > parseDate(F.dateTo)!) return false;
  }
  if (F.search) {
    const q = F.search.toLowerCase();
    if (![d.name, d.city, d.highschool, d.pcid].join(" ").toLowerCase().includes(q))
      return false;
  }
  return true;
}

/* ---------- aggregation helpers ---------- */
export type Item = { k: string; v: number };

export function countBy(rows: Applicant[], key: keyof Applicant): Item[] {
  const m = new Map<string, number>();
  rows.forEach((d) => {
    const kv = String(d[key]);
    m.set(kv, (m.get(kv) || 0) + 1);
  });
  return [...m.entries()]
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v);
}

export function avg(rows: Applicant[], key: keyof Applicant, dp: number): string | null {
  const v = rows
    .map((d) => d[key])
    .filter((x): x is number => typeof x === "number" && !isNaN(x));
  return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(dp) : null;
}

export const uniqValues = (
  data: Applicant[],
  key: keyof Applicant,
  sortFn?: (a: string, b: string) => number,
): string[] => {
  const s = [...new Set(data.map((d) => String(d[key])))].filter((x) => x && x !== BLANK);
  return sortFn ? s.sort(sortFn) : s.sort((a, b) => a.localeCompare(b));
};

/* ---------- AMU context (q1) ---------- */
export function ctxData(q1Summary: Record<string, TermSummary>, term: string) {
  const byType: Record<string, number> = {};
  let total = 0;
  const ts = term ? [term] : Object.keys(q1Summary);
  ts.forEach((t) => {
    const s = q1Summary[t];
    if (!s) return;
    total += s.total;
    Object.entries(s.byType || {}).forEach(([k, v]) => (byType[k] = (byType[k] || 0) + v));
  });
  return { total, byType };
}

export function priorTerm(
  q1Summary: Record<string, TermSummary>,
  term: string,
): string | null {
  const m = /(\d{4})/.exec(term);
  if (!m) return null;
  const pt = term.replace(m[1], String(+m[1] - 1));
  return q1Summary[pt] ? pt : null;
}

/* ---------- athletic donut ---------- */
/** Donut label for applicants whose Slate ApplicationAthleticDecision is blank. */
export const ATH_NOT_SET = "Not set";

/**
 * Athletic-status split for the donut. Every applicant in `rows` is counted,
 * so the donut total matches the funnel's Applicants dial and the Gender donut.
 * A blank ApplicationAthleticDecision (no athletic review recorded) is shown as
 * its own "Not set" slice, last, instead of being dropped.
 *
 * If a real Slate athletic decision is itself literally named "Not set", its
 * count is merged into the blank-derived slice instead of emitting a second
 * item with the same key (which would collide as a React list key and double
 * up the donut's "Not set" wedge).
 */
export function athleticItems(rows: Applicant[]): Item[] {
  const items = countBy(rows, "ath");
  const named = items.filter((x) => x.k !== BLANK);
  const blank = items.find((x) => x.k === BLANK);
  if (!blank) return named;
  const realNotSet = named.find((x) => x.k === ATH_NOT_SET);
  if (realNotSet) {
    const merged = named.map((x) =>
      x.k === ATH_NOT_SET ? { k: ATH_NOT_SET, v: x.v + blank.v } : x,
    );
    return merged;
  }
  return [...named, { k: ATH_NOT_SET, v: blank.v }];
}
