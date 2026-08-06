"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MasShell } from "../MasShell";
import { matchesPredicate } from "@/components/mas/charts";
import { loadMasJson, money } from "@/lib/reports/mas/load";

type Spec = {
  title?: string;
  view?: "engagements" | "contacts" | "donors" | string;
  predicates?: { kind: string; key: string; value: unknown }[];
};

const ENGAGEMENT_COLS = [
  "contact_name",
  "engagement_date",
  "ma_owner",
  "engagement_type",
  "engagement_bucket",
  "note_type",
  "note_snippet",
];
const CONTACT_COLS = [
  "contact_name",
  "latest_engagement_date",
  "ma_owner",
  "engagement_bucket",
  "donor_30",
  "donor_90",
  "donor_365",
  "total_gift_amount",
];
const DONOR_COLS = [
  "contact_name",
  "linked_ma_owner",
  "gift_count",
  "total_amount",
  "first_gift_date",
  "last_gift_date",
  "linked_engagement_type",
];

function buildDonorRows(
  rollups: Record<string, unknown>[],
  gifts: Record<string, unknown>[],
  predicates: Spec["predicates"],
) {
  const filtered = gifts.filter((row) =>
    (predicates || []).every((p) => matchesPredicate(row, p)),
  );
  const rollupsById = new Map(rollups.map((r) => [String(r.contact_id), r]));
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of filtered) {
    const key = String(row.contact_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  return [...grouped.entries()].map(([id, giftRows]) => {
    const rollup = rollupsById.get(id) || {};
    const amounts = giftRows.map((g) => Number(g.gift_amount || 0));
    const dates = giftRows.map((g) => String(g.gift_date || "")).filter(Boolean).sort();
    return {
      contact_id: id,
      contact_name: giftRows[0].contact_name || rollup.contact_name,
      linked_ma_owner: giftRows[0].linked_ma_owner,
      linked_engagement_type: giftRows[0].linked_engagement_type,
      gift_count: giftRows.length,
      total_amount: amounts.reduce((a, b) => a + b, 0),
      first_gift_date: dates[0] || "",
      last_gift_date: dates[dates.length - 1] || "",
    };
  });
}

function DrilldownInner() {
  const params = useSearchParams();
  const spec = useMemo(() => {
    try {
      return JSON.parse(params.get("spec") || "{}") as Spec;
    } catch {
      return {} as Spec;
    }
  }, [params]);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const view = spec.view || "engagements";

  useEffect(() => {
    const preds = spec.predicates || [];
    setError(null);
    if (view === "donors") {
      Promise.all([
        loadMasJson<unknown>("contact_rollup.json"),
        loadMasJson<unknown>("follow_on_gifts.json"),
      ])
        .then(([roll, gifts]) => {
          const rollups = Array.isArray(roll)
            ? roll
            : ((roll as { records?: unknown[] })?.records || []) as Record<string, unknown>[];
          const giftRows = Array.isArray(gifts)
            ? gifts
            : (((gifts as { follow_on_gifts?: unknown[] })?.follow_on_gifts ||
                (gifts as { recent?: unknown[] })?.recent ||
                []) as Record<string, unknown>[]);
          setRows(buildDonorRows(rollups, giftRows, preds));
        })
        .catch((e) => setError(String(e)));
      return;
    }

    const file = view === "contacts" ? "contact_rollup.json" : "engagements.json";
    loadMasJson<unknown>(file)
      .then((data) => {
        let list: Record<string, unknown>[] = [];
        if (Array.isArray(data)) list = data as Record<string, unknown>[];
        else if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          list = (obj.records ||
            obj.rows ||
            obj.engagements ||
            obj.contacts ||
            []) as Record<string, unknown>[];
        }
        if (preds.length) {
          list = list.filter((row) => preds.every((p) => matchesPredicate(row, p)));
        }
        setRows(list);
      })
      .catch((e) => setError(String(e)));
  }, [spec, view]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, search]);

  const cols =
    view === "donors"
      ? DONOR_COLS
      : view === "contacts"
        ? CONTACT_COLS
        : ENGAGEMENT_COLS;

  const visibleCols = cols.filter((c) => filtered.some((r) => r[c] != null && r[c] !== ""));

  return (
    <>
      <h1>{spec.title || "Drilldown"}</h1>
      <p style={{ opacity: 0.7 }}>
        View: {view} · {filtered.length.toLocaleString()} rows
      </p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search…"
        style={{ marginBottom: 12, padding: 8, width: "min(360px,100%)" }}
      />
      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {(visibleCols.length ? visibleCols : cols).map((c) => (
                <th key={c} align="left">
                  {c.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 1000).map((r, i) => (
              <tr key={i}>
                {(visibleCols.length ? visibleCols : cols).map((c) => {
                  const v = r[c];
                  const text =
                    c.includes("amount") || c.includes("dollars")
                      ? money(v as string | number)
                      : String(v ?? "");
                  return <td key={c}>{text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && !error && <p>No matching rows.</p>}
    </>
  );
}

export default function MasDrilldownPage() {
  return (
    <MasShell>
      <Suspense fallback={<p>Loading…</p>}>
        <DrilldownInner />
      </Suspense>
    </MasShell>
  );
}
