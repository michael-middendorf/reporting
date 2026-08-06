"use client";

import { useEffect, useMemo, useState } from "react";
import { MasShell } from "../MasShell";
import { drilldownHref, loadMasJson, money, type FollowOnGift } from "@/lib/reports/mas/load";

type GiftRow = FollowOnGift & {
  gift_id?: number;
  in_window_30?: boolean;
  in_window_90?: boolean;
  in_window_365?: boolean;
  days_from_engagement?: number;
  linked_engagement_bucket?: string;
  project_name?: string;
  project_code?: string;
};

function dedupeGifts(rows: GiftRow[]) {
  const byGift = new Map<number | string, GiftRow>();
  for (const row of rows) {
    const id = row.gift_id ?? `${row.contact_id}-${row.gift_date}-${row.gift_amount}`;
    const existing = byGift.get(id);
    if (!existing) {
      byGift.set(id, row);
      continue;
    }
    const existingTwoWay = existing.linked_engagement_bucket === "Two-way engagement";
    const currentTwoWay = row.linked_engagement_bucket === "Two-way engagement";
    if (currentTwoWay && !existingTwoWay) {
      byGift.set(id, row);
      continue;
    }
    if (
      currentTwoWay === existingTwoWay &&
      Number(row.days_from_engagement ?? 9999) < Number(existing.days_from_engagement ?? 9999)
    ) {
      byGift.set(id, row);
    }
  }
  return [...byGift.values()].sort((a, b) =>
    String(b.gift_date || "").localeCompare(String(a.gift_date || "")),
  );
}

export default function MasGiftsPage() {
  const [rows, setRows] = useState<GiftRow[]>([]);
  const [windowDays, setWindowDays] = useState<"30" | "90" | "365">("30");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMasJson<GiftRow[] | { recent?: GiftRow[]; follow_on_gifts?: GiftRow[] }>(
      "follow_on_gifts.json",
    )
      .then((data) => {
        const list = Array.isArray(data) ? data : data.recent || data.follow_on_gifts || [];
        setRows(dedupeGifts(list));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!row[`in_window_${windowDays}` as keyof GiftRow]) return false;
      if (!q) return true;
      const hay = [
        row.contact_name,
        row.linked_ma_owner,
        row.linked_engagement_type,
        row.segment,
        row.project_name,
        row.project_code,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, windowDays, search]);

  return (
    <MasShell>
      <h1>Follow-on gifts</h1>
      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <label>
          Window{" "}
          <select value={windowDays} onChange={(e) => setWindowDays(e.target.value as "30" | "90" | "365")}>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">365 days</option>
          </select>
        </label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search donor, owner, type…"
          style={{ padding: 8, minWidth: 240 }}
        />
        <span style={{ opacity: 0.7 }}>{filtered.length} gifts</span>
      </div>
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th align="left">Donor</th>
              <th align="left">Date</th>
              <th align="right">Amount</th>
              <th align="left">MA</th>
              <th align="left">Engagement</th>
              <th align="right">Days</th>
              <th align="left">Segment</th>
              <th align="left">Project</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={`${r.gift_id}-${i}`}>
                <td>
                  <a
                    href={drilldownHref({
                      title: r.contact_name,
                      view: "contacts",
                      predicates: [{ kind: "eq", key: "contact_id", value: r.contact_id }],
                    })}
                  >
                    {r.contact_name || "—"}
                  </a>
                </td>
                <td>{r.gift_date || "—"}</td>
                <td align="right">{money(r.gift_amount)}</td>
                <td>{r.linked_ma_owner || "—"}</td>
                <td>{r.linked_engagement_type || "—"}</td>
                <td align="right">{r.days_from_engagement ?? "—"}</td>
                <td>{r.segment || "—"}</td>
                <td>{r.project_name || r.project_code || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && !error && <p>No gifts match the current window and search.</p>}
      <p style={{ marginTop: 12 }}>
        <a href="/api/reports/mas/exports/recent_follow_on_gifts.csv">Download CSV</a>
      </p>
    </MasShell>
  );
}
