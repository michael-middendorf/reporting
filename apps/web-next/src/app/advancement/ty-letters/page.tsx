"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatEastern } from "@/lib/reports/advancement-overview/shape";
import {
  ROW_LABELS,
  boundFilters,
  defaultFilters,
  filterCards,
  mdy,
  money,
  type SentFilter,
  type TyLetterCard,
  type TyLetterFilters,
  type TyLettersSnapshot,
} from "@/lib/reports/ty-letters/shape";
import "@/styles/annunciation.css";
import "@/styles/mgo-analysis.css";
import "@/styles/ty-letters.css";

type Snapshot = TyLettersSnapshot & { sentError?: string | null };

const SENT_OPTIONS: { value: SentFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "not-sent", label: "Not sent" },
  { value: "sent", label: "Sent" },
];

function sentLine(c: TyLetterCard): string {
  if (!c.sent) return "";
  const who = c.sentBy
    ? c.sentBy
        .split("@")[0]
        .split(".")
        .filter((part) => part.length > 1)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" ")
    : "someone";
  const when = c.sentAt ? formatEastern(c.sentAt) : "";
  return `Sent by ${who}${when ? ` on ${when}` : ""}`;
}

function Card({
  c,
  saving,
  onToggle,
}: {
  c: TyLetterCard;
  saving: boolean;
  onToggle: (c: TyLetterCard, sent: boolean) => void;
}) {
  return (
    <article className="tyl-card">
      <div className="tyl-card-head">
        <div className="tyl-gift">
          Gift {c.virtuousGiftUrl ? (
            <a href={c.virtuousGiftUrl} target="_blank" rel="noopener noreferrer">
              {c.giftId}
            </a>
          ) : (
            c.giftId
          )}{" "}
          · {money(c.amount)} · {mdy(c.giftDate)}
          {c.batch ? ` · Batch ${c.batch}` : ""}
          {c.anonymous && <span className="tyl-badge">Anonymous donor</span>}
        </div>
        <label className="tyl-sent">
          <input
            type="checkbox"
            checked={Boolean(c.sent)}
            disabled={saving}
            onChange={(e) => onToggle(c, e.target.checked)}
          />
          Sent
          {c.sent && <span className="tyl-sent-by">{sentLine(c)}</span>}
        </label>
      </div>

      <div className="ac-table-wrap">
        <table className="ac-table tyl-table">
          <thead>
            <tr>
              <th>Donor</th>
              <th>Credited Solicitor</th>
              <th>Salutation</th>
              <th>Addressee</th>
              <th>Address</th>
              <th>Cell Phone</th>
              <th>Home Phone</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="tyl-strong">{c.donorName}</td>
              <td>{c.solicitor}</td>
              <td>{c.salutation}</td>
              <td>{c.addressee}</td>
              <td className="tyl-address">
                {c.addressLines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </td>
              <td className="tyl-nowrap">{c.cellPhone}</td>
              <td className="tyl-nowrap">{c.homePhone}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="ac-table-wrap">
        <table className="ac-table tyl-table">
          <thead>
            <tr>
              <th>Gift</th>
              <th className="ac-num">Amount</th>
              <th>Date</th>
              <th>Type</th>
              <th>Fund</th>
              <th>Appeal</th>
              <th>Hard-credit Donor</th>
            </tr>
          </thead>
          <tbody>
            {ROW_LABELS.map(({ key, label }) => {
              const r = c.rows?.[key] ?? null;
              return (
                <tr key={key}>
                  <td className="tyl-strong">{label}</td>
                  <td className="ac-num">{r ? money(r.amount) : ""}</td>
                  <td className="tyl-nowrap">{r ? mdy(r.date) : ""}</td>
                  <td>{r?.type ?? ""}</td>
                  <td>{r?.fund ?? ""}</td>
                  <td>{r?.appeal ?? ""}</td>
                  <td>{r?.hardCredit ?? ""}</td>
                </tr>
              );
            })}
            <tr className="tyl-total">
              <td>Total Giving</td>
              <td className="ac-num">{money(c.totalGiving)}</td>
              <td colSpan={5} />
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default function TyLettersPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TyLetterFilters | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // setState only runs in promise callbacks, so the mount effect does not set state synchronously.
  function fetchData() {
    return apiFetch("/api/ty-letters-data")
      .then(async (r) => {
        const json = (await r.json()) as Snapshot;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setFilters((f) => f ?? defaultFilters(json));
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void fetchData();
  }, []);

  function load() {
    setLoading(true);
    void fetchData();
  }

  // Raw input values stay in state so typing is not fought mid-keystroke; the
  // snapshot window and amount floor are applied when filtering.
  function update(patch: Partial<TyLetterFilters>) {
    if (!data) return;
    setFilters((f) => ({ ...(f ?? defaultFilters(data)), ...patch }));
  }

  async function toggleSent(card: TyLetterCard, sent: boolean) {
    setSaving((s) => ({ ...s, [card.giftId]: true }));
    setSaveError(null);
    try {
      const r = await apiFetch("/api/ty-letters-sent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giftId: card.giftId, sent }),
      });
      const flag = (await r.json()) as { sent?: boolean; sentBy?: string | null; sentAt?: string | null; error?: string };
      if (!r.ok) throw new Error(flag.error || `Error ${r.status}`);
      setData((d) =>
        d
          ? {
              ...d,
              cards: d.cards.map((c) =>
                c.giftId === card.giftId
                  ? { ...c, sent: Boolean(flag.sent), sentBy: flag.sentBy ?? null, sentAt: flag.sentAt ?? null }
                  : c,
              ),
            }
          : d,
      );
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving((s) => ({ ...s, [card.giftId]: false }));
    }
  }

  const cards = useMemo(
    () => (data && filters ? filterCards(data.cards, boundFilters(filters, data)) : []),
    [data, filters],
  );

  return (
    <main className="ac-page mga-page tyl-page">
      <div className="ac-head">
        <div>
          <h1>Thank-You Letters</h1>
          <p className="ac-sub">
            Gifts of {money(data?.minAmount ?? 1000)} or more
            {data?.generatedAt ? ` · Data as of ${formatEastern(data.generatedAt)}` : ""}
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

      {!error && data?.partial && (
        <div className="ac-note tyl-note">
          This refresh is still catching up: {data.pending.toLocaleString("en-US")} recent gift
          {data.pending === 1 ? " is" : "s are"} not shown yet. The next refresh adds them.
        </div>
      )}
      {!error && (data?.sentError || saveError) && (
        <div className="ac-error">
          <p>{saveError || data?.sentError}</p>
        </div>
      )}

      {!error && data && filters && (
        <>
          <div className="mga-controls tyl-controls">
            <label className="mga-field">
              <span>Gift date from</span>
              <input
                type="date"
                value={filters.from}
                min={data.windowStart}
                max={data.windowEnd}
                onChange={(e) => update({ from: e.target.value })}
              />
            </label>
            <label className="mga-field">
              <span>To</span>
              <input
                type="date"
                value={filters.to}
                min={data.windowStart}
                max={data.windowEnd}
                onChange={(e) => update({ to: e.target.value })}
              />
            </label>
            <label className="mga-field">
              <span>Minimum amount</span>
              <input
                type="number"
                min={data.minAmount}
                step={100}
                value={Number.isFinite(filters.minAmount) ? filters.minAmount : ""}
                onChange={(e) =>
                  update({ minAmount: e.target.value === "" ? Number.NaN : Number(e.target.value) })
                }
              />
            </label>
            <div className="mga-field">
              <span>Sent</span>
              <div className="mga-seg" role="group" aria-label="Sent filter">
                {SENT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={o.value === filters.sent ? "mga-seg-on" : undefined}
                    aria-pressed={o.value === filters.sent}
                    onClick={() => update({ sent: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ac-toolbar">
            <input
              className="ac-search"
              value={filters.q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search donor names"
              aria-label="Search donor names"
            />
            <span className="ac-count">
              {cards.length.toLocaleString("en-US")} of {data.cards.length.toLocaleString("en-US")} gifts
            </span>
          </div>

          {cards.length === 0 && (
            <p className="ac-empty">{data.cards.length ? "No gifts match these filters." : "No gifts in this snapshot yet."}</p>
          )}
          {cards.map((c) => (
            <Card key={c.giftId} c={c} saving={Boolean(saving[c.giftId])} onToggle={toggleSent} />
          ))}

          <footer className="mga-foot">
            <h2>How this is built</h2>
            <ul>
              <li>
                One card per Virtuous gift of {money(data.minAmount)} or more dated {mdy(data.windowStart)} to{" "}
                {mdy(data.windowEnd)}. The donor is the recognition (soft credit) contact when the gift has one.
              </li>
              <li>
                Latest, 2nd Latest, Largest, 1st and Total Giving are as of the thanked gift: only gifts dated on or before
                it, with both hard and soft credit. $0, reversed, and reversing gifts are left out.
              </li>
              <li>Name, address, phones and solicitor come from the donor&apos;s current Virtuous record.</li>
            </ul>
          </footer>
        </>
      )}
    </main>
  );
}
