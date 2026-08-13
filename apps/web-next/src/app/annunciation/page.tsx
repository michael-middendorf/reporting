"use client";

import { useEffect, useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import {
  formatRecurring,
  memberSince,
  recentlyJoined,
  type AnnunciationMember,
  type AnnunciationMonthly,
  type AnnunciationRetentionPoint,
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

const usd0 = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** Clickable/hoverable ⓘ that reveals a metric definition. */
function InfoDot({ text }: { text: string }) {
  return (
    <span className="ac-info-wrap">
      <button
        type="button"
        className="ac-info"
        aria-label={`Definition: ${text}`}
        onClick={(e) => e.stopPropagation()}
      >
        i
      </button>
      <span className="ac-info-tip" role="tooltip">
        {text}
      </span>
    </span>
  );
}

const DEFS = {
  members:
    'Active members: contacts tagged "Annunciation Circle Member" who have a live recurring gift to the Annunciation Circle project (status not Cancelled or Fulfilled). Tagged contacts with no active recurring gift are excluded.',
  joined30:
    "Members whose start date (their earliest Annunciation Circle recurring-gift start) falls within the last 30 days.",
  joined90:
    "Members whose start date (their earliest Annunciation Circle recurring-gift start) falls within the last 90 days.",
  received:
    "Total AC donations received: the sum of every gift designated to the Annunciation Circle project, by gift date. Excludes members' gifts to other funds.",
  active30:
    "Distinct donors with a gift designated to Annunciation Circle in the last 30 days.",
  allTime: "Distinct donors who have ever given to the Annunciation Circle project.",
  revenue:
    "Sum of gift amounts designated to Annunciation Circle with a gift date in that month.",
  avgGift: "Revenue ÷ number of Annunciation Circle gifts that month.",
  donors: "Distinct donors who gave to Annunciation Circle that month.",
  newCol: "Donors whose first-ever Annunciation Circle gift is that month.",
  lost: "Donors who gave the previous month but not this month.",
  returning:
    "Donors who gave this month and earlier, but not the immediately preceding month (reactivated).",
  carryover: "Donors who gave both the previous month and this month (retained).",
  memberSince:
    "Start date of the member's earliest Annunciation Circle recurring gift (falls back to when first seen if none on file).",
  recurring:
    "The member's current Annunciation Circle recurring gift — amount, frequency, and status (active preferred).",
  lifetime: "The contact's total giving to ALL funds in Virtuous (not AC-only).",
  lastGift: "The contact's most recent gift to any fund — amount and date.",
  retention:
    "Cohort retention: of the donors who first gave in a given month, the % still giving N months later, averaged across all cohorts.",
  revChart: "Gifts designated to Annunciation Circle, summed by gift-date month.",
} as const;

/** Simple responsive CSS bar chart. */
function BarChart<T>({
  items,
  valueOf,
  labelOf,
  titleOf,
  accent,
}: {
  items: T[];
  valueOf: (it: T) => number;
  labelOf: (it: T) => string;
  titleOf: (it: T) => string;
  accent?: boolean;
}) {
  const max = Math.max(1, ...items.map(valueOf));
  return (
    <div className="ac-bars">
      {items.map((it, i) => (
        <div className="ac-bar-col" key={i}>
          <div
            className={accent ? "ac-bar ac-bar-accent" : "ac-bar"}
            style={{ height: `${(valueOf(it) / max) * 100}%` }}
          >
            <span className="ac-tip" role="tooltip">
              {titleOf(it)}
            </span>
          </div>
          <span className="ac-bar-x">{labelOf(it)}</span>
        </div>
      ))}
    </div>
  );
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

  const stats = data?.acStats;
  // Most recent 13 months (FY-style window), oldest→newest for the table/chart.
  const recentMonthly = useMemo<AnnunciationMonthly[]>(
    () => (stats?.monthly ?? []).slice(-13),
    [stats],
  );
  const totals = useMemo(() => {
    const t = { revenue: 0, gifts: 0, donors: 0, new: 0, lost: 0, returning: 0, carryover: 0 };
    for (const m of recentMonthly) {
      t.revenue += m.revenue;
      t.gifts += m.gifts;
      t.donors += m.donors;
      t.new += m.new;
      t.lost += m.lost;
      t.returning += m.returning;
      t.carryover += m.carryover;
    }
    return t;
  }, [recentMonthly]);

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
              <span className="ac-card-num">{stats?.activeLast30 ?? "—"}</span>
              <span className="ac-card-label">
                Gave in last 30 days <InfoDot text={DEFS.active30} />
              </span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{recent30.length}</span>
              <span className="ac-card-label">
                Joined in last 30 days <InfoDot text={DEFS.joined30} />
              </span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{recent90.length}</span>
              <span className="ac-card-label">
                Joined in last 90 days <InfoDot text={DEFS.joined90} />
              </span>
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

          {stats && recentMonthly.length > 0 && (
            <section className="ac-analytics">
              <h2>Annunciation Circle giving</h2>
              <div className="ac-cards">
                <div className="ac-card">
                  <span className="ac-card-num">{stats.allTimeDonors}</span>
                  <span className="ac-card-label">
                    All-time AC donors <InfoDot text={DEFS.allTime} />
                  </span>
                </div>
              </div>

              <div className="ac-charts">
                <div className="ac-chart-box">
                  <h3>Revenue by month <InfoDot text={DEFS.revChart} /></h3>
                  <BarChart<AnnunciationMonthly>
                    items={recentMonthly}
                    valueOf={(m) => m.revenue}
                    labelOf={(m) => m.label.split(" ")[1]}
                    titleOf={(m) => `${m.label}: ${usd0(m.revenue)} · ${m.donors} donors`}
                    accent
                  />
                </div>
                <div className="ac-chart-box">
                  <h3>Donor retention by month <InfoDot text={DEFS.retention} /></h3>
                  <BarChart<AnnunciationRetentionPoint>
                    items={stats.retention}
                    valueOf={(r) => r.pct}
                    labelOf={(r) => String(r.monthIndex)}
                    titleOf={(r) => `Month ${r.monthIndex}: ${r.pct}% still giving`}
                  />
                </div>
              </div>

              <div className="ac-table-wrap">
                <table className="ac-table ac-monthly">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="ac-num">Revenue <InfoDot text={DEFS.revenue} /></th>
                      <th className="ac-num">Avg gift <InfoDot text={DEFS.avgGift} /></th>
                      <th className="ac-num">Donors <InfoDot text={DEFS.donors} /></th>
                      <th className="ac-num">New <InfoDot text={DEFS.newCol} /></th>
                      <th className="ac-num">Lost <InfoDot text={DEFS.lost} /></th>
                      <th className="ac-num">Returning <InfoDot text={DEFS.returning} /></th>
                      <th className="ac-num">Carryover <InfoDot text={DEFS.carryover} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="ac-total-row">
                      <td>Totals</td>
                      <td className="ac-num">{usd0(totals.revenue)}</td>
                      <td className="ac-num">{usd0(totals.gifts ? totals.revenue / totals.gifts : 0)}</td>
                      <td className="ac-num">{totals.donors}</td>
                      <td className="ac-num">{totals.new}</td>
                      <td className="ac-num">{totals.lost}</td>
                      <td className="ac-num">{totals.returning}</td>
                      <td className="ac-num">{totals.carryover}</td>
                    </tr>
                    {recentMonthly
                      .slice()
                      .reverse()
                      .map((m) => (
                        <tr key={m.month}>
                          <td>{m.label}</td>
                          <td className="ac-num">{usd0(m.revenue)}</td>
                          <td className="ac-num">{usd0(m.avgGift)}</td>
                          <td className="ac-num">{m.donors}</td>
                          <td className="ac-num">{m.new}</td>
                          <td className="ac-num">{m.lost}</td>
                          <td className="ac-num">{m.returning}</td>
                          <td className="ac-num">{m.carryover}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <h2 className="ac-members-h">Members</h2>
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
                    Member since <InfoDot text={DEFS.memberSince} />
                    {sortArrow("startDate")}
                  </th>
                  <th className="ac-num" onClick={() => toggleSort("recurringAmount")}>
                    Recurring gift <InfoDot text={DEFS.recurring} />
                    {sortArrow("recurringAmount")}
                  </th>
                  <th className="ac-num" onClick={() => toggleSort("lifeToDateGivingNum")}>
                    Lifetime giving <InfoDot text={DEFS.lifetime} />
                    {sortArrow("lifeToDateGivingNum")}
                  </th>
                  <th onClick={() => toggleSort("lastGiftDate")}>
                    Last gift <InfoDot text={DEFS.lastGift} />
                    {sortArrow("lastGiftDate")}
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
