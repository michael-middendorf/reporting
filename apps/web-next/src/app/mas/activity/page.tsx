"use client";

import { useEffect, useMemo, useState } from "react";
import { MasShell } from "../MasShell";
import {
  drilldownHref,
  loadMasJson,
  type Engagement,
} from "@/lib/reports/mas/load";

export default function MasActivityPage() {
  const [rows, setRows] = useState<Engagement[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMasJson<Engagement[] | { engagements?: Engagement[]; by_ma?: Engagement[] }>(
      "engagements.json",
    )
      .then((data) => {
        if (Array.isArray(data)) setRows(data);
        else setRows(data.engagements || data.by_ma || []);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const byMa = useMemo(() => {
    const map = new Map<string, { outreach: number; types: Record<string, number> }>();
    for (const r of rows) {
      const owner = r.ma_owner || "Unassigned";
      const cur = map.get(owner) || { outreach: 0, types: {} };
      cur.outreach += 1;
      const t = r.engagement_type || "Other";
      cur.types[t] = (cur.types[t] || 0) + 1;
      map.set(owner, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].outreach - a[1].outreach);
  }, [rows]);

  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const t = r.engagement_type || "Other";
      map.set(t, (map.get(t) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <MasShell>
      <h1>Activity</h1>
      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}
      <p style={{ opacity: 0.75 }}>{rows.length.toLocaleString()} engagements</p>

      <h2>By MA</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", marginBottom: 24 }}>
        <thead>
          <tr>
            <th align="left">MA</th>
            <th align="right">Engagements</th>
          </tr>
        </thead>
        <tbody>
          {byMa.map(([owner, v]) => (
            <tr key={owner}>
              <td>
                <a
                  href={drilldownHref({
                    title: owner,
                    view: "engagements",
                    predicates: [{ kind: "eq", key: "ma_owner", value: owner }],
                  })}
                >
                  {owner}
                </a>
              </td>
              <td align="right">{v.outreach}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>By type</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
        <thead>
          <tr>
            <th align="left">Type</th>
            <th align="right">Count</th>
          </tr>
        </thead>
        <tbody>
          {byType.map(([type, count]) => (
            <tr key={type}>
              <td>
                <a
                  href={drilldownHref({
                    title: type,
                    view: "engagements",
                    predicates: [{ kind: "eq", key: "engagement_type", value: type }],
                  })}
                >
                  {type}
                </a>
              </td>
              <td align="right">{count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 12 }}>
        <a href="/api/reports/mas/exports/engagement_ledger.csv">Download ledger CSV</a>
      </p>
    </MasShell>
  );
}
