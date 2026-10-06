"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  fundingStatus,
  pct,
  usd,
  type StainedGlassGroup,
  type StainedGlassSnapshot,
  type StainedGlassWindow,
} from "@/lib/reports/stained-glass-windows/shape";
import "@/styles/annunciation.css";
import "@/styles/chapel-naming.css";
import "@/styles/stained-glass-windows.css";

type Filter = "all" | "funded" | "partial" | "unfunded" | "rose" | "sanctuary" | "nave";

function statusLabel(item: StainedGlassWindow): string {
  const s = fundingStatus(item);
  if (s === "funded") return "Funded";
  if (s === "partial") return "Partial";
  return "Unfunded";
}

export default function StainedGlassWindowsPage() {
  const [data, setData] = useState<StainedGlassSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  // Fetch only: state is set in the promise callbacks, so the mount effect never
  // sets state synchronously. `loading` already starts true for the first fetch.
  function fetchSnapshot() {
    apiFetch("/api/stained-glass-windows-data")
      .then(async (r) => {
        const json = (await r.json()) as StainedGlassSnapshot;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  function load() {
    setLoading(true);
    fetchSnapshot();
  }

  useEffect(fetchSnapshot, []);

  const groups = data?.groups ?? [];
  const summary = data?.summary;

  const filteredGroups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups
      .map((g) => {
        if (filter === "rose" || filter === "sanctuary" || filter === "nave") {
          if (g.id !== filter) return null;
        }
        let rows = g.windows.slice();
        if (filter === "funded" || filter === "partial" || filter === "unfunded") {
          rows = rows.filter((w) => fundingStatus(w) === filter);
        }
        if (needle) {
          rows = rows.filter((w) => {
            const hay = [
              w.item,
              w.groupLabel,
              ...w.gifts.map((gift) => gift.donorName || ""),
              ...w.gifts.map((gift) => gift.specifics || ""),
            ]
              .join(" ")
              .toLowerCase();
            return hay.includes(needle);
          });
        }
        if (rows.length === 0) return null;
        return { ...g, windows: rows };
      })
      .filter((g): g is StainedGlassGroup => g != null);
  }, [groups, q, filter]);

  const zone = (id: "rose" | "sanctuary" | "nave"): StainedGlassGroup | undefined =>
    groups.find((g) => g.id === id);

  return (
    <main className="ac-page">
      <div className="ac-head">
        <div>
          <h1>Stained Glass Windows</h1>
          <p className="ac-sub">
            Named student-chapel windows with every donor, from Virtuous
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
              <span className="ac-card-num">{usd(summary?.fundingRequest)}</span>
              <span className="ac-card-label">Naming ask</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{usd(summary?.amountReceived)}</span>
              <span className="ac-card-label">Amount received</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary ? pct(summary.pctReceived) : "—"}</span>
              <span className="ac-card-label">Received</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary?.fullyFunded ?? "—"}</span>
              <span className="ac-card-label">Windows funded</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary?.unfunded ?? "—"}</span>
              <span className="ac-card-label">Still available</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary?.donorCount ?? "—"}</span>
              <span className="ac-card-label">Donors</span>
            </div>
          </div>

          <div className="sg-zones">
            {(
              [
                ["rose", "Rose Window", zone("rose")],
                ["sanctuary", "Sanctuary · 12 windows", zone("sanctuary")],
                ["nave", "Nave · 26 windows", zone("nave")],
              ] as const
            ).map(([id, label, g]) => (
              <button
                key={id}
                type="button"
                className="sg-zone"
                aria-pressed={filter === id}
                onClick={() => setFilter((cur) => (cur === id ? "all" : id))}
              >
                <span className="sg-zone-kicker">{label}</span>
                <span className="sg-zone-amt">
                  {usd(g?.amountReceived)} / {usd(g?.fundingRequest)}
                </span>
                <span className="sg-zone-meta">
                  {g ? `${g.fullyFunded} funded · ${g.unfunded} available` : "—"}
                </span>
                <div className={`cn-bar is-${(g?.pctReceived ?? 0) >= 100 ? "funded" : g?.amountReceived ? "partial" : "unfunded"}`}>
                  <span style={{ width: `${Math.max(0, Math.min(100, g?.pctReceived ?? 0))}%` }} />
                </div>
              </button>
            ))}
          </div>

          <p className="ac-note">
            {data?.definition} Inventory is the named Virtuous field-4 list (not the
            lumped Chapel Naming quantity of 12, the picklist count of 16, or the
            marketing count of 14). Grouped small-window gifts with no specifics stay
            in Unspecified.
          </p>

          <div className="ac-toolbar">
            <input
              className="ac-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search windows or donors"
            />
            <div className="cn-filters">
              {(
                [
                  ["all", "All"],
                  ["funded", "Funded"],
                  ["partial", "Partial"],
                  ["unfunded", "Available"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="cn-chip"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="ac-count">
              {filteredGroups.reduce((n, g) => n + g.windows.length, 0)} window
              {filteredGroups.reduce((n, g) => n + g.windows.length, 0) === 1 ? "" : "s"}
            </span>
          </div>

          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>Window</th>
                  <th className="ac-num">Ask</th>
                  <th className="ac-num">Received</th>
                  <th className="ac-num">Remaining</th>
                  <th>% received</th>
                  <th className="ac-num">Gifts</th>
                  <th className="ac-num">Donors</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.length === 0 && (
                  <tr>
                    <td colSpan={7} className="ac-empty">
                      {loading ? "Loading…" : "No windows match."}
                    </td>
                  </tr>
                )}
                {filteredGroups.map((g) => (
                  <Fragment key={g.id}>
                    <tr className="sg-group-row">
                      <td colSpan={7}>
                        {g.label}
                        <span className="sg-group-meta">
                          {usd(g.amountReceived)} of {usd(g.fundingRequest)} · {g.fullyFunded} funded
                        </span>
                      </td>
                    </tr>
                    {g.windows.map((item) => {
                      const status = fundingStatus(item);
                      const isOpen = open === item.id;
                      const barPct = Math.max(0, Math.min(100, item.pctReceived ?? 0));
                      return (
                        <Fragment key={item.id}>
                          <tr>
                            <td>
                              <div className="cn-item-cell">
                                <strong>{item.item}</strong>
                                <span className={`cn-pill ${status}`}>{statusLabel(item)}</span>
                                {!item.fromInventory && (
                                  <span className="cn-pill extra">Not on inventory</span>
                                )}
                                {item.gifts.length > 0 && (
                                  <button
                                    type="button"
                                    className="cn-expand"
                                    onClick={() => setOpen(isOpen ? null : item.id)}
                                  >
                                    {isOpen ? "Hide gifts" : "Show gifts"}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="ac-num">{usd(item.itemAmount)}</td>
                            <td className="ac-num">{usd(item.amountReceived)}</td>
                            <td className="ac-num">{usd(item.remaining)}</td>
                            <td>
                              <div className={`cn-bar is-${status}`} title={pct(item.pctReceived)}>
                                <span style={{ width: `${barPct}%` }} />
                              </div>
                              <div className="ac-num">{pct(item.pctReceived)}</div>
                            </td>
                            <td className="ac-num">{item.giftCount}</td>
                            <td className="ac-num">{item.donorCount}</td>
                          </tr>
                          {isOpen && (
                            <tr className="cn-gifts">
                              <td colSpan={7}>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Donor</th>
                                      <th>Gift date</th>
                                      <th>Project</th>
                                      <th>Specifics</th>
                                      <th>Gift ID</th>
                                      <th className="ac-num">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.gifts.map((gift) => (
                                      <tr key={gift.id ?? `${gift.contactId}-${gift.giftDate}`}>
                                        <td>
                                          {gift.contactUrl ? (
                                            <a
                                              href={gift.contactUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                            >
                                              {gift.donorName || "—"}
                                            </a>
                                          ) : (
                                            gift.donorName || "—"
                                          )}
                                        </td>
                                        <td>{gift.giftDate || "—"}</td>
                                        <td>{gift.project || "—"}</td>
                                        <td>{gift.specifics || "—"}</td>
                                        <td>{gift.id ?? "—"}</td>
                                        <td className="ac-num">{usd(gift.amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
