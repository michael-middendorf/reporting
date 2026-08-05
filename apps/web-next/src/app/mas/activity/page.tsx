"use client";

import { useEffect, useState } from "react";
import { MasShell } from "../MasShell";
import { drilldownHref, loadMasJson } from "@/lib/reports/mas/load";

type EngagementRow = {
  ma_owner?: string;
  engagement_type?: string;
  count?: number;
};

export default function MasActivityPage() {
  const [rows, setRows] = useState<EngagementRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMasJson<{ by_ma?: EngagementRow[]; engagements?: EngagementRow[] } | EngagementRow[]>(
      "engagements.json",
    )
      .then((data) => {
        if (Array.isArray(data)) setRows(data);
        else setRows(data.by_ma || data.engagements || []);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <MasShell>
      <h1>Activity</h1>
      {error && <p>{error}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
        <thead>
          <tr>
            <th align="left">MA / Type</th>
            <th align="right">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const label = r.ma_owner || r.engagement_type || `Row ${i + 1}`;
            return (
              <tr key={`${label}-${i}`}>
                <td>
                  <a
                    href={drilldownHref({
                      title: label,
                      view: "engagements",
                      predicates: r.ma_owner
                        ? [{ kind: "eq", key: "ma_owner", value: r.ma_owner }]
                        : [{ kind: "eq", key: "engagement_type", value: r.engagement_type }],
                    })}
                  >
                    {label}
                  </a>
                </td>
                <td align="right">{r.count ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ marginTop: 12 }}>
        <a href="/api/reports/mas/exports/engagement_ledger.csv">Download ledger CSV</a>
      </p>
    </MasShell>
  );
}
