"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MasShell } from "../MasShell";
import { loadMasJson } from "@/lib/reports/mas/load";

type Spec = {
  title?: string;
  view?: string;
  predicates?: { kind: string; key: string; value: unknown }[];
};

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const file =
      spec.view === "contacts" ? "contact_rollup.json" : "engagements.json";
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
        const preds = spec.predicates || [];
        if (preds.length) {
          list = list.filter((row) =>
            preds.every((p) => {
              if (p.kind === "eq") return row[p.key] === p.value;
              return true;
            }),
          );
        }
        setRows(list.slice(0, 500));
      })
      .catch((e) => setError(String(e)));
  }, [spec]);

  const cols = rows[0] ? Object.keys(rows[0]).slice(0, 8) : [];

  return (
    <>
      <h1>{spec.title || "Drilldown"}</h1>
      <p style={{ opacity: 0.7 }}>View: {spec.view || "engagements"}</p>
      {error && <p>{error}</p>}
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12 }}>
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
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c}>{String(r[c] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && !error && <p>No matching rows.</p>}
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
