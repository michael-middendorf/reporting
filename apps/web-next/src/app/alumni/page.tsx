"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ColumnChart, HorizontalBarChart } from "@/components/alumni/charts";
import { apiFetch } from "@/lib/api";
import {
  buildDrilldownHref,
  cohortDrilldownSpec,
  detailClassYearLabel,
  leaderDrilldownSpec,
  pillToneForOpportunity,
  pillToneForRecency,
  summaryCardDrilldownSpec,
} from "@/lib/reports/alumni/drilldown";
import "@/styles/alumni.css";

async function load(path: string) {
  const res = await apiFetch(`/api/reports/alumni/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });

type Detail = Record<string, unknown>;

function formatDate(value: unknown) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : dateFmt.format(date);
}

function formatMonth(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : monthFmt.format(date);
}

function formatMonthYear(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${monthFmt.format(date)} ${date.getFullYear()}`;
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  const colors: Record<string, string> = {
    cool: "#2f6b4f",
    warm: "#a85a2a",
    alert: "#8f2d1f",
    neutral: "#55665a",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        background: "rgba(23,38,31,0.06)",
        color: colors[tone] || colors.neutral,
      }}
    >
      {children}
    </span>
  );
}

const COHORT_METRICS = [
  ["alumni_count", "Alumni"],
  ["lifetime_donor_count", "Lifetime Donors"],
  ["recent_donor_365_count", "Recent Donors 365"],
  ["touched_90_count", "Touched 90"],
  ["recent_donor_untouched_90_count", "Untouched Recent Donors"],
  ["assigned_count", "Assigned"],
  ["unassigned_count", "Unassigned"],
] as const;

const LEADER_GROUPS = [
  ["Top Note Types (90 Days)", "top_note_types_90"],
  ["Top Note Creators (90 Days)", "top_note_creators_90"],
  ["Unassigned Recent Donor Decades", "unassigned_recent_donor_decades"],
  ["Recent Donor Solicitor Groups", "recent_donor_solicitor_groups"],
] as const;

