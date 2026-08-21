"use client";

import { useEffect, useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import {
  Bars,
  Bottleneck,
  ColChart,
  Donut,
  Feed,
  Funnel,
  Gauge,
  Histogram,
  InfoTip,
  type FeedRow,
  type GaugeVM,
} from "@/components/institute/charts";
import {
  avg,
  BIN_ORDER,
  binColor,
  BLANK,
  clean,
  COLORS,
  countBy,
  ctxData,
  defaultTerm,
  emptyFilters,
  type Applicant,
  type Filters,
  type InstitutePayload,
  type Item,
  type PaceTerm,
  normalizeApplicants,
  parseDate,
  passes,
  priorTerm,
  STAGE5,
  STAGE5_COLOR,
  STAGE_LBL,
  termsFrom,
  uniqValues,
} from "@/lib/reports/institute/process";
import "@/styles/institute.css";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_BASIS: [string, string][] = [
  ["applyDate", "Applied"],
  ["interviewDate", "Interviewed"],
  ["acceptDate", "Accepted"],
  ["signedDate", "Signed"],
  ["binDate", "Bin change"],
];
const DATE_BASIS_LBL = Object.fromEntries(DATE_BASIS);

/* table columns */
type Col = { k: keyof Applicant; t: string; num?: boolean; bool?: boolean; link?: boolean };
const COLS: Col[] = [
  { k: "last", t: "Last" },
  { k: "first", t: "First" },
  { k: "sport", t: "Sport" },
  { k: "bin", t: "Bin" },
  { k: "ath", t: "Athletic" },
  { k: "score", t: "Score", num: true },
  { k: "rating", t: "Rating", num: true },
  { k: "gpa", t: "GPA", num: true },
  { k: "act", t: "ACT", num: true },
  { k: "accepted", t: "Acc", bool: true },
  { k: "signed", t: "Sign", bool: true },
  { k: "deposited", t: "Dep", bool: true },
  { k: "state", t: "St" },
  { k: "url", t: "Slate", link: true },
];

export default function InstitutePage() {
  return (
    <AccessGate report="institute">
      <InstituteDashboard />
    </AccessGate>
  );
}

function InstituteDashboard() {
  const [payload, setPayload] = useState<InstitutePayload | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [F, setF] = useState<Filters | null>(null);
  const [sortK, setSortK] = useState<keyof Applicant>("last");
  const [sortDir, setSortDir] = useState(1);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/institute-data");
        const json = (await res.json()) as InstitutePayload & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          setStatus(json.error || res.statusText || "Data unavailable");
          return;
        }
        const data = normalizeApplicants(json.q4 || []);
        setF((prev) => prev || emptyFilters(defaultTerm(data)));
        setPayload(json);
        setStatus(json.source || "Cached");
      } catch (e) {
        if (alive) setStatus(`Failed to load — ${String(e)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---------- derived data (payload-scoped) ---------- */
  const DATA = useMemo(() => normalizeApplicants(payload?.q4 ?? []), [payload]);
  const Q3 = payload?.q3 ?? [];
  const Q5 = payload?.q5 ?? [];
  const Q1S = payload?.q1_summary ?? {};
  const Q2S = payload?.q2_summary ?? {};
  const Q6S = payload?.q6_summary ?? {};
  const COUNTS = payload?.counts ?? {};
  const GOALS = payload?.config?.goals ?? {};
  const PACE = payload?.config?.pace ?? {};
  const RECR = payload?.config?.recruiting ?? {};

  const TERMS = useMemo(
    () => termsFrom(DATA, payload?.q1_summary ?? {}, payload?.q6_summary ?? {}),
    [DATA, payload],
  );
  const DEFAULT_TERM = useMemo(() => defaultTerm(DATA), [DATA]);

  const rows = useMemo(
    () => (F ? DATA.filter((d) => passes(d, F)) : []),
    [DATA, F],
  );

  /* ---------- render guards ---------- */
  if (status.startsWith("Failed") || (payload && (payload as { error?: string }).error)) {
    return (
      <div className="institute-root">
        <ReportTopBar title="The Institute" nav={[{ href: "/institute", label: "Dashboard" }]} />
        <div className="body">
          <div className="card">
            <h3>The Institute — Admissions Pipeline</h3>
            <p className="muted">{status}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!payload || !F) {
    return (
      <div className="institute-root">
        <ReportTopBar title="The Institute" nav={[{ href: "/institute", label: "Dashboard" }]} />
        <div className="body">
          <div className="loadcard">
            <span className="spin" /> {status}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- filter mutators ---------- */
  const setFilter = (key: keyof Filters, value: string) => setF({ ...F, [key]: value });
  const toggleFilter = (key: keyof Filters, value: string) =>
    setF({ ...F, [key]: F[key] === value ? "" : value });
  const clearFilters = () => setF(emptyFilters(DEFAULT_TERM));

  /* ---------- gauges + conversion funnel ---------- */
  const cur = {
    applicants: rows.length,
    interviews: rows.filter((d) => d.interviewed).length,
    accepted: rows.filter((d) => d.accepted).length,
    signed: rows.filter((d) => d.signed).length,
  };
  const deposited = rows.filter((d) => d.deposited).length;
  const goalKey: Record<string, string> = {
    applicants: "Applicants",
    interviews: "Interviews",
    accepted: "Accepted",
    signed: "Signed",
  };
  const defTerm = typeof PACE._default === "string" ? PACE._default : "";
  const pinfoRaw = PACE[F.term] ?? (defTerm ? PACE[defTerm] : null);
  const pinfo = pinfoRaw && typeof pinfoRaw === "object" ? (pinfoRaw as PaceTerm) : null;
  const measures = pinfo?.measures ?? {};
  const funnelIntro =
    pinfo && pinfo.prior && Object.keys(measures).length ? (
      <>
        Click a stage to filter · marker = goal × last year&rsquo;s enrollment pace{" "}
        <b>per measure</b> (where {pinfo.prior} stood by {pinfo.asOf}). &ldquo;% of pace&rdquo; =
        current vs. where you should be now.
      </>
    ) : (
      <>Click a stage to filter · no prior-cycle enrollment data for {F.term || "this selection"} — marker = full goal.</>
    );

  const gaugeDefs: { key: string; name: string; col: string }[] = [
    { key: "applicants", name: "Applicants", col: COLORS.teal },
    { key: "interviews", name: "Interviews", col: COLORS.blue },
    { key: "accepted", name: "Accepted", col: COLORS.gold },
    { key: "signed", name: "Signed", col: COLORS.green },
  ];
  const gauges: GaugeVM[] = gaugeDefs.map((g) => {
    const c = cur[g.key as keyof typeof cur];
    const goalRaw = GOALS[goalKey[g.key]];
    const goal = typeof goalRaw === "number" ? goalRaw : null;
    const mname = goalKey[g.key];
    const mp =
      measures[mname] && typeof measures[mname].pace === "number" ? measures[mname].pace! : null;
    let fillFrac = 1;
    let markerFrac: number | null = null;
    let yoy: GaugeVM["yoy"] = null;
    let sub = F.term || "all terms";
    if (goal) {
      const bench = mp != null ? goal * mp : goal;
      const scale = Math.max(c, goal) * 1.15;
      fillFrac = c / scale;
      markerFrac = bench / scale;
      const pct = Math.round((c / bench) * 100);
      yoy = { up: c >= bench, pct };
      sub =
        mp != null ? `goal ${goal} · ${Math.round(mp * 100)}% pace → ${Math.round(bench)}` : `goal ${goal}`;
    }
    return { ...g, value: c, fillFrac, markerFrac, yoy, sub, on: F.stage === g.key };
  });
  const onGauge = (key: string) =>
    setF({ ...F, stage: F.stage === key || key === "applicants" ? "" : key });
  const funnelStages: [string, number, string][] = [
    ["Applicants", cur.applicants, COLORS.teal],
    ["Interviews", cur.interviews, COLORS.blue],
    ["Accepted", cur.accepted, COLORS.gold],
    ["Signed", cur.signed, COLORS.green],
    ["Deposited", deposited, COLORS.purple],
  ];

  /* ---------- AMU context (q1) ---------- */
  const ctx = ctxData(Q1S, F.term);
  const ctxItems: Item[] = Object.entries(ctx.byType)
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v);
  const ctxPrior = F.term ? priorTerm(Q1S, F.term) : null;
  const appliedInTerm = DATA.filter((d) => !F.term || d.term === F.term).length;
  const ctxMini: [string, string][] = [
    ["Total AMU applications", ctx.total.toLocaleString()],
    ["Institute applicants", appliedInTerm.toLocaleString()],
    ["Institute prospect pool", (Q2S.total || 0).toLocaleString()],
    ["Recruiting pipeline", (COUNTS.q3 || 0).toLocaleString()],
  ];

  /* ---------- applicant stats ---------- */
  const nScores = (k: keyof Applicant) => rows.filter((d) => d[k] != null).length;
  const statCells = [
    { l: "GPA", v: avg(rows, "gpa", 2), n: "AMU recalc" },
    { l: "SAT", v: avg(rows, "sat", 0), n: `${nScores("sat")} scores` },
    { l: "ACT", v: avg(rows, "act", 0), n: `${nScores("act")} scores` },
    { l: "CLT", v: avg(rows, "clt", 0), n: `${nScores("clt")} scores` },
    { l: "Adm. Interview", v: avg(rows, "rating", 1), n: "avg rating" },
    { l: "Institute Score", v: avg(rows, "score", 1), n: "avg total" },
  ];

  /* ---------- bottleneck ---------- */
  const bnRows = DATA.filter((d) => passes(d, F, "stage5"));
  const bnCounts: Record<string, number> = {};
  STAGE5.forEach((s) => (bnCounts[s] = 0));
  let bnOther = 0;
  bnRows.forEach((d) => {
    if (bnCounts[d.stage] != null) bnCounts[d.stage]++;
    else bnOther++;
  });
  const bnItems: Item[] = STAGE5.map((s) => ({ k: s, v: bnCounts[s] }));
  if (bnOther) bnItems.push({ k: "Other", v: bnOther });

  /* ---------- facet charts ---------- */
  const sportItems = countBy(DATA.filter((d) => passes(d, F, "sport")), "sport")
    .filter((x) => x.k !== "(non-athlete)")
    .slice(0, 12);
  const genderItems = countBy(rows, "gender").map((x) => ({
    k: x.k === "M" ? "Male" : x.k === "F" ? "Female" : x.k,
    v: x.v,
  }));
  const athItems = countBy(rows, "ath").filter((x) => x.k !== BLANK);
  const stateItems = countBy(DATA.filter((d) => passes(d, F, "state")), "state")
    .filter((x) => x.k !== BLANK)
    .slice(0, 12);

  /* ---------- score histogram ---------- */
  const scores = rows.map((d) => d.score).filter((v) => v != null);
  const useRating = scores.length < rows.length * 0.4;
  const scoreVals = useRating ? rows.map((d) => d.rating) : rows.map((d) => d.score);
  const scoreLabel = useRating
    ? "Total interview rating distribution"
    : "Institute total score distribution";

  /* ---------- pipeline history (q6) ---------- */
  const histTerms = F.term ? [F.term] : Object.keys(Q6S);
  const histCur: Record<string, number> = {};
  histTerms.forEach((t) => {
    const s = Q6S[t];
    if (!s) return;
    Object.entries(s.current || {}).forEach(([k, v]) => (histCur[k] = (histCur[k] || 0) + v));
  });
  const histItems: Item[] = BIN_ORDER.filter((b) => histCur[b]).map((b) => ({ k: b, v: histCur[b] }));
  Object.keys(histCur)
    .filter((b) => !BIN_ORDER.includes(b))
    .forEach((b) => histItems.push({ k: b, v: histCur[b] }));

  /* ---------- recruiting (q3) ---------- */
  const recCount: Record<string, number> = {};
  Q3.forEach((r) => {
    const b = clean(r.UndergraduateBin) || "(blank)";
    recCount[b] = (recCount[b] || 0) + 1;
  });
  const recItems = Object.entries(recCount)
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 12);

  /* ---------- recruiting calls workflow — FA27 KPI dials (q7) ---------- */
  const RECR_COLORS = [COLORS.teal, COLORS.blue, COLORS.gold];
  const recruitingGauges: GaugeVM[] = (RECR.kpis ?? []).map((k, i) => {
    const scale = Math.max(k.value, k.goal) * 1.15;
    const hasTarget = k.target > 0;
    return {
      key: k.key,
      name: k.name,
      col: RECR_COLORS[i % RECR_COLORS.length],
      value: k.value,
      fillFrac: scale ? k.value / scale : 0,
      markerFrac: hasTarget ? k.target / scale : null,
      yoy: hasTarget ? { up: k.value >= k.target, pct: Math.round((k.value / k.target) * 100) } : null,
      sub: `goal ${k.goal} · target ${Math.round(k.target)} by today`,
      on: false,
      info: k.info,
    };
  });

  /* ---------- prospects (q2) ---------- */
  const proItems = Object.entries(Q2S.byState || {})
    .filter(([k]) => k && k !== "(blank)")
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 12);

  /* ---------- engagement (q5) ---------- */
  const monthCounts = new Array(12).fill(0);
  let anyMonth = false;
  Q5.forEach((r) => {
    const d = parseDate(r.Date);
    if (d) {
      monthCounts[d.getMonth()]++;
      anyMonth = true;
    }
  });
  let mLo = 0;
  let mHi = 11;
  if (anyMonth) {
    mLo = monthCounts.findIndex((x) => x > 0);
    mHi = 11 - [...monthCounts].reverse().findIndex((x) => x > 0);
  }
  const monthItems: Item[] = [];
  for (let i = mLo; i <= mHi; i++) monthItems.push({ k: MON[i], v: monthCounts[i] });
  const monthChart = monthItems.length ? monthItems : MON.slice(0, 8).map((m) => ({ k: m, v: 0 }));
  const typeCounts: Record<string, number> = {};
  Q5.forEach((r) => {
    const c = clean(r.Code) || "Other";
    typeCounts[c] = (typeCounts[c] || 0) + 1;
  });
  const typeItems = Object.entries(typeCounts)
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v);
  const feedRows: FeedRow[] = [...Q5]
    .sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)))
    .map((r) => ({
      summary: clean(r.Summary),
      code: clean(r.Code),
      date: clean(r.Date),
      user: clean(r.User),
      pcid: clean(r.PCID),
    }));

  /* ---------- table sort ---------- */
  const onSort = (k: keyof Applicant) => {
    if (sortK === k) setSortDir((d) => d * -1);
    else {
      setSortK(k);
      setSortDir(1);
    }
  };
  const sortedRows = [...rows].sort((a, b) => {
    const x = a[sortK];
    const y = b[sortK];
    if (typeof x === "boolean" || typeof y === "boolean")
      return ((y ? 1 : 0) - (x ? 1 : 0)) * sortDir;
    if (x == null && y == null) return 0;
    if (typeof x === "number" || typeof y === "number") {
      const xn = typeof x === "number" ? x : -Infinity;
      const yn = typeof y === "number" ? y : -Infinity;
      return (xn - yn) * sortDir;
    }
    return String(x).localeCompare(String(y)) * sortDir;
  });

  /* ---------- chips ---------- */
  type Chip = { k: string; lbl: string; val: string };
  const chips: Chip[] = [];
  const addChip = (k: string, lbl: string, val: string) => {
    if (val) chips.push({ k, lbl, val });
  };
  addChip("search", "Search", F.search);
  addChip("sport", "Sport", F.sport);
  addChip("gender", "Gender", F.gender);
  addChip("ath", "Athletic", F.ath);
  addChip("bin", "Bin", F.bin);
  addChip("state", "State", F.state);
  if (F.stage5) chips.push({ k: "stage5", lbl: "Pipeline", val: F.stage5 });
  if (F.stage) chips.push({ k: "stage", lbl: "Gauge", val: STAGE_LBL[F.stage] });
  if (F.dateFrom || F.dateTo)
    chips.push({
      k: "date",
      lbl: DATE_BASIS_LBL[F.dateBasis] || "Date",
      val: `${F.dateFrom || "…"} → ${F.dateTo || "…"}`,
    });
  const removeChip = (k: string) => {
    if (k === "date") setF({ ...F, dateFrom: "", dateTo: "" });
    else setF({ ...F, [k]: "" });
  };

  /* ---------- table cell helpers ---------- */
  const dash = <span className="muted">—</span>;
  const yn = (v: boolean) => (v ? <span className="tick">✓</span> : <span className="muted">·</span>);
  const num = (v: number | null) => (v == null ? dash : v);

  return (
    <div className="institute-root">
      <ReportTopBar title="The Institute" nav={[{ href: "/institute", label: "Dashboard" }]} />

      <header className="top">
        <div className="wrap">
          <div className="brand">
            <div>
              <div className="mark">THE</div>
              <h1>INSTITUTE</h1>
              <div className="tag">Ave Maria University · Admissions Pipeline</div>
            </div>
          </div>
          <div className="meta">
            Source: Slate service queries
            <br />
            Generated: <b>{payload.generated_at || ""}</b>
            <br />
            <span>
              <b>{DATA.length}</b> applicants · <b>{(COUNTS.q2 || 0).toLocaleString()}</b> prospects ·{" "}
              <b>{(COUNTS.q1 || 0).toLocaleString()}</b> AMU apps
            </span>
          </div>
        </div>
      </header>

      <div className="body">
        {/* ---------- filters ---------- */}
        <div className="filters">
          <div className="fld">
            <label>Search</label>
            <input
              type="search"
              value={F.search}
              placeholder="name, high school, city…"
              onChange={(e) => setFilter("search", e.target.value)}
            />
          </div>
          <SelectFld
            label="Term"
            value={F.term}
            allLabel="All terms"
            options={TERMS}
            onChange={(v) => setFilter("term", v)}
          />
          <SelectFld
            label="Sport"
            value={F.sport}
            allLabel="All sports"
            options={uniqValues(DATA, "sport")}
            onChange={(v) => setFilter("sport", v)}
          />
          <SelectFld
            label="Gender"
            value={F.gender}
            allLabel="All"
            options={uniqValues(DATA, "gender")}
            onChange={(v) => setFilter("gender", v)}
          />
          <SelectFld
            label="Athletic"
            value={F.ath}
            allLabel="All"
            options={uniqValues(DATA, "ath")}
            onChange={(v) => setFilter("ath", v)}
          />
          <SelectFld
            label="Bin"
            value={F.bin}
            allLabel="All bins"
            options={uniqValues(DATA, "bin")}
            onChange={(v) => setFilter("bin", v)}
          />
          <SelectFld
            label="State"
            value={F.state}
            allLabel="All states"
            options={uniqValues(DATA, "state")}
            onChange={(v) => setFilter("state", v)}
          />
          <div className="datebox">
            <SelectFld
              label="Date basis"
              value={F.dateBasis}
              options={DATE_BASIS.map(([v]) => v)}
              labels={DATE_BASIS_LBL}
              onChange={(v) => setFilter("dateBasis", v)}
            />
            <div className="fld">
              <label>From</label>
              <input
                type="date"
                value={F.dateFrom}
                onChange={(e) => setFilter("dateFrom", e.target.value)}
              />
            </div>
            <div className="fld">
              <label>To</label>
              <input
                type="date"
                value={F.dateTo}
                onChange={(e) => setFilter("dateTo", e.target.value)}
              />
            </div>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={clearFilters}>
            Clear filters
          </button>
        </div>

        {/* ---------- chips ---------- */}
        {chips.length > 0 && (
          <div className="chips">
            {chips.map((a) => (
              <span className="chip" key={a.k}>
                {a.lbl}: <b>{a.val}</b>
                <span className="x" onClick={() => removeChip(a.k)}>
                  ✕
                </span>
              </span>
            ))}
          </div>
        )}

        {/* ---------- top row ---------- */}
        <div className="toprow">
          <div className="card">
            <h3>
              Institute Conversion Funnel{" "}
              {GOALS.placeholder ? (
                <span className="ph-badge" title="Set real targets in INSTITUTE_GOALS in build.py">
                  goals = placeholder
                </span>
              ) : null}
            </h3>
            <div className="chint">{funnelIntro}</div>
            <div className="gauges">
              {gauges.map((g) => (
                <Gauge key={g.key} g={g} onSelect={onGauge} />
              ))}
            </div>
            <Funnel stages={funnelStages} />
          </div>
          <div className="card context">
            <h3>
              AMU Applications{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                {F.term ? `· ${F.term}` : "· all terms"}
              </span>
            </h3>
            <div className="chint">
              {ctxPrior
                ? (() => {
                    const prev = Q1S[ctxPrior].total;
                    const pct = Math.round((ctx.total / prev) * 100);
                    const up = ctx.total >= prev;
                    return (
                      <>
                        All undergraduate apps ·{" "}
                        <span className={up ? "up" : "down"}>
                          {up ? "▲" : "▼"} {pct}% of {ctxPrior}
                        </span>{" "}
                        ({prev.toLocaleString()})
                      </>
                    );
                  })()
                : "All undergraduate applications (context)"}
            </div>
            {ctxItems.length ? (
              <Donut items={ctxItems} center={ctx.total.toLocaleString()} />
            ) : (
              <div className="empty">No data</div>
            )}
            <div>
              {ctxMini.map((r, i) => (
                <div className={`ministat ${i === 0 ? "first" : ""}`} key={r[0]}>
                  <span>{r[0]}</span>
                  <span className="ms-v">{r[1]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ---------- applicants section ---------- */}
        <div className="section-title">The Institute — Applicants</div>
        <div className="grid">
          <div className="card span4">
            <h3>Applicant Stats</h3>
            <div className="chint">Averages across the current selection</div>
            <div className="statgrid">
              {statCells.map((c) => (
                <div className="stat" key={c.l}>
                  <div className="s-lbl">{c.l}</div>
                  <div className="s-val">{c.v == null ? "—" : c.v}</div>
                  <div className="s-n">{c.n}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card span4">
            <h3>Pipeline Bottleneck</h3>
            <div className="chint">Applicants by stage · click a stage to filter</div>
            <Bottleneck
              items={bnItems}
              active={F.stage5}
              onSelect={(k) => toggleFilter("stage5", k)}
              colorMap={STAGE5_COLOR}
            />
          </div>
          <div className="card span4">
            <div style={{ display: "flex", gap: 18 }}>
              <div style={{ flex: 1 }}>
                <h3>Gender</h3>
                <div className="chint">Applicant split</div>
                <Donut
                  items={genderItems}
                  colorMap={(k) => (k === "Male" ? COLORS.blue : k === "Female" ? COLORS.rose : undefined)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <h3>Athletic</h3>
                <div className="chint">Athlete vs not</div>
                <Donut items={athItems} />
              </div>
            </div>
          </div>
          <div className="card span4">
            <h3>Applicants by Sport</h3>
            <div className="chint">Athlete applicants · click to filter</div>
            <Bars
              items={sportItems}
              active={F.sport}
              onSelect={(k) => toggleFilter("sport", k)}
            />
          </div>
          <div className="card span5">
            <h3>Top States</h3>
            <div className="chint">Applicant home state · click to filter</div>
            <Bars
              items={stateItems}
              active={F.state}
              onSelect={(k) => toggleFilter("state", k)}
            />
          </div>
          <div className="card span3">
            <h3>Institute Score</h3>
            <div className="chint">{scoreLabel}</div>
            <Histogram vals={scoreVals} lo={0} hi={30} bins={30} />
          </div>
        </div>

        {/* ---------- recruiting calls workflow KPIs (q7) ---------- */}
        {recruitingGauges.length ? (
          <>
            <div className="section-title">Recruiting Calls Workflow</div>
            <div className="card">
              <h3>
                FA27 KPIs{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  — {(RECR.count ?? 0).toLocaleString()} in workflow
                </span>
              </h3>
              <div className="chint">
                Season goals for the recruiting calls campaigns · marker = target-to-date on the FA27
                schedule{RECR.asOf ? ` (as of ${RECR.asOf})` : ""} · hover the “i” on each dial for
                exactly what it counts.
              </div>
              <div className="gauges g3">
                {recruitingGauges.map((g) => (
                  <Gauge key={g.key} g={g} />
                ))}
              </div>
            </div>
          </>
        ) : null}

        {/* ---------- AMU pipeline & prospects (separate from the calls workflow) ---------- */}
        <div className="section-title">AMU Pipeline &amp; Prospects</div>
        <div className="grid">
          <div className="card span4">
            <h3>
              AMU Undergraduate Pipeline <span className="muted">— {Q3.length}</span>
              <InfoTip
                wide
                text="People in the broader AMU undergraduate admissions pipeline, grouped by current bin (Awaiting Interview, Award, Deposited, …). Not the recruiting-calls workflow."
              />
            </h3>
            <div className="chint">
              Broader AMU admissions bins (Awaiting Interview, Award, Deposited, …) — not the
              recruiting-calls workflow.
            </div>
            <Bars items={recItems} colorMap={(k) => binColor(k)} />
          </div>
          <div className="card span4">
            <h3>
              Prospect Pool <span className="muted">— {(Q2S.total || 0).toLocaleString()}</span>
              <InfoTip
                wide
                text="Top-of-funnel Institute prospects grouped by home state. These people have not yet entered the Institute applicant workflow."
              />
            </h3>
            <div className="chint">Top-of-funnel Institute prospects by home state</div>
            <Bars items={proItems} />
          </div>
          <div className="card span4">
            <h3>
              Institute Applicant Bins
              <InfoTip
                wide
                flip
                text="Current occupancy of the Institute applicant workflow, grouped by bin (Needed, Scheduled, Completed, Denied, …). Not the recruiting-calls workflow."
              />
            </h3>
            <div className="chint">
              Current occupancy of the Institute applicant workflow (Needed, Scheduled, Completed,
              Denied, …) — not the recruiting-calls workflow.
            </div>
            <Bars items={histItems} colorMap={(k) => binColor(k)} />
          </div>
        </div>

        {/* ---------- engagement ---------- */}
        <div className="section-title">Engagement</div>
        <div className="grid">
          <div className="card span5">
            <h3>
              Communications by Month <span className="muted">— {Q5.length}</span>
            </h3>
            <div className="chint">Recruiting interactions logged over time</div>
            <ColChart items={monthChart} />
          </div>
          <div className="card span3">
            <h3>By Type</h3>
            <div className="chint">Interaction category</div>
            {typeItems.length ? <Donut items={typeItems} /> : <div className="empty">No data</div>}
          </div>
          <div className="card span4">
            <h3>Recent Activity</h3>
            <div className="chint">Latest logged interactions</div>
            <Feed rows={feedRows} />
          </div>
        </div>

        {/* ---------- applicants table ---------- */}
        <div className="card tablecard">
          <div className="thead-row">
            <h3 style={{ margin: 0 }}>
              Applicants <span className="muted">— {rows.length} shown</span>
            </h3>
            <span className="ferpa">🔒 FERPA — authorized staff only · do not share externally</span>
          </div>
          <div className="tbl-scroll">
            <table>
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.k} className={c.num ? "num" : ""} onClick={() => onSort(c.k)}>
                      {c.t}
                      {sortK === c.k ? <span className="arr"> {sortDir > 0 ? "▲" : "▼"}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={COLS.length} className="empty">
                      No applicants match your filters.
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((d, i) => {
                    const bc = binColor(d.bin);
                    return (
                      <tr key={`${d.pcid}-${i}`}>
                        <td>{d.last}</td>
                        <td>{d.first}</td>
                        <td>{d.sport === "(non-athlete)" ? dash : d.sport}</td>
                        <td>
                          <span className="pill" style={{ background: `${bc}1f`, color: bc }}>
                            {d.bin}
                          </span>
                        </td>
                        <td>{d.ath === BLANK ? dash : d.ath}</td>
                        <td className="num">{num(d.score)}</td>
                        <td className="num">{num(d.rating)}</td>
                        <td className="num">{d.gpa != null ? d.gpa.toFixed(2) : dash}</td>
                        <td className="num">{num(d.act)}</td>
                        <td>{yn(d.accepted)}</td>
                        <td>{yn(d.signed)}</td>
                        <td>{yn(d.deposited)}</td>
                        <td>{d.state}</td>
                        <td>
                          {d.url ? (
                            <a href={d.url} target="_blank" rel="noopener noreferrer">
                              open ↗
                            </a>
                          ) : (
                            dash
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="foot">
          The Institute — Admissions Pipeline. Data is served from the authenticated reporting API.
          YoY goals are set in <code>INSTITUTE_GOALS</code> in <code>build.py</code>. Replaces the
          legacy Qlik &ldquo;Institute&rdquo; app.
        </div>
      </div>
    </div>
  );
}

/* ---------- filter select ---------- */
function SelectFld({
  label,
  value,
  options,
  allLabel,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  allLabel?: string;
  labels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="fld">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allLabel != null && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {labels ? labels[o] || o : o}
          </option>
        ))}
      </select>
    </div>
  );
}
