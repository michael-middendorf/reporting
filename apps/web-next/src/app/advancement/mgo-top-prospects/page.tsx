"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  shortStatus,
  usd,
  type MgoTopProspectsSnapshot,
  type ProspectPortfolio,
} from "@/lib/reports/mgo-top-prospects/shape";
import "@/styles/annunciation.css";
import "@/styles/advancement-overview.css";
import "@/styles/mgo-top-prospects.css";

export default function MgoTopProspectsPage() {
  const [data, setData] = useState<MgoTopProspectsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openDonor, setOpenDonor] = useState<string | null>(null);

  function load() {
    setLoading(true);
    apiFetch("/api/mgo-top-prospects-data")
      .then(async (r) => {
        const json = (await r.json()) as MgoTopProspectsSnapshot;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
        const next: Record<string, boolean> = {};
        for (const p of json.portfolios ?? []) next[p.name] = true;
        setOpen(next);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const portfolios = data?.portfolios ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return portfolios;
    return portfolios
      .map((p) => {
        const donors = p.donors.filter((d) =>
          [d.donorName, ...(d.statuses || []), ...d.asks.map((a) => a.assignedUser || "")]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        );
        const portHit = p.name.toLowerCase().includes(needle);
        if (!portHit && donors.length === 0) return null;
        if (portHit) return p;
        return { ...p, donors, donorCount: donors.length };
      })
      .filter((p): p is ProspectPortfolio => p != null);
  }, [portfolios, q]);

  function setAll(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const p of filtered) next[p.name] = value;
    setOpen(next);
  }

  return (
    <main className="ac-page ao-page mtp-page">
      <div className="ac-head">
        <div>
          <h1>{data?.fiscalYearLabel ?? "FY"} MGO Top Prospects</h1>
          <p className="ac-sub">
            Open gift asks expected to close this fiscal year, by MGO portfolio, with
            every donor named
            {data?.generated_at ? ` · updated ${data.generated_at}` : ""}.
          </p>
        </div>
        <button type="button" className="ac-refresh" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="ac-error">
          <p>{error}</p>
        </div>
      )}

      {!error && (
        <>
          <div className="ac-cards">
            <div className="ac-card">
              <span className="ac-card-num">{usd(summary?.askAmount)}</span>
              <span className="ac-card-label">Gift asks</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary?.donorCount ?? "—"}</span>
              <span className="ac-card-label">Named donors</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary?.askCount ?? "—"}</span>
              <span className="ac-card-label">Open asks</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary?.portfoliosWithAsks ?? "—"}</span>
              <span className="ac-card-label">Portfolios with asks</span>
            </div>
          </div>

          <p className="ac-note">{data?.definition}</p>

          <div className="ac-toolbar">
            <input
              className="ac-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search donors or portfolios"
            />
            <div className="mtp-filters">
              <button type="button" className="mtp-chip" onClick={() => setAll(true)}>
                Expand all
              </button>
              <button type="button" className="mtp-chip" onClick={() => setAll(false)}>
                Collapse all
              </button>
            </div>
            <span className="ac-count">
              {filtered.length} portfolio{filtered.length === 1 ? "" : "s"}
            </span>
          </div>

          <section className="ao-card">
            <header className="ao-panel-head">
              <h2>{data?.fiscalYearLabel ?? "FY"} MGO Top Prospects</h2>
              <p>Gift Asks</p>
            </header>
            <table className="mtp-table">
              <thead>
                <tr>
                  <th>Portfolio / Donor</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th className="ao-num">Gift Asks</th>
                </tr>
              </thead>
              <tbody>
                <tr className="mtp-totals">
                  <td>Subtotals</td>
                  <td />
                  <td />
                  <td className="ao-num">{usd(summary?.askAmount)}</td>
                </tr>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="ao-empty">
                      {loading ? "Loading…" : "No matching prospects."}
                    </td>
                  </tr>
                )}
                {filtered.map((p) => {
                  const isOpen = open[p.name] !== false;
                  return (
                    <Fragment key={p.name}>
                      <tr className="mtp-port">
                        <td>
                          <button
                            type="button"
                            className="mtp-toggle"
                            aria-expanded={isOpen}
                            onClick={() => setOpen((s) => ({ ...s, [p.name]: !isOpen }))}
                          >
                            {isOpen ? "▾" : "▸"} {p.name}
                          </button>
                          <span className="mtp-status">
                            {p.donorCount} donor{p.donorCount === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td />
                        <td />
                        <td className="ao-num">{usd(p.askAmount)}</td>
                      </tr>
                      {isOpen && p.donors.length === 0 && (
                        <tr className="mtp-empty-port">
                          <td colSpan={4}>No open FY asks in this portfolio.</td>
                        </tr>
                      )}
                      {isOpen &&
                        p.donors.map((d) => {
                          const donorKey = `${p.name}:${d.contactId ?? d.donorName}`;
                          const showAsks = openDonor === donorKey && d.asks.length > 1;
                          const first = d.asks[0];
                          return (
                            <Fragment key={donorKey}>
                              <tr className="mtp-donor">
                                <td>
                                  {d.contactUrl ? (
                                    <a href={d.contactUrl} target="_blank" rel="noopener noreferrer">
                                      {d.donorName || "—"}
                                    </a>
                                  ) : (
                                    d.donorName || "—"
                                  )}
                                  {d.asks.length > 1 && (
                                    <>
                                      {" "}
                                      <button
                                        type="button"
                                        className="mtp-expand"
                                        onClick={() =>
                                          setOpenDonor(showAsks ? null : donorKey)
                                        }
                                      >
                                        {showAsks ? "Hide asks" : `Show ${d.asks.length} asks`}
                                      </button>
                                    </>
                                  )}
                                </td>
                                <td className="mtp-status">
                                  {d.statuses.map(shortStatus).join(" · ") || "—"}
                                </td>
                                <td className="mtp-status">
                                  {d.asks.length === 1 ? first?.expectedFulfillmentDate || "—" : "—"}
                                </td>
                                <td className="ao-num">{usd(d.askAmount)}</td>
                              </tr>
                              {showAsks &&
                                d.asks.map((a) => (
                                  <tr key={a.id ?? `${donorKey}-${a.askDate}`} className="mtp-ask-rows">
                                    <td>
                                      {a.project || a.assignedUser || "Ask"}
                                      {a.assignedUser ? ` · ${a.assignedUser}` : ""}
                                    </td>
                                    <td>{shortStatus(a.status)}</td>
                                    <td>{a.expectedFulfillmentDate || "—"}</td>
                                    <td className="ao-num">{usd(a.amount)}</td>
                                  </tr>
                                ))}
                            </Fragment>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
