"use client";

import { useEffect, useState } from "react";
import { MasShell } from "../MasShell";
import {
  drilldownHref,
  loadMasJson,
  money,
  type FollowOnGift,
} from "@/lib/reports/mas/load";

export default function MasGiftsPage() {
  const [rows, setRows] = useState<FollowOnGift[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMasJson<FollowOnGift[] | { recent?: FollowOnGift[]; follow_on_gifts?: FollowOnGift[] }>(
      "follow_on_gifts.json",
    )
      .then((data) => {
        if (Array.isArray(data)) setRows(data);
        else setRows(data.recent || data.follow_on_gifts || []);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <MasShell>
      <h1>Follow-on gifts</h1>
      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Contact</th>
              <th align="left">MA</th>
              <th align="left">Date</th>
              <th align="left">Type</th>
              <th align="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
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
                <td>{r.linked_ma_owner || "—"}</td>
                <td>{r.gift_date || "—"}</td>
                <td>{r.linked_engagement_type || r.segment || "—"}</td>
                <td align="right">{money(r.gift_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && !error && <p>No follow-on gifts found.</p>}
      <p style={{ marginTop: 12 }}>
        <a href="/api/reports/mas/exports/recent_follow_on_gifts.csv">Download CSV</a>
      </p>
    </MasShell>
  );
}
