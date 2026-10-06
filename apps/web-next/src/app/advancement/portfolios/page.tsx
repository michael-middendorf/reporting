"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  formatMdDate,
  relationshipLabel,
  sortDonors,
  type PortfolioDonor,
  type PortfolioSolicitor,
  type PortfoliosSnapshot,
} from "@/lib/reports/portfolios/shape";
import "@/styles/portfolios.css";

type Row = PortfolioDonor & { solicitorName: string; solicitorId: string };

const ALL_MGO = "all-mgo";
const ALL_MA = "all-ma";

function selectedSolicitors(data: PortfoliosSnapshot | null, key: string): PortfolioSolicitor[] {
  const all = data?.solicitors ?? [];
  if (key === ALL_MGO) return all.filter((s) => s.team === "mgo");
  if (key === ALL_MA) return all.filter((s) => s.team === "ma");
  const one = all.filter((s) => s.id === key);
  return one.length ? one : all;
}

export default function PortfoliosPage() {
  const [data, setData] = useState<PortfoliosSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [solicitorKey, setSolicitorKey] = useState("");
  const [stageKey, setStageKey] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Fetch only: state is set in the promise callbacks, so the mount effect never
  // sets state synchronously. `loading` already starts true for the first fetch.
  function fetchSnapshot() {
    apiFetch("/api/portfolios-data")
      .then(async (r) => {
        const json = (await r.json()) as PortfoliosSnapshot;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
        const nextKey = json.viewer?.defaultSolicitorId || json.solicitors[0]?.id || "";
        setSolicitorKey(nextKey);
        const nextOpen: Record<string, boolean> = {};
        for (const s of json.solicitors) {
          for (const st of s.stages) nextOpen[st.key] = true;
        }
        setOpen(nextOpen);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  function load() {
    setLoading(true);
    fetchSnapshot();
  }

  useEffect(fetchSnapshot, []);

  const solicitors = data?.solicitors ?? [];
  const mgo = solicitors.filter((s) => s.team === "mgo");
  const ma = solicitors.filter((s) => s.team === "ma");
  const showSelector = solicitors.length > 1;
  const canAllMgo = Boolean(data?.viewer?.canSelectMgo && mgo.length > 1);
  const canAllMa = Boolean(data?.viewer?.canSelectMa && ma.length > 1);

  const chosen = useMemo(
    () => selectedSolicitors(data, solicitorKey || solicitors[0]?.id || ""),
    [data, solicitorKey, solicitors],
  );
  const showSolicitorCol = chosen.length > 1;

  const stages = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; donors: Row[] }>();
    for (const s of chosen) {
      for (const st of s.stages) {
        let bucket = byKey.get(st.key);
        if (!bucket) {
          bucket = { key: st.key, label: st.label, donors: [] };
          byKey.set(st.key, bucket);
        }
        for (const d of st.donors) {
          bucket.donors.push({ ...d, solicitorName: s.name, solicitorId: s.id });
        }
      }
    }
    return [...byKey.values()].map((st) => ({
      ...st,
      donors: sortDonors(st.donors),
    }));
  }, [chosen]);

  const filteredStages = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stages
      .filter((st) => stageKey === "all" || st.key === stageKey)
      .map((st) => {
        const donors = needle
          ? st.donors.filter((d) => (d.donorName || "").toLowerCase().includes(needle))
          : st.donors;
        return { ...st, donors };
      })
      .filter((st) => st.donors.length > 0 || stageKey === st.key);
  }, [stages, stageKey, q]);

  const allDonors = stages.flatMap((st) => st.donors);
  const untaggedCount = stages.find((st) => st.key === "untagged")?.donors.length ?? 0;
  const missingActivity = allDonors.filter((d) => !d.lastActivityDate).length;

  return (
    <main className="pf-page">
      <div className="pf-head">
        <div>
          <h1>Portfolios</h1>
          <p className="pf-sub">
            Pipeline stages for each officer&apos;s book
            {data?.generated_at ? ` · updated ${data.generated_at}` : ""}.
          </p>
        </div>
        <button type="button" className="pf-refresh" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="pf-error">
          <p>{error}</p>
        </div>
      )}

      {!error && (
        <>
          <div className="pf-cards">
            <div className="pf-card">
              <span className="pf-card-num">{allDonors.length}</span>
              <span className="pf-card-label">Donors</span>
            </div>
            <div className="pf-card">
              <span className="pf-card-num">{untaggedCount}</span>
              <span className="pf-card-label">Untagged</span>
            </div>
            <div className="pf-card">
              <span className="pf-card-num">{missingActivity}</span>
              <span className="pf-card-label">Missing last activity</span>
            </div>
          </div>

          <div className="pf-toolbar">
            {showSelector && (
              <div className="pf-selects">
                <select
                  id="pf-solicitor"
                  className="pf-select"
                  aria-label="Person or team"
                  value={solicitorKey}
                  onChange={(e) => {
                    setSolicitorKey(e.target.value);
                    setStageKey("all");
                  }}
                >
                  {canAllMgo && <option value={ALL_MGO}>All MGO</option>}
                  {canAllMa && <option value={ALL_MA}>All MA</option>}
                  {mgo.length > 0 && (
                    <optgroup label="MGO">
                      {mgo.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {ma.length > 0 && (
                    <optgroup label="MA">
                      {ma.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
            <select
              className="pf-select"
              value={stageKey}
              onChange={(e) => setStageKey(e.target.value)}
              aria-label="Stage"
            >
              <option value="all">All stages</option>
              {stages.map((st) => (
                <option key={st.key} value={st.key}>
                  {st.label}
                </option>
              ))}
            </select>
            <input
              className="pf-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search donor name"
            />
            <span className="pf-count">
              {filteredStages.reduce((n, st) => n + st.donors.length, 0)} donor
              {filteredStages.reduce((n, st) => n + st.donors.length, 0) === 1 ? "" : "s"}
            </span>
          </div>

          {filteredStages.length === 0 && (
            <section className="pf-panel">
              <p className="pf-empty">{loading ? "Loading…" : "No matching donors."}</p>
            </section>
          )}

          {filteredStages.map((st) => {
            const isOpen = open[st.key] !== false;
            const cols = showSolicitorCol ? 5 : 4;
            return (
              <section key={st.key} className="pf-panel">
                <header className="pf-stage-head">
                  <button
                    type="button"
                    className="pf-toggle"
                    aria-expanded={isOpen}
                    onClick={() => setOpen((s) => ({ ...s, [st.key]: !isOpen }))}
                  >
                    {isOpen ? "▾" : "▸"} {st.label}
                  </button>
                  <span className="pf-stage-count">
                    {st.donors.length} donor{st.donors.length === 1 ? "" : "s"}
                  </span>
                </header>
                {isOpen && (
                  <div className="pf-table-wrap">
                    <table className="pf-table">
                      <thead>
                        <tr>
                          <th>Donor</th>
                          {showSolicitorCol && <th>Solicitor</th>}
                          <th>Relationship</th>
                          <th>Last gift</th>
                          <th>Last activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {st.donors.length === 0 && (
                          <tr>
                            <td colSpan={cols} className="pf-empty">
                              No donors in this stage.
                            </td>
                          </tr>
                        )}
                        {st.donors.map((d) => (
                          <tr key={`${d.solicitorId}:${d.contactId ?? d.donorName}`}>
                            <td>
                              {d.contactUrl ? (
                                <a href={d.contactUrl} target="_blank" rel="noopener noreferrer">
                                  {d.donorName || "-"}
                                </a>
                              ) : (
                                d.donorName || "-"
                              )}
                            </td>
                            {showSolicitorCol && <td>{d.solicitorName}</td>}
                            <td className="pf-rel">{relationshipLabel(d.relationship)}</td>
                            <td className="pf-date">{formatMdDate(d.lastGiftDate)}</td>
                            <td className="pf-date">{formatMdDate(d.lastActivityDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