export default function AlumniPage() {
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [trends, setTrends] = useState<Record<string, unknown> | null>(null);
  const [cohorts, setCohorts] = useState<Record<string, unknown> | null>(null);
  const [leaders, setLeaders] = useState<Record<string, unknown> | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);
  const [tab, setTab] = useState("class_year");
  const [search, setSearch] = useState("");
  const [classYear, setClassYear] = useState("");
  const [decade, setDecade] = useState("");
  const [donorRecency, setDonorRecency] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [assignment, setAssignment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      load("metadata.json").catch(() => ({})),
      load("summary.json"),
      load("trends.json"),
      load("cohorts.json"),
      load("leaders.json"),
      load("detail_index.json"),
    ])
      .then(([m, s, t, c, l, d]) => {
        setMeta(m);
        setSummary(s);
        setTrends(t);
        setCohorts(c);
        setLeaders(l);
        const list = Array.isArray(d) ? d : d?.records || d?.rows || [];
        setDetails(list as Detail[]);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const cards = useMemo(() => {
    if (!summary) return [];
    const fromCards = summary.cards;
    if (Array.isArray(fromCards)) {
      return (fromCards as { id?: string; label?: string; value?: string | number; context?: string }[])
        .slice(0, 16)
        .map((c) => ({
          key: c.id || c.label || "metric",
          label: c.label || c.id || "Metric",
          value: c.value ?? "—",
          context: c.context,
          id: c.id,
        }));
    }
    return [];
  }, [summary]);

  const classYears = useMemo(() => {
    const vals = [...new Set(details.map(detailClassYearLabel).filter(Boolean))];
    return vals.sort((a, b) => {
      const ay = /^\d{4}$/.test(a) ? Number(a) : Infinity;
      const by = /^\d{4}$/.test(b) ? Number(b) : Infinity;
      return ay !== by ? ay - by : a.localeCompare(b);
    });
  }, [details]);

  const unique = (key: string) =>
    [...new Set(details.map((r) => r[key]).filter(Boolean).map(String))].sort();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return details
      .filter((row) => {
        if (classYear && detailClassYearLabel(row) !== classYear) return false;
        if (decade && row.decade !== decade) return false;
        if (donorRecency && row.donor_recency_bucket !== donorRecency) return false;
        if (opportunity && row.opportunity_bucket !== opportunity) return false;
        if (assignment && row.assignment_status !== assignment) return false;
        if (q) {
          const hay = [
            row.full_name,
            detailClassYearLabel(row),
            row.degree,
            row.major,
            row.assigned_solicitor_group,
            row.opportunity_bucket,
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .slice(0, 300);
  }, [details, search, classYear, decade, donorRecency, opportunity, assignment]);

  const cohortTable = (cohorts?.[tab] || []) as Array<Record<string, unknown> & { label?: string }>;

  const cohortTabs = [
    ["class_year", "class year"],
    ["decade", "decade"],
    ["donor_recency_bucket", "recency"],
    ["opportunity_bucket", "opportunity"],
    ["assignment_status", "assignment"],
  ] as const;

  const recency = trends?.donor_recency_distribution as
    | { labels?: string[]; values?: number[] }
    | undefined;
  const opp = trends?.opportunity_distribution as
    | { labels?: string[]; values?: number[] }
    | undefined;
  const months = (trends?.months as string[]) || [];
  const giftAmounts = ((trends?.monthly_gift_amounts as unknown[]) || []).map(Number);
  const touched = ((trends?.monthly_touched_contacts as unknown[]) || []).map(Number);

  return (
    <AccessGate report="alumni">
      <div className="alumni-root">
        <ReportTopBar
          title="Alumni Coverage"
          nav={[
            { href: "/alumni", label: "Dashboard" },
            { href: "/alumni/drilldown", label: "Drilldown" },
          ]}
        />
        <main style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
          <header style={{ marginBottom: 24 }}>
            <p style={{ letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, color: "#8f2d1f" }}>
              Advancement
            </p>
            <h1 style={{ fontFamily: "Iowan Old Style, Palatino, serif", fontSize: 36, margin: "6px 0" }}>
              Alumni Coverage &amp; Opportunity
            </h1>
            {meta && (
              <p style={{ opacity: 0.7, fontSize: 13 }}>
                Generated {String(meta.generated_at_display || meta.generated_at || "—")}
                {meta.mode != null ? ` · ${String(meta.mode)}` : ""}
                {meta.runtime_seconds != null ? ` · ${String(meta.runtime_seconds)}s` : ""}
              </p>
            )}
            {loading && <p>Loading alumni data…</p>}
            {error && (
              <p style={{ color: "#8f2d1f" }}>
                {error.includes("404") || error.includes("Not found")
                  ? "No alumni artifacts are published yet. Run the alumni refresh pipeline to populate them."
                  : error}
              </p>
            )}
          </header>

          {!error && !loading && (
            <>
              <section
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
                  gap: 12,
                  marginBottom: 28,
                }}
              >
                {cards.map((c) => (
                  <Link
                    key={c.key}
                    href={buildDrilldownHref(summaryCardDrilldownSpec({ id: c.id, label: c.label }))}
                    style={{
                      background: "#fff",
                      borderRadius: 20,
                      padding: 16,
                      textDecoration: "none",
                      color: "inherit",
                      border: "1px solid #e5d9c6",
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{c.label}</div>
                    <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>
                      {typeof c.value === "number" && String(c.key).toLowerCase().includes("amount")
                        ? money.format(c.value)
                        : typeof c.value === "number"
                          ? c.value.toLocaleString()
                          : String(c.value)}
                    </div>
                    {c.context && (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{c.context}</div>
                    )}
                    <div style={{ fontSize: 11, color: "#8f2d1f", marginTop: 8 }}>View alumni list</div>
                  </Link>
                ))}
              </section>

              <section
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
                  gap: 16,
                  marginBottom: 28,
                }}
              >
                <div style={{ background: "#fff", borderRadius: 16, padding: 16, border: "1px solid #e5d9c6" }}>
                  <h2 style={{ marginTop: 0, fontSize: 18 }}>Donor recency</h2>
                  {recency?.labels?.length ? (
                    <HorizontalBarChart
                      labels={recency.labels}
                      values={(recency.values || []).map(Number)}
                      formatValue={(n) => `${n} contacts`}
                      hrefFor={(label) =>
                        buildDrilldownHref({
                          title: `Donor Recency: ${label}`,
                          predicates: [{ kind: "eq", key: "donor_recency_bucket", value: label }],
                        })
                      }
                    />
                  ) : (
                    <p style={{ opacity: 0.6 }}>No recency data.</p>
                  )}
                </div>
                <div style={{ background: "#fff", borderRadius: 16, padding: 16, border: "1px solid #e5d9c6" }}>
                  <h2 style={{ marginTop: 0, fontSize: 18 }}>Opportunity</h2>
                  {opp?.labels?.length ? (
                    <HorizontalBarChart
                      labels={opp.labels}
                      values={(opp.values || []).map(Number)}
                      formatValue={(n) => `${n} contacts`}
                      hrefFor={(label) =>
                        buildDrilldownHref({
                          title: `Opportunity: ${label}`,
                          predicates: [{ kind: "eq", key: "opportunity_bucket", value: label }],
                        })
                      }
                    />
                  ) : (
                    <p style={{ opacity: 0.6 }}>No opportunity data.</p>
                  )}
                </div>
              </section>

              <section
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
                  gap: 16,
                  marginBottom: 28,
                }}
              >
                <div style={{ background: "#fff", borderRadius: 16, padding: 16, border: "1px solid #e5d9c6" }}>
                  <h2 style={{ marginTop: 0, fontSize: 18 }}>Monthly gift amounts</h2>
                  {months.length ? (
                    <ColumnChart
                      labels={months}
                      values={giftAmounts}
                      formatValue={(n) => money.format(n || 0)}
                      formatLabel={formatMonth}
                      fill="rgba(143, 45, 31, 0.82)"
                      hrefFor={(label) =>
                        buildDrilldownHref({
                          title: `Gifts in ${formatMonthYear(label)}`,
                          segmentKey: `monthly_gift:${label}`,
                          predicates: [],
                        })
                      }
                    />
                  ) : (
                    <p style={{ opacity: 0.6 }}>No monthly gift trend.</p>
                  )}
                </div>
                <div style={{ background: "#fff", borderRadius: 16, padding: 16, border: "1px solid #e5d9c6" }}>
                  <h2 style={{ marginTop: 0, fontSize: 18 }}>Monthly touched alumni</h2>
                  {months.length ? (
                    <ColumnChart
                      labels={months}
                      values={touched}
                      formatValue={(n) => `${n} contacts`}
                      formatLabel={formatMonth}
                      fill="rgba(60, 112, 82, 0.84)"
                      hrefFor={(label) =>
                        buildDrilldownHref({
                          title: `Touched alumni in ${formatMonthYear(label)}`,
                          segmentKey: `monthly_touch:${label}`,
                          predicates: [],
                        })
                      }
                    />
                  ) : (
                    <p style={{ opacity: 0.6 }}>No monthly touch trend.</p>
                  )}
                </div>
              </section>

              <section style={{ marginBottom: 28 }}>
                <h2>Cohorts</h2>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {cohortTabs.map(([t, label]) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        border: "1px solid #e5d9c6",
                        background: tab === t ? "#8f2d1f" : "#fff",
                        color: tab === t ? "#fff" : "#3a2a1f",
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ overflowX: "auto", background: "#fff", borderRadius: 16 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th align="left">Group</th>
                        {COHORT_METRICS.map(([, label]) => (
                          <th key={label} align="right">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cohortTable.map((row, i) => (
                        <tr key={i}>
                          <td>{String(row.label ?? "")}</td>
                          {COHORT_METRICS.map(([key, label]) => (
                            <td key={key} align="right">
                              <Link
                                href={buildDrilldownHref(
                                  cohortDrilldownSpec(tab, row, key, label),
                                )}
                                style={{ color: "#8f2d1f" }}
                              >
                                {String(row[key] ?? 0)}
                              </Link>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
                  gap: 12,
                  marginBottom: 28,
                }}
              >
                {LEADER_GROUPS.map(([title, key]) => {
                  const rows = (leaders?.[key] || []) as Array<[string, number] | { 0: string; 1: number }>;
                  return (
                    <article
                      key={key}
                      style={{
                        background: "#fff",
                        borderRadius: 16,
                        padding: 14,
                        border: "1px solid #e5d9c6",
                      }}
                    >
                      <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{title}</h3>
                      {rows.length ? (
                        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                          <tbody>
                            {rows.slice(0, 12).map((pair, i) => {
                              const label = Array.isArray(pair) ? pair[0] : String(pair[0]);
                              const value = Array.isArray(pair) ? pair[1] : Number(pair[1]);
                              const spec = leaderDrilldownSpec(title, label);
                              return (
                                <tr key={i}>
                                  <td>{label}</td>
                                  <td align="right">
                                    {spec ? (
                                      <Link href={buildDrilldownHref(spec)} style={{ color: "#8f2d1f" }}>
                                        {value}
                                      </Link>
                                    ) : (
                                      value
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <p style={{ opacity: 0.6, margin: 0 }}>No data.</p>
                      )}
                    </article>
                  );
                })}
              </section>

              <section>
                <h2>Alumni detail</h2>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 12,
                    alignItems: "center",
                  }}
                >
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, degree, major…"
                    style={{ padding: 8, width: "min(280px,100%)" }}
                  />
                  <select value={classYear} onChange={(e) => setClassYear(e.target.value)}>
                    <option value="">All class years</option>
                    {classYears.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select value={decade} onChange={(e) => setDecade(e.target.value)}>
                    <option value="">All decades</option>
                    {unique("decade").map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select value={donorRecency} onChange={(e) => setDonorRecency(e.target.value)}>
                    <option value="">All recency</option>
                    {unique("donor_recency_bucket").map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select value={opportunity} onChange={(e) => setOpportunity(e.target.value)}>
                    <option value="">All opportunity</option>
                    {unique("opportunity_bucket").map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select value={assignment} onChange={(e) => setAssignment(e.target.value)}>
                    <option value="">All assignment</option>
                    {unique("assignment_status").map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <span style={{ opacity: 0.65, fontSize: 13 }}>{filtered.length} shown</span>
                </div>
                <div style={{ overflowX: "auto", background: "#fff", borderRadius: 16 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th align="left">Name</th>
                        <th align="left">Class</th>
                        <th align="left">Recency</th>
                        <th align="left">Touched 90</th>
                        <th align="left">Assigned</th>
                        <th align="left">Opportunity</th>
                        <th align="left">Last gift</th>
                        <th align="right">LTD</th>
                        <th align="right">YTD</th>
                        <th align="left">Last touch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row, i) => (
                        <tr key={i}>
                          <td>{String(row.full_name || "")}</td>
                          <td>{detailClassYearLabel(row)}</td>
                          <td>
                            <Pill tone={pillToneForRecency(String(row.donor_recency_bucket || ""))}>
                              {String(row.donor_recency_bucket || "")}
                            </Pill>
                          </td>
                          <td>{row.touched_90_flag ? "Yes" : "No"}</td>
                          <td>{row.assigned_flag ? "Yes" : "No"}</td>
                          <td>
                            <Pill
                              tone={pillToneForOpportunity(String(row.opportunity_bucket || ""))}
                            >
                              {String(row.opportunity_bucket || "")}
                            </Pill>
                          </td>
                          <td>{formatDate(row.last_gift_date)}</td>
                          <td align="right">{money.format(Number(row.life_to_date_giving || 0))}</td>
                          <td align="right">{money.format(Number(row.year_to_date_giving || 0))}</td>
                          <td>{formatDate(row.last_touch_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </AccessGate>
  );
}
