/** Compact census briefing for the on-page Q&A. Same snapshot as /api/census-data. */

import { isUgDegreeSeekingRow, type CensusLists, type CensusRawStudent } from "./lists-core";
import { summaryFromStudents, uniqueStudentCount, meanPositive, buildGraduateEnrollment, isIrelandStudent } from "./from-lists";
import {
  athleteOf,
  buildFtcaExtras,
  hasTestScore,
  isCatholic,
  isFtcaIncoming,
} from "./retention";
import { DEFAULT_FILTERS, buildReport, filterStudents, projectReportStudents } from "./report";
import type { AttritionRow, CensusSnapshot } from "./types";

function pct(n: number, d: number): number | null {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 1000;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function hc(c: { headcount: number; fte?: number | null } | undefined): number {
  return c?.headcount ?? 0;
}

function table(rows: AttritionRow[] | undefined): { label: string; n: number; left: number; retained: string }[] {
  return (rows || []).map((r) => ({
    label: r.label,
    n: r.students,
    left: r.notRetained,
    retained: fmtPct(r.retainedPct),
  }));
}

function yearIndex(data: CensusSnapshot, year: number): number {
  return data.historical.years.findIndex((y) => y === year);
}

function histHc(data: CensusSnapshot, key: string, year: number): number | null {
  const i = yearIndex(data, year);
  const series = data.historical[key];
  if (i < 0 || !series || typeof series !== "object" || Array.isArray(series)) return null;
  const v = series.hc?.[i];
  return typeof v === "number" ? v : null;
}

export type CensusBriefing = {
  source: Record<string, string>;
  definitions: string[];
  thisFall: Record<string, number | string | null>;
  lastFall: Record<string, number | string | null>;
  ftcaRetention: Record<string, unknown>;
  allUgRetention: Record<string, unknown>;
  incomingQuality: Record<string, number | string | null>;
  presidentMightAsk: { question: string; answer: string }[];
};

export function buildCensusBriefing(data: CensusSnapshot, lists: CensusLists): CensusBriefing {
  const students = lists.students;
  const summary = students.length ? summaryFromStudents(students) : data.summary;
  const ugds = students.filter((s) => isUgDegreeSeekingRow(s.program, s.collegeAttend));
  const incoming = ugds.filter((s) => (s.incomingReturning || "").toLowerCase().startsWith("incoming"));
  const currentIds = students.map((s) => s.pcid);
  const extras = lists.prior.length ? buildFtcaExtras(lists.prior, currentIds, lists.graduates) : null;
  const ftca = data.ftcaAttrition;
  const ug = data.allUgRetention;
  const fa25Ftca = histHc(data, "ftca", 2025);
  const fa25New = histHc(data, "newStudents", 2025);
  const fa25Ug = histHc(data, "degreeSeeking", 2025);
  const fa25All = histHc(data, "totalEnrollment", 2025);
  const tables = students.length
    ? buildReport(filterStudents(projectReportStudents(students), DEFAULT_FILTERS))
    : data.ug;
  const catholicN = ugds.filter(isCatholic).length;
  const onCampus = tables.residency.find((r) => r.label === "On Campus" || r.label === "Resident")?.n ?? 0;
  const grads = buildGraduateEnrollment(students, lists.prior, lists.graduates);
  const overallGrad = grads[0];
  const ireland = ugds.filter(isIrelandStudent).length;
  const honorsN = ugds.filter((s) => {
    const t = (s.honors || "").trim();
    return t && t !== "-";
  }).length;

  const thisFall = {
    term: data.term,
    allStudents: uniqueStudentCount(students) || data.kpis.allStudents,
    ugDegreeSeeking: hc(summary.degreeSeeking),
    newStudents: hc(summary.newStudents),
    ftca: hc(summary.ftca),
    tran: hc(summary.tran),
    read: hc(summary.read),
    secb: hc(summary.secb),
    returning: hc(summary.returning),
    dualEnrollment: hc(summary.dualEnrollment),
    chestertonDual: hc(summary.chestertonDual),
    graduate: hc(summary.totalGraduate),
    totalEnrollment: hc(summary.totalEnrollment),
    irelandMountMelleray: ireland,
    ugOnCampus: onCampus,
    pctCatholicUg: fmtPct(pct(catholicN, ugds.length)),
    honorsUg: honorsN,
  };

  const lastFall = {
    year: 2025,
    newStudents: fa25New,
    ftca: fa25Ftca,
    ugDegreeSeeking: fa25Ug,
    totalEnrollment: fa25All,
    note: "FA25 Summary gold: new students 459, FTCA 392, UG DS 1343, total 1500.",
  };

  const ftcaRetention = {
    definition: "Fall 2025 Incoming+FTCA (392 on the FA25 Summary). Spring admits out. Aiden Wilson excluded after census. Cohort 391.",
    cohort: ftca.cohort,
    enrolledThisFall: ftca.enrolledThisFall,
    notRetained: ftca.notRetained,
    retentionRate: fmtPct(ftca.retentionRate),
    historical: data.historicalFtcaRetention,
    byAthlete: table(ftca.byAthlete),
    bySport: table(ftca.bySport).slice(0, 16),
    byGpa: table(ftca.byGpa),
    testScore: extras ? table(extras.byTestScore) : [],
    actConverted: extras ? table(extras.byActConverted) : [],
    honors: extras ? table(extras.byHonors) : [],
    fsp: extras ? table(extras.byFsp) : [],
    hsGpa: extras ? table(extras.byHsGpa) : [],
    appDecision: extras ? extras.byAppDecision.map((r) => ({
      label: r.label,
      n: r.students,
      left: r.notRetained,
      retained: fmtPct(r.retentionPct),
    })) : [],
  };

  const incomingQuality = {
    hsGpaMean: meanPositive(incoming, (s) => s.hsGpa, 2),
    actMean: meanPositive(incoming, (s) => s.act, 1),
    satMean: meanPositive(incoming, (s) => s.sat, 0, 5, 400),
    cltMean: meanPositive(incoming, (s) => s.clt, 1),
    incomingN: incoming.length,
    incomingWithTest: incoming.filter(hasTestScore).length,
  };

  const presidentMightAsk = presidentAnswers({
    thisFall,
    lastFall,
    ftca,
    ug,
    extras,
    overallGrad,
    historicalFtca: data.historicalFtcaRetention,
    historicalUg: data.historicalAllUgRetention,
  });

  return {
    source: {
      authority: "Same live snapshot as the Census page and Excel export (loadCensusSnapshot).",
      students: "Fall 2026 Registration Status spine + eRez housing + Slate sports.",
      prior: "Fall 2025 Census Final 9.23.25.xlsx (gold) with FA25 roster/housing overlays.",
      generated: data.generated,
      workbookStatus: data.status,
      doNotInvent: "If a number is not in this briefing or a tool result, say it is not in this census.",
    },
    definitions: [
      "FTCA on Summary = Incoming UG degree-seeking with College Attend FTCA, any class. Spring/summer starters are Returning.",
      "FA25 FTCA attrition cohort = Incoming+FTCA on the gold FA25 census (392), minus Aiden Wilson (391).",
      "Retention notes (Census retention sheet col R): intervening graduates, AMSOL/enrolled/last credits as retained. Only Aiden Wilson (dropped after census) and Hannah Nelson (deceased) are out of the FA25 denominator. Leave of absence stays in the cohort and counts as retained. On the FA26 LOA tab, not All Not Retained.",
      "Retention % = still enrolled this fall / (cohort minus intervening graduates). Same formula on All UG, FTCA, sports, and crosstabs. Graduates are not leavers and not in the denominator.",
      "Athletes on sport tables = Varsity / Non-Varsity / Non-NAIA. Band and managers are Associated only.",
      "Catholic = Catholic or Eastern Rite. Christian is Non-Catholic.",
      "ACT converted = higher of verified ACT and SAT via College Board concordance. CLT-only is a test score but not ACT converted.",
    ],
    thisFall,
    lastFall,
    ftcaRetention,
    allUgRetention: {
      priorUg: ug.priorUg,
      graduates: ug.graduates,
      pool: ug.pool,
      enrolledThisFall: ug.enrolledThisFall,
      notRetained: ug.notRetained,
      retentionRate: fmtPct(ug.retentionRate),
      historical: data.historicalAllUgRetention,
    },
    incomingQuality,
    presidentMightAsk,
  };
}

function presidentAnswers(args: {
  thisFall: Record<string, number | string | null>;
  lastFall: Record<string, number | string | null>;
  ftca: CensusSnapshot["ftcaAttrition"];
  ug: CensusSnapshot["allUgRetention"];
  extras: ReturnType<typeof buildFtcaExtras> | null;
  overallGrad: { n: number } | undefined;
  historicalFtca: { label: string; rate: number }[];
  historicalUg: { label: string; rate: number }[];
}): { question: string; answer: string }[] {
  const t = args.thisFall;
  const lastFtca = args.lastFall.ftca;
  const lastNew = args.lastFall.newStudents;
  const lastAll = args.lastFall.totalEnrollment;
  const ftcaRate = args.ftca.retentionRate;
  const prevFtca = args.historicalFtca.find((r) => r.label.includes("F24"));
  const test = args.extras?.byTestScore || [];
  const hasTest = test.find((r) => r.label === "Has test score");
  const noTest = test.find((r) => r.label === "No test score");
  const honors = args.extras?.byHonors.find((r) => r.label === "Honors");
  const football = args.ftca.bySport.find((r) => r.label.toLowerCase() === "football");
  const athlete = args.ftca.byAthlete.find((r) => r.label === "Athlete");
  const nonAth = args.ftca.byAthlete.find((r) => r.label === "Non-Athlete");
  const adm = args.extras?.byAppDecision.find((r) => (r.label || "").toUpperCase().includes("ADM"));
  return [
    {
      question: "Are we up or down versus last fall?",
      answer: `This fall total enrollment ${t.totalEnrollment} vs FA25 ${lastAll ?? "1500"}. New UG ${t.newStudents} vs ${lastNew ?? 459}. Incoming FTCA ${t.ftca} vs ${lastFtca ?? 392}. UG degree-seeking ${t.ugDegreeSeeking} vs ${args.lastFall.ugDegreeSeeking ?? 1343}.`,
    },
    {
      question: "Why is FTCA not 392 this year?",
      answer: `Last year’s Summary FTCA is Incoming+FTCA = 392. This year the same rule is Incoming+FTCA with spring/summer starters counted as Returning, so FTCA is ${t.ftca} (10 spring admits left the new-student line).`,
    },
    {
      question: "What is freshman (FTCA) retention, and is that good?",
      answer: `F25–F26 Incoming FTCA retention is ${fmtPct(ftcaRate)} (${args.ftca.enrolledThisFall} of ${args.ftca.cohort} still enrolled; ${args.ftca.notRetained} not retained). Last year’s published F24–F25 rate was ${prevFtca ? fmtPct(prevFtca.rate) : "84.9%"}.`,
    },
    {
      question: "Why did students leave?",
      answer: `Strongest flags on the FTCA cohort: first-term AMU GPA (under 2.5 is ~33–50% retained), no test score (${fmtPct(noTest?.retainedPct)} vs ${fmtPct(hasTest?.retainedPct)} with a score), football (${football ? fmtPct(football.retainedPct) : "n/a"}), commuter males, Non-Catholic, and admin-override admits (ADM).`,
    },
    {
      question: "Are athletes a retention problem?",
      answer: `Incoming FTCA athletes retained ${fmtPct(athlete?.retainedPct)} vs non-athletes ${fmtPct(nonAth?.retainedPct)}. Football is the drag (${football ? `${football.notRetained} of ${football.students} left, ${fmtPct(football.retainedPct)}` : "n/a"}). Other sports sit near the campus rate.`,
    },
    {
      question: "What protects retention?",
      answer: `Honors ${fmtPct(honors?.retainedPct)} (${honors?.students ?? 0} students), FSP ~94%, Institute ~89%, and submitting a test score (89%). High first-term GPA is the steepest positive gradient.`,
    },
    {
      question: "Is the incoming class academically strong?",
      answer: `Incoming UG means are on the page KPIs (HS GPA, ACT, SAT, CLT). Test submission itself is a retention signal: students with no ACT/SAT/CLT retained much worse than those with a score.`,
    },
    {
      question: "Catholic identity?",
      answer: `UG degree-seeking Catholic share this fall is ${t.pctCatholicUg}. On last year’s FTCA cohort, Non-Catholic retention was about 66% vs Catholic 84%.`,
    },
    {
      question: "Housing / campus life?",
      answer: `UG on-campus headcount is ${t.ugOnCampus}. Ireland (Mount Melleray) is ${t.irelandMountMelleray}, counted as Returning, not On Campus. Commuter incoming FTCA men were the weakest residency slice.`,
    },
    {
      question: "Dual enrollment and Chesterton?",
      answer: `High school dual enrollment ${t.dualEnrollment}. Chesterton is Early College (EACO/EACOL), ${t.chestertonDual}. Former DE who are FTCA this fall count as Incoming, not Returning.`,
    },
    {
      question: "Graduate enrollment?",
      answer: `Graduate headcount ${t.graduate} (overall program block n=${args.overallGrad?.n ?? t.graduate}). Breakouts are on the Graduate Enrollment sheet: Philosophy, Theology, PhD, MBA, M.Ed, CRW, Lux Mundi.`,
    },
    {
      question: "Should we worry about committee or admin admits?",
      answer: `ADM (admin override) on the FTCA cohort retained poorly${adm ? ` (${adm.students} students, ${adm.notRetained} left, ${fmtPct(adm.retentionPct)})` : ""}. COMM is a small n; do not over-read it.`,
    },
    {
      question: "What is not in this census?",
      answer: `No Pell, first-generation, household income, or high-school type on these lists. Do not invent those. All-UG retention (not just FTCA) is ${fmtPct(args.ug.retentionRate)} of the returning pool after graduates.`,
    },
  ];
}

export function compactPerson(
  s: CensusRawStudent,
  extra: { list?: string; registeredFa26?: boolean } = {},
) {
  const honors = (s.honors || "").trim();
  return {
    pcid: s.pcid,
    name: `${s.first || ""} ${s.last || ""}`.trim(),
    incomingReturning: s.incomingReturning,
    classLevel: s.classLevel,
    collegeAttend: s.collegeAttend,
    program: s.program,
    major: s.curriculumName || s.curriculum,
    sport: s.sport || "",
    athlete: athleteOf(s),
    residency: s.residency,
    state: s.state,
    gpa: s.gpa,
    hsGpa: s.hsGpa ?? "",
    act: s.act ?? "",
    sat: s.sat ?? "",
    clt: s.clt ?? "",
    honors: honors && honors !== "-" ? honors : "",
    fsp: s.fsp || "",
    institute: s.institute || "",
    appDecision: s.appDecision || "",
    list: extra.list ?? "",
    registeredFa26: extra.registeredFa26 ?? false,
  };
}

export function searchPeople(lists: CensusLists, query: string, limit = 15) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const match = (s: CensusRawStudent) => {
    const blob = `${s.pcid} ${s.first} ${s.last}`.toLowerCase();
    return tokens.every((t) => blob.includes(t));
  };
  const current = new Set(lists.students.map((s) => (s.pcid || "").toUpperCase()));
  const hits = [
    ...lists.students.filter(match).map((s) => compactPerson(s, { list: "FA26", registeredFa26: true })),
    ...lists.prior.filter(match).map((s) =>
      compactPerson(s, { list: "FA25", registeredFa26: current.has((s.pcid || "").toUpperCase()) }),
    ),
  ];
  const seen = new Set<string>();
  const out = [];
  for (const h of hits) {
    const id = `${h.list}:${h.pcid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

export function countPeople(
  lists: CensusLists,
  f: {
    term?: "fa26" | "fa25";
    incoming?: boolean;
    ftca?: boolean;
    athlete?: boolean;
    football?: boolean;
    honors?: boolean;
    testScore?: boolean;
    catholic?: boolean;
    gender?: string;
    sport?: string;
    residency?: string;
    unretained?: boolean;
  },
): { n: number; sample: ReturnType<typeof compactPerson>[] } {
  const current = new Set(lists.students.map((s) => (s.pcid || "").toUpperCase()));
  let rows: CensusRawStudent[] = f.term === "fa25" ? lists.prior : lists.students;
  if (f.unretained) {
    const ids = new Set(lists.unretained.map((s) => (s.pcid || "").toUpperCase()));
    rows = lists.prior.filter((s) => ids.has((s.pcid || "").toUpperCase()));
  }
  const out = rows.filter((s) => {
    if (f.incoming != null) {
      const inc = (s.incomingReturning || "").toLowerCase().startsWith("incoming");
      if (inc !== f.incoming) return false;
    }
    if (f.ftca != null) {
      const ok = f.term === "fa25" ? isFtcaIncoming(s) : (s.collegeAttend || "").toUpperCase() === "FTCA";
      if (Boolean(ok) !== f.ftca) return false;
    }
    if (f.athlete != null && (athleteOf(s) === "Athlete") !== f.athlete) return false;
    if (f.football != null && ((s.sport || "").toLowerCase() === "football") !== f.football) return false;
    if (f.honors != null) {
      const t = (s.honors || "").trim();
      const hon = Boolean(t) && t !== "-";
      if (hon !== f.honors) return false;
    }
    if (f.testScore != null && hasTestScore(s) !== f.testScore) return false;
    if (f.catholic != null && isCatholic(s) !== f.catholic) return false;
    if (f.gender && (s.gender || "") !== f.gender) return false;
    if (f.sport && (s.sport || "").toLowerCase() !== f.sport.toLowerCase()) return false;
    if (f.residency && !(s.residency || "").toLowerCase().includes(f.residency.toLowerCase())) return false;
    return true;
  });
  return {
    n: out.length,
    sample: out.slice(0, 12).map((s) =>
      compactPerson(s, { registeredFa26: current.has((s.pcid || "").toUpperCase()) }),
    ),
  };
}
