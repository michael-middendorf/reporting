"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  fundingStatus,
  pct,
  usd,
  type ChapelNamingItem,
  type ChapelNamingSnapshot,
} from "@/lib/reports/chapel-naming/shape";
import "@/styles/annunciation.css";
import "@/styles/chapel-naming.css";

type Filter = "all" | "funded" | "partial" | "unfunded" | "endowment";
type SortKey =
  | "item"
  | "itemAmount"
  | "quantity"
  | "fundingRequest"
  | "amountReceived"
  | "pctReceived"
  | "giftCount"
  | "donorCount";

function statusLabel(item: ChapelNamingItem): string {
  const s = fundingStatus(item);
  if (s === "funded") return "Funded";
  if (s === "partial") return "Partial";
  return "Unfunded";
}

export default function ChapelNamingPage() {
  const [data, setData] = useState<ChapelNamingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("item");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [open, setOpen] = useState<string | null>(null);

  // Fetch only: state is set in the promise callbacks, so the mount effect never
  // sets state synchronously. `loading` already starts true for the first fetch.
  function fetchSnapshot() {
    apiFetch("/api/chapel-naming-data")
      .then(async (r) => {
        const json = (await r.json()) as ChapelNamingSnapshot;
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

  const items = data?.items ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = items.slice();
    if (filter === "endowment") rows = rows.filter((i) => i.type === "Endowment");
    else if (filter !== "all") rows = rows.filter((i) => fundingStatus(i) === filter);
    if (needle) {
      rows = rows.filter((i) => {
        const hay = [
          i.item,
          i.type,
          ...i.gifts.map((g) => g.donorName || ""),
          ...i.gifts.map((g) => g.specifics || ""),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "item") {
        return (a.item || "").localeCompare(b.item || "") * dir;
      }
      const an = typeof av === "number" ? av : -1;
      const bn = typeof bv === "number" ? bv : -1;
      if (an < bn) return -1 * dir;
      if (an > bn) return 1 * dir;
      return 0;
    });
    return rows;
  }, [items, q, filter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "item" ? "asc" : "desc");
    }
  }

  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <main className="ac-page">
      <div className="ac-head">
        <div>
          <h1>Chapel Naming Opportunities</h1>
          <p className="ac-sub">
            Student chapel naming catalog with gifts received from Virtuous
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
              <span className="ac-card-label">Funding request</span>
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
              <span className="ac-card-label">Fully funded items</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary?.giftCount ?? "—"}</span>
              <span className="ac-card-label">Gifts</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{summary?.donorCount ?? "—"}</span>
              <span className="ac-card-label">Donors</span>
            </div>
          </div>

          <p className="ac-note">
            Amount received counts Virtuous gifts tagged with the Naming Opportunity field and
            designated to AMU Student Chapel or Mary, Mother of the Eucharist Chapel. Catalog
            quantities and ask amounts come from the Advancement naming list (same source as the
            Qlik sheet). Items not on that list still appear if they have tagged gifts.
            DAF/passthrough gifts use the legal contact for the donor count, matching Qlik.
          </p>

          <div className="ac-toolbar">
            <input
              className="ac-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search items or donors"
            />
            <div className="cn-filters">
              {(
                [
                  ["all", "All"],
                  ["funded", "Funded"],
                  ["partial", "Partial"],
                  ["unfunded", "Unfunded"],
                  ["endowment", "Endowment"],
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
              {filtered.length} item{filtered.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort("item")}>Item{arrow("item")}</th>
                  <th onClick={() => toggleSort("itemAmount")} className="ac-num">
                    Item amount{arrow("itemAmount")}
                  </th>
                  <th onClick={() => toggleSort("quantity")} className="ac-num">
                    Qty{arrow("quantity")}
                  </th>
                  <th onClick={() => toggleSort("fundingRequest")} className="ac-num">
                    Funding request{arrow("fundingRequest")}
                  </th>
                  <th onClick={() => toggleSort("amountReceived")} className="ac-num">
                    Amount received{arrow("amountReceived")}
                  </th>
                  <th onClick={() => toggleSort("pctReceived")}>
                    % received{arrow("pctReceived")}
                  </th>
                  <th onClick={() => toggleSort("giftCount")} className="ac-num">
                    Gifts{arrow("giftCount")}
                  </th>
                  <th onClick={() => toggleSort("donorCount")} className="ac-num">
                    Donors{arrow("donorCount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="ac-empty">
                      {loading ? "Loading…" : "No naming opportunities match."}
                    </td>
                  </tr>
                )}
                {filtered.map((item) => {
                  const status = fundingStatus(item);
                  const isOpen = open === item.chapelObject;
                  const barPct = Math.max(0, Math.min(100, item.pctReceived ?? 0));
                  return (
                    <Fragment key={item.chapelObject}>
                      <tr>
                        <td>
                          <div className="cn-item-cell">
                            <strong>{item.item}</strong>
                            <span className={`cn-pill ${status}`}>{statusLabel(item)}</span>
                            {!item.fromCatalog && <span className="cn-pill extra">Not on catalog</span>}
                            {item.type === "Endowment" && (
                              <span className="cn-pill extra">Endowment</span>
                            )}
                            {item.gifts.length > 0 && (
                              <button
                                type="button"
                                className="cn-expand"
                                onClick={() =>
                                  setOpen(isOpen ? null : item.chapelObject)
                                }
                              >
                                {isOpen ? "Hide gifts" : "Show gifts"}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="ac-num">{usd(item.itemAmount)}</td>
                        <td className="ac-num">{item.quantity ?? "—"}</td>
                        <td className="ac-num">{usd(item.fundingRequest)}</td>
                        <td className="ac-num">{usd(item.amountReceived)}</td>
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
                        <tr className="cn-gifts" key={`${item.chapelObject}-gifts`}>
                          <td colSpan={8}>
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
                                {item.gifts.map((g) => (
                                  <tr key={g.id ?? `${g.contactId}-${g.giftDate}`}>
                                    <td>{g.donorName || "—"}</td>
                                    <td>{g.giftDate || "—"}</td>
                                    <td>{g.project || "—"}</td>
                                    <td>{g.specifics || "—"}</td>
                                    <td>{g.id ?? "—"}</td>
                                    <td className="ac-num">{usd(g.amount)}</td>
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
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
