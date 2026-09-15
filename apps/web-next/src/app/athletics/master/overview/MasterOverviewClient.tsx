"use client";

import { useState } from "react";
import { MasterOverviewSheet } from "@/components/athletics/MasterOverviewSheet";
import type { SportDef } from "@/lib/reports/athletics-coaching/sports";

export function MasterOverviewClient({
  sports,
  initialSport,
}: {
  sports: SportDef[];
  initialSport: string;
}) {
  const [sportKey, setSportKey] = useState(initialSport);
  const selected = sports.find((sport) => sport.key === sportKey) || sports[0];
  if (!selected) {
    return (
      <main className="ath-page">
        <p className="ath-empty">No teams are assigned to this account yet.</p>
      </main>
    );
  }
  return (
    <main className="ath-page">
      <div className="ath-page-heading">
        <div>
          <p className="ath-kicker">Athletics</p>
          <h1>Overview</h1>
        </div>
        {sports.length > 1 ? (
          <label className="ath-overview-sport">
            Sport
            <select value={selected.key} onChange={(event) => setSportKey(event.target.value)}>
              {sports.map((sport) => (
                <option key={sport.key} value={sport.key}>
                  {sport.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="ath-overview-sport-name">{selected.label}</p>
        )}
      </div>
      <MasterOverviewSheet sportKey={selected.key} />
    </main>
  );
}
