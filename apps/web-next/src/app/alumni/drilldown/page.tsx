"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import "@/styles/alumni.css";

function DrilldownInner() {
  const params = useSearchParams();
  const metric = params.get("metric") || "";
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/reports/alumni/detail_index.json")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.records || data.rows || [];
        setRows(list);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const filtered = useMemo(() => {
    if (!metric) return rows.slice(0, 200);
    const key = metric.toLowerCase();
    return rows
      .filter((r) => JSON.stringify(r).toLowerCase().includes(key))
      .slice(0, 200);
  }, [rows, metric]);

  const cols = filtered[0] ? Object.keys(filtered[0]).slice(0, 8) : [];

  return (
    <main style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
      <h1>Alumni drilldown</h1>
      <p style={{ opacity: 0.75 }}>Metric filter: {metric || "all"}</p>
      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} align="left">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c}>{String(r[c] ?? "")}</td>
                ))}
              </tr>
            ))}
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
