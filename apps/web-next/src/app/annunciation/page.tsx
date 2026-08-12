"use client";

import { useEffect, useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import {
  formatRecurring,
  memberSince,
  recentlyJoined,
  type AnnunciationMember,
  type AnnunciationSnapshot,
} from "@/lib/reports/annunciation/shape";
import "@/styles/annunciation.css";

type Payload = Partial<AnnunciationSnapshot> & { error?: string };

type SortKey =
  | "name"
  | "email"
  | "location"
  | "lifeToDateGivingNum"
  | "recurringAmount"
  | "lastGiftDate"
  | "startDate";

const money = (v: string | null) => v || "—";
const dash = (v: string | null) => v || "—";

function parseUsDate(v: string | null): number {
  if (!v) return 0;
  // Virtuous returns M/D/YYYY for gift dates; firstSeen is ISO YYYY-MM-DD.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = iso ? new Date(`${v}T00:00:00Z`) : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

function AnnunciationInner() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function load() {
    setLoading(true);
    apiFetch("/api/annunciation-data")
      .then(async (r) => {
        const json = (await r.json()) as Payload;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
      })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const members = useMemo(() => data?.members ?? [], [data]);

  const recent30 = useMemo(() => recentlyJoined(members, 30), [members]);
  const recent90 = useMemo(() => recentlyJoined(members, 90), [members]);
  const totalLtd = useMemo(
    () => members.reduce((s, m) => s + (m.lifeToDateGivingNum || 0), 0),
    [members],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? members.filter((m) =>
          [m.name, m.email, m.location, m.phone]
            .filter(Boolean)
            .some((f) => (f as string).toLowerCase().includes(needle)),
        )
      : members.slice();

    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let av: number | string = "";
      let bv: number | string = "";
      if (sortKey === "lifeToDateGivingNum") {
        av = a.lifeToDateGivingNum || 0;
        bv = b.lifeToDateGivingNum || 0;
      } else if (sortKey === "recurringAmount") {
        av = a.recurringAmount || 0;
        bv = b.recurringAmount || 0;
      } else if (sortKey === "startDate") {
        av = parseUsDate(memberSince(a));
        bv = parseUsDate(memberSince(b));
      } else if (sortKey === "lastGiftDate") {
        av = parseUsDate(a[sortKey]);
        bv = parseUsDate(b[sortKey]);
      } else {
        av = (a[sortKey] || "").toString().toLowerCase();
        bv = (b[sortKey] || "").toString().toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [members, q, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const numericOrDate =
        key === "lifeToDateGivingNum" ||
        key === "recurringAmount" ||
        key === "startDate";
      setSortDir(numericOrDate ? "desc" : "asc");
    }
  }

  const sortArrow = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <main className="ac-page">
      <div className="ac-head">
        <div>
          <h1>Annunciation Circle</h1>
          <p className="ac-sub">
            Current members and new-member activity, sourced from Virtuous.
            {data?.generated_at ? ` Updated ${data.generated_at}.` : ""}
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
              <span className="ac-card-num">{members.length}</span>
              <span className="ac-card-label">Current members</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{recent30.length}</span>
              <span className="ac-card-label">Joined in last 30 days</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{recent90.length}</span>
              <span className="ac-card-label">Joined in last 90 days</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">
                ${totalLtd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
              <span className="ac-card-label">Combined lifetime giving</span>
            </div>
          </div>

          {data?.baseline && (
            <p className="ac-note">
              Initial snapshot — automatic email alerts for new members begin from the next
              refresh onward. “Member since” dates below are real recurring-gift start dates.
            </p>
          )}

          {recent90.length > 0 && (
            <section className="ac-recent">
              <h2>Recently joined</h2>
              <ul>
                {recent90.map((m) => (
                  <li key={m.id}>
                    <span className="ac-recent-when">{memberSince(m)}</span>
                    <a href={m.contactUrl} target="_blank" rel="noreferrer">
                      {m.name || `Contact ${m.id}`}
                    </a>
                    {m.email && <span className="ac-recent-email">{m.email}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="ac-toolbar">
            <input
              type="search"
              placeholder="Search name, email, phone, or location…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="ac-search"
            />
            <span className="ac-count">
              {filtered.length} of {members.length} shown
            </span>
          </div>

          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort("name")}>Name{sortArrow("name")}</th>
                  <th onClick={() => toggleSort("email")}>Email{sortArrow("email")}</th>
                  <th>Phone</th>
                  <th onClick={() => toggleSort("location")}>
                    Location{sortArrow("location")}
                  </th>
                  <th onClick={() => toggleSort("startDate")}>
                    Member since{sortArrow("startDate")}
                  </th>
                  <th className="ac-num" onClick={() => toggleSort("recurringAmount")}>
                    Recurring gift{sortArrow("recurringAmount")}
                  </th>
                  <th className="ac-num" onClick={() => toggleSort("lifeToDateGivingNum")}>
                    Lifetime giving{sortArrow("lifeToDateGivingNum")}
                  </th>
                  <th onClick={() => toggleSort("lastGiftDate")}>
                    Last gift{sortArrow("lastGiftDate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m: AnnunciationMember) => (
                  <tr key={m.id}>
                    <td>
                      <a href={m.contactUrl} target="_blank" rel="noreferrer">
                        {m.name || `Contact ${m.id}`}
                      </a>
                    </td>
                    <td>{dash(m.email)}</td>
                    <td>{dash(m.phone)}</td>
                    <td>{dash(m.location)}</td>
                    <td>{memberSince(m) || "—"}</td>
                    <td className="ac-num">{formatRecurring(m)}</td>
                    <td className="ac-num">{money(m.lifeToDateGiving)}</td>
                    <td>
                      {m.lastGiftAmount ? `${m.lastGiftAmount}` : "—"}
                      {m.lastGiftDate ? ` (${m.lastGiftDate})` : ""}
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="ac-empty">
                      No members match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

export default function AnnunciationPage() {
  return (
    <AccessGate report="annunciation">
      <ReportTopBar title="Annunciation Circle" nav={[]} />
      <AnnunciationInner />
    </AccessGate>
  );
}
