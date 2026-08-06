"use client";

import { useEffect, useState } from "react";
import { MasShell } from "../MasShell";
import { loadMasJson } from "@/lib/reports/mas/load";

type Methodology = {
  source_of_truth?: string[] | string;
  windows?: Record<string, unknown>;
  scoped_owners?: { name?: string; identity?: string }[] | string[];
  caveats?: string[] | string;
  recurring_gift_notes?: string | Record<string, unknown>;
  type_definitions?: {
    two_way?: string[];
    one_way?: string[];
    failed?: string[];
  };
  query_option_smoke_checks?: { endpoint?: string; status?: string; notes?: string }[];
  [key: string]: unknown;
};

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split("\n").filter(Boolean);
  return [];
}

export default function MasMethodologyPage() {
  const [doc, setDoc] = useState<Methodology | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMasJson<Methodology>("methodology.json")
      .then(setDoc)
      .catch((e) => setError(String(e)));
  }, []);

  const owners = Array.isArray(doc?.scoped_owners) ? doc!.scoped_owners! : [];
  const smoke = Array.isArray(doc?.query_option_smoke_checks)
    ? doc!.query_option_smoke_checks!
    : [];
  const types = doc?.type_definitions || {};

  return (
    <MasShell>
      <h1>Methodology</h1>
      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}
      {!doc && !error && <p>Loading…</p>}
      {doc && (
        <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
          <section className="panel" style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e0d4c0" }}>
            <h2>Source of truth</h2>
            <ul>
              {asList(doc.source_of_truth).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          <section style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e0d4c0" }}>
            <h2>Windows</h2>
            <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8 }}>
              {Object.entries(doc.windows || {}).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt style={{ fontWeight: 600 }}>{k.replaceAll("_", " ")}</dt>
                  <dd style={{ margin: 0 }}>
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e0d4c0" }}>
            <h2>Scoped owners</h2>
            <ul>
              {owners.map((o, i) => {
                if (typeof o === "string") return <li key={i}>{o}</li>;
                return (
                  <li key={i}>
                    {o.name || "—"}
                    {o.identity ? ` · ${o.identity}` : ""}
                  </li>
                );
              })}
            </ul>
          </section>

          <section style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e0d4c0" }}>
            <h2>Type definitions</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
              {(
                [
                  ["Two-way", types.two_way],
                  ["One-way", types.one_way],
                  ["Failed", types.failed],
                ] as const
              ).map(([title, list]) => (
                <div key={title}>
                  <h3 style={{ fontSize: 14 }}>{title}</h3>
                  <ul>
                    {(list || []).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e0d4c0" }}>
            <h2>Caveats</h2>
            <ul>
              {asList(doc.caveats).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {doc.recurring_gift_notes && (
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13 }}>
                {typeof doc.recurring_gift_notes === "string"
                  ? doc.recurring_gift_notes
                  : JSON.stringify(doc.recurring_gift_notes, null, 2)}
              </pre>
            )}
          </section>

          {!!smoke.length && (
            <section style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e0d4c0" }}>
              <h2>Query smoke checks</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Endpoint</th>
                    <th align="left">Status</th>
                    <th align="left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {smoke.map((row, i) => (
                    <tr key={i}>
                      <td>{row.endpoint || "—"}</td>
                      <td>{row.status || "—"}</td>
                      <td>{row.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </MasShell>
  );
}
