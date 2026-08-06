"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import {
  applySegment,
  detailClassYearLabel,
  type DrilldownSpec,
  pillToneForOpportunity,
  pillToneForRecency,
} from "@/lib/reports/alumni/drilldown";
import "@/styles/alumni.css";

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

function formatDate(value: unknown) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : dateFmt.format(date);
}

function parseSpec(raw: string | null): DrilldownSpec {
  if (!raw) return { title: "All Alumni", segmentKey: "", predicates: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || "Alumni Segment",
      segmentKey: parsed.segmentKey || "",
      predicates: Array.isArray(parsed.predicates) ? parsed.predicates : [],
    };
  } catch {
    return { title: "Alumni Segment", segmentKey: "", predicates: [] };
  }
}

function csvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function slugify(value: string) {
  return (
    String(value || "segment")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "segment"
  );
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

function DrilldownInner() {
  const params = useSearchParams();
  const spec = useMemo(() => parseSpec(params.get("spec")), [params]);
  const legacyMetric = params.get("metric");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [segmentIndex, setSegmentIndex] = useState<{
    segments?: Record<string, { contact_ids?: unknown[]; title?: string }>;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/reports/alumni/detail_index.json").then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      }),
      apiFetch("/api/reports/alumni/segment_index.json")
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
      apiFetch("/api/reports/alumni/metadata.json")
        .then(async (res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ])
      .then(([details, segments, metadata]) => {
        const list = Array.isArray(details)
          ? details
          : details.records || details.rows || [];
        setRows(list);
        setSegmentIndex(segments);
        setMeta(metadata);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const effectiveSpec = useMemo(() => {
    if (spec.predicates?.length || spec.segmentKey || params.get("spec")) return spec;
    if (legacyMetric) {
      return {
        title: `Metric: ${legacyMetric}`,
        predicates: [],
        segmentKey: "",
      } as DrilldownSpec;
    }
    return spec;
  }, [spec, legacyMetric, params]);

  const segmented = useMemo(
    () => applySegment(rows, effectiveSpec, segmentIndex || undefined),
    [rows, effectiveSpec, segmentIndex],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = segmented;
    if (legacyMetric && !params.get("spec")) {
      const key = legacyMetric.toLowerCase();
      list = list.filter((r) => JSON.stringify(r).toLowerCase().includes(key));
    }
    if (!q) return list;
    return list.filter((row) => {
      const hay = [
        row.full_name,
        detailClassYearLabel(row),
        row.degree,
        row.major,
        row.assigned_solicitor_group,
        row.donor_recency_bucket,
        row.opportunity_bucket,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [segmented, search, legacyMetric, params]);

  function downloadCsv() {
    const header = [
      "Contact Id",
      "Name",
      "Class Year",
      "Degree",
      "Major",
      "Donor Recency",
      "Assigned Solicitor Group",
      "Last Gift Date",
      "Life To Date Giving",
      "Year To Date Giving",
      "Touch Count 90",
      "Last Touch Date",
      "Opportunity Bucket",
    ];
    const lines = [
      header.join(","),
      ...filtered.map((row) =>
        [
          row.contact_id,
          csvValue(row.full_name),
          csvValue(detailClassYearLabel(row)),
          csvValue(row.degree || ""),
          csvValue(row.major || ""),
          csvValue(row.donor_recency_bucket || ""),
          csvValue(row.assigned_solicitor_group || ""),
          csvValue(row.last_gift_date || ""),
          csvValue(row.life_to_date_giving || ""),
          csvValue(row.year_to_date_giving || ""),
          csvValue(row.touch_count_90 || 0),
          csvValue(row.last_touch_date || ""),
          csvValue(row.opportunity_bucket || ""),
        ].join(","),
      ),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(effectiveSpec.title)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: "Iowan Old Style, Palatino, serif", fontSize: 32, margin: "0 0 8px" }}>
          {effectiveSpec.title}
        </h1>
        <p style={{ opacity: 0.75, margin: 0 }}>
          Alumni rows matching the selected segment from the coverage report.
        </p>
        {meta && (
          <p style={{ opacity: 0.65, fontSize: 13, marginTop: 8 }}>
            Generated {String(meta.generated_at_display || meta.generated_at || "—")}
          </p>
        )}
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search within segment…"
          style={{ padding: 8, width: "min(320px,100%)" }}
        />
        <span style={{ fontSize: 13, opacity: 0.75 }}>
          {filtered.length}
          {search ? ` matching search / ${segmented.length} in segment` : " alumni in segment"}
        </span>
        <button
          type="button"
          onClick={downloadCsv}
          style={{
            marginLeft: "auto",
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid #e5d9c6",
            background: "#8f2d1f",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Download CSV
        </button>
      </div>

      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}

      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th align="left">Name</th>
              <th align="left">Class</th>
              <th align="left">Degree</th>
              <th align="left">Major</th>
              <th align="left">Recency</th>
              <th align="left">Solicitor</th>
              <th align="left">Last gift</th>
              <th align="right">LTD</th>
              <th align="right">YTD</th>
              <th align="right">Touches 90</th>
              <th align="left">Last touch</th>
              <th align="left">Opportunity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i}>
                <td>{String(row.full_name || "")}</td>
                <td>{detailClassYearLabel(row)}</td>
                <td>{String(row.degree || "")}</td>
                <td>{String(row.major || "")}</td>
                <td>
                  <Pill tone={pillToneForRecency(String(row.donor_recency_bucket || ""))}>
                    {String(row.donor_recency_bucket || "")}
                  </Pill>
                </td>
                <td>{String(row.assigned_solicitor_group || "")}</td>
                <td>{formatDate(row.last_gift_date)}</td>
                <td align="right">{money.format(Number(row.life_to_date_giving || 0))}</td>
                <td align="right">{money.format(Number(row.year_to_date_giving || 0))}</td>
                <td align="right">{Number(row.touch_count_90 || 0)}</td>
                <td>{formatDate(row.last_touch_date)}</td>
                <td>
                  <Pill tone={pillToneForOpportunity(String(row.opportunity_bucket || ""))}>
                    {String(row.opportunity_bucket || "")}
                  </Pill>
                </td>
              </tr>
            ))}
            {!filtered.length && !error && (
              <tr>
                <td colSpan={12} style={{ padding: 24, opacity: 0.7 }}>
                  No rows match the current segment and search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export default function AlumniDrilldownPage() {
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
        <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
          <DrilldownInner />
        </Suspense>
      </div>
    </AccessGate>
  );
}
