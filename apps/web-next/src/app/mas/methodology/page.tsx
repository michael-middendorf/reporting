"use client";

import { useEffect, useState } from "react";
import { MasShell } from "../MasShell";
import { loadMasJson } from "@/lib/reports/mas/load";

export default function MasMethodologyPage() {
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMasJson<Record<string, unknown>>("methodology.json")
      .then(setDoc)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <MasShell>
      <h1>Methodology</h1>
      {error && <p>{error}</p>}
      {doc && (
        <article style={{ maxWidth: "70ch", lineHeight: 1.6 }}>
          {Object.entries(doc).map(([k, v]) => (
            <section key={k} style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 18 }}>{k.replaceAll("_", " ")}</h2>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                {typeof v === "string" ? v : JSON.stringify(v, null, 2)}
              </pre>
            </section>
          ))}
        </article>
      )}
    </MasShell>
  );
}
