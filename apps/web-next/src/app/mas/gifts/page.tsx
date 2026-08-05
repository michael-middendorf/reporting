"use client";

import { useEffect, useState } from "react";
import { MasShell, money } from "../MasShell";
import { drilldownHref, loadMasJson } from "@/lib/reports/mas/load";

type GiftRow = {
  contact_name?: string;
  contact_id?: string;
  amount?: number;
  gift_date?: string;
  ma_owner?: string;
};

export default function MasGiftsPage() {
  const [rows, setRows] = useState<GiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMasJson<{ recent?: GiftRow[]; follow_on_gifts?: GiftRow[] } | GiftRow[]>(
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
      {error && <p>{error}</p>}
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Contact</th>
              <th align="left">MA</th>
              <th align="left">Date</th>
              <th align="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.contact_id}-${i}`}>
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
                <td>{r.ma_owner || "—"}</td>
                <td>{r.gift_date || "—"}</td>
                <td align="right">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 12 }}>
        <a href="/api/reports/mas/exports/recent_follow_on_gifts.csv">Download CSV</a>
      </p>
    </MasShell>
  );
}
