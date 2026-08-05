"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
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

export default function AlumniPage() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [trends, setTrends] = useState<Record<string, unknown> | null>(null);
  const [cohorts, setCohorts] = useState<Record<string, unknown> | null>(null);
  const [leaders, setLeaders] = useState<Record<string, unknown> | null>(null);
  const [details, setDetails] = useState<Record<string, unknown>[]>([]);
  const [tab, setTab] = useState("class_year");
  const [search, setSearch] = useState("");
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
      .then(([, s, t, c, l, d]) => {
        setSummary(s);
        setTrends(t);
        setCohorts(c);
        setLeaders(l);
        const list = Array.isArray(d) ? d : d?.records || d?.rows || [];
        setDetails(list as Record<string, unknown>[]);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const cards = useMemo(() => {
    if (!summary) return [];
    const fromCards = summary.cards;
    if (Array.isArray(fromCards)) {
      return (fromCards as { id?: string; label?: string; value?: string | number; context?: string }[])
        .slice(0, 12)
        .map((c) => ({
          key: c.id || c.label || "metric",
          label: c.label || c.id || "Metric",
          value: c.value ?? "—",
          context: c.context,
        }));
    }
    return Object.entries(summary)
      .filter(([, v]) => typeof v === "number" || typeof v === "string")
      .slice(0, 8)
      .map(([k, v]) => ({
        key: k,
        label: k.replaceAll("_", " "),
        value: v as string | number,
        context: undefined as string | undefined,
      }));
  }, [summary]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return details.slice(0, 100);
    return details
      .filter((r) => JSON.stringify(r).toLowerCase().includes(q))
      .slice(0, 100);
  }, [details, search]);

  const cohortTable = (
    cohorts?.[tab] ||
    cohorts?.rows ||
    []
  ) as Record<string, unknown>[];

  const cohortTabs = [
    ["class_year", "class year"],
    ["decade", "decade"],
    ["donor_recency_bucket", "recency"],
    ["opportunity_bucket", "opportunity"],
    ["assignment_status", "assignment"],
  ] as const;

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
            {loading && <p>Loading alumni data…</p>}
            {error && (
              <p style={{ color: "#8f2d1f" }}>
                {error.includes("404") || error.includes("Not found")
                  ? "No alumni artifacts are published yet. Expected JSON under the app data bucket (alumni/) or MAS report bucket. Run the alumni refresh pipeline to populate them."
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
                    href={`/alumni/drilldown?metric=${encodeURIComponent(c.key)}`}
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
                  </Link>
                ))}
              </section>

              <section style={{ marginBottom: 28 }}>
                <h2>Trends</h2>
                <pre
                  style={{
                    background: "#fff",
                    borderRadius: 16,
                    padding: 16,
                    overflow: "auto",
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(trends, null, 2)}
                </pre>
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
                        {cohortTable[0] &&
                          Object.keys(cohortTable[0]).slice(0, 6).map((c) => (
                            <th key={c} align="left">
                              {c}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(cohortTable) ? cohortTable : []).slice(0, 50).map((row, i) => (
                        <tr key={i}>
                          {Object.keys(cohortTable[0] || {})
                            .slice(0, 6)
                            .map((c) => (
                              <td key={c}>{String(row[c] ?? "")}</td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section style={{ marginBottom: 28 }}>
                <h2>Leaders</h2>
                <pre style={{ background: "#fff", borderRadius: 16, padding: 16, fontSize: 12 }}>
                  {JSON.stringify(leaders, null, 2)}
                </pre>
              </section>

              <section>
                <h2>Alumni detail</h2>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter…"
                  style={{ marginBottom: 12, padding: 8, width: "min(360px,100%)" }}
                />
                <div style={{ overflowX: "auto", background: "#fff", borderRadius: 16 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        {filtered[0] &&
                          Object.keys(filtered[0]).slice(0, 7).map((c) => (
                            <th key={c} align="left">
                              {c}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row, i) => (
                        <tr key={i}>
                          {Object.keys(filtered[0] || {})
                            .slice(0, 7)
                            .map((c) => (
                              <td key={c}>{String(row[c] ?? "")}</td>
                            ))}
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
