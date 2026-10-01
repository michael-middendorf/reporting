"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatEastern } from "@/lib/reports/advancement-overview/shape";
import {
  DEFAULT_SORT,
  PERIOD_LABELS,
  filterDonors,
  kpisFor,
  mdy,
  sortDonors,
  truncate,
  usd,
  type DonorSortKey,
  type MgoAnalysisSnapshot,
  type MgoDonor,
  type Period,
  type SortDir,
} from "@/lib/reports/mgo-analysis/shape";
import "@/styles/annunciation.css";
import "@/styles/mgo-analysis.css";

const PLAN_MAX = 80;

const COLUMNS: { key: DonorSortKey; label: string; num?: boolean; firstDir: SortDir }[] = [
  { key: "topProspect", label: "Top FY27 Prospect", firstDir: "desc" },
  { key: "name", label: "Donor Name", firstDir: "asc" },
  { key: "assignedFirstName", label: "Assigned to", firstDir: "asc" },
  { key: "openAskAmount", label: "Open Proposal in Pipeline", num: true, firstDir: "desc" },
  { key: "formalProposal", label: "Formal Proposal", firstDir: "desc" },
  { key: "planFy27", label: "Plan for FY27", firstDir: "asc" },
  { key: "lastGiftDate", label: "Last Gift Date", firstDir: "desc" },
  { key: "lastMgoActivityDate", label: "Last Activity by MGO", firstDir: "desc" },
];

const PERIODS: Period[] = ["week", "month", "quarter"];

function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function rowKey(d: MgoDonor): string {
  return `${d.contactId}:${d.assignedMgo}`;
}

export default function MgoAnalysisPage() {
  const [data, setData] = useState<MgoAnalysisSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mgo, setMgo] = useState("");
  const [period, setPeriod] = useState<Period>("month");
  const [q, setQ] = useState("");
  const [topProspect, setTopProspect] = useState(false);
  const [hasPlan, setHasPlan] = useState(false);
  const [hasProposal, setHasProposal] = useState(false);
  const [hasOpen, setHasOpen] = useState(false);
  const [sort, setSort] = useState<{ key: DonorSortKey; dir: SortDir }>(DEFAULT_SORT);
  const [openPlans, setOpenPlans] = useState<Record<string, boolean>>({});

  // setState only runs in promise callbacks, so the mount effect does not set state synchronously.
  function fetchData() {
    return apiFetch("/api/mgo-analysis-data")
      .then(async (r) => {
        const json = (await r.json()) as MgoAnalysisSnapshot;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
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

  const mgos = useMemo(
    () => [...(data?.mgos ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const mgoKey = mgo || null;
  const selectedMgo = mgos.find((m) => m.key === mgo);
  const kpis = useMemo(() => kpisFor(data, mgoKey, period), [data, mgoKey, period]);

  const rows = useMemo(() => {
    const filtered = filterDonors(data?.donors, {
      mgo: mgoKey,
      topProspect,
      hasPlan,
      hasProposal,
      hasOpen,
      q,
    });
    return sortDonors(filtered, sort.key, sort.dir);
  }, [data, mgoKey, topProspect, hasPlan, hasProposal, hasOpen, q, sort]);

  function toggleSort(key: DonorSortKey, firstDir: SortDir) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir },
    );
  }

  const fyLabel = data?.fiscalYear?.label ?? "FY";
  const scopeLabel = selectedMgo ? selectedMgo.name : "MGO team";
  const defs = data?.definitions;
  const totalDonors = filterDonors(data?.donors, { mgo: mgoKey }).length;

  return (
    <main className="ac-page mga-page">
      <div className="ac-head">
        <div>
          <h1>MGO Analysis and Management</h1>
          <p className="ac-sub">
            {scopeLabel} · {fyLabel}
            {data?.generated_at ? ` · updated ${formatEastern(data.generated_at)}` : ""}
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
          <div className="mga-controls">
            <label className="mga-field">
              <span>MGO</span>
              <select value={mgo} onChange={(e) => setMgo(e.target.value)} disabled={!mgos.length}>
                <option value="">MGO team (all)</option>
                {mgos.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mga-field">
              <span>Activity period</span>
              <div className="mga-seg" role="group" aria-label="Activity period">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={p === period ? "mga-seg-on" : undefined}
                    aria-pressed={p === period}
                    onClick={() => setPeriod(p)}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ac-cards mga-cards">
            <div className="ac-card">
              <span className="ac-card-num">{loading && !data ? "…" : usd(kpis.fyRaised)}</span>
              <span className="ac-card-label">Total Fundraised {fyLabel}</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{loading && !data ? "…" : usd(kpis.openAskAmount)}</span>
              <span className="ac-card-label">Open Asks in Pipeline</span>
              <span className="mga-card-sub">{count(kpis.openAskCount, "open ask")}</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{loading && !data ? "…" : usd(kpis.fundedAmount)}</span>
              <span className="ac-card-label">Funded from Pipeline</span>
              <span className="mga-card-sub">{count(kpis.fundedCount, "funded ask")}</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{loading && !data ? "…" : kpis.donorCount.toLocaleString("en-US")}</span>
              <span className="ac-card-label">Donors in Portfolio</span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{loading && !data ? "…" : kpis.activityNotes.toLocaleString("en-US")}</span>
              <span className="ac-card-label">Activity Notes</span>
              <span className="mga-card-sub">
                {PERIOD_LABELS[period]}
                {kpis.window ? `: ${kpis.window.label}` : ""}
              </span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{loading && !data ? "…" : kpis.faceToFace.toLocaleString("en-US")}</span>
              <span className="ac-card-label">Face to Face</span>
              <span className="mga-card-sub">
                {PERIOD_LABELS[period]}
                {kpis.window ? `: ${kpis.window.label}` : ""}
              </span>
            </div>
            <div className="ac-card">
              <span className="ac-card-num">{loading && !data ? "…" : kpis.proposalDocs.toLocaleString("en-US")}</span>
              <span className="ac-card-label">Proposal Documentation</span>
              <span className="mga-card-sub">{fyLabel}</span>
            </div>
          </div>

          <div className="ac-toolbar">
            <input
              className="ac-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search donor names"
              aria-label="Search donor names"
            />
            <div className="mga-checks">
              <label>
                <input type="checkbox" checked={topProspect} onChange={(e) => setTopProspect(e.target.checked)} />
                Top FY27 Prospect
              </label>
              <label>
                <input type="checkbox" checked={hasPlan} onChange={(e) => setHasPlan(e.target.checked)} />
                Has FY27 Plan
              </label>
              <label>
                <input type="checkbox" checked={hasProposal} onChange={(e) => setHasProposal(e.target.checked)} />
                Has Proposal Documentation
              </label>
              <label>
                <input type="checkbox" checked={hasOpen} onChange={(e) => setHasOpen(e.target.checked)} />
                Has Open Proposal
              </label>
            </div>
            <span className="ac-count">
              {rows.length === totalDonors
                ? count(rows.length, "row")
                : `${rows.length.toLocaleString("en-US")} of ${count(totalDonors, "row")}`}
            </span>
          </div>

          <div className="ac-table-wrap">
            <table className="ac-table mga-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const active = sort.key === c.key;
                    return (
                      <th
                        key={c.key}
                        className={c.num ? "ac-num" : undefined}
                        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      >
                        <button type="button" className="mga-sort" onClick={() => toggleSort(c.key, c.firstDir)}>
                          {c.label}
                          <span className="mga-sort-ind" aria-hidden="true">
                            {active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="ac-empty">
                      {loading
                        ? "Loading…"
                        : (data?.donors?.length ?? 0) === 0
                          ? "No portfolio donors in this snapshot yet."
                          : "No donors match these filters."}
                    </td>
                  </tr>
                )}
                {rows.map((d) => {
                  const key = rowKey(d);
                  const plan = (d.planFy27 ?? "").trim();
                  const short = truncate(plan, PLAN_MAX);
                  const isLong = short !== plan.replace(/\s+/g, " ");
                  const expanded = Boolean(openPlans[key]);
                  return (
                    <tr key={key}>
                      <td>{d.topProspect ? "Yes" : ""}</td>
                      <td className="mga-name">
                        {d.contactUrl ? (
                          <a href={d.contactUrl} target="_blank" rel="noopener noreferrer">
                            {d.name || "(no name)"}
                          </a>
                        ) : (
                          d.name || "(no name)"
                        )}
                      </td>
                      <td>{d.assignedFirstName}</td>
                      <td className="ac-num">{d.openAskAmount > 0 ? usd(d.openAskAmount) : ""}</td>
                      <td>{d.formalProposal ? "Yes" : ""}</td>
                      <td className="mga-plan">
                        {plan && isLong ? (
                          <button
                            type="button"
                            className="mga-plan-btn"
                            title={plan}
                            aria-expanded={expanded}
                            onClick={() => setOpenPlans((s) => ({ ...s, [key]: !expanded }))}
                          >
                            {expanded ? plan : short}
                          </button>
                        ) : (
                          <span title={plan || undefined}>{plan}</span>
                        )}
                      </td>
                      <td className="mga-date">{mdy(d.lastGiftDate)}</td>
                      <td className="mga-date">{mdy(d.lastMgoActivityDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {defs && (
            <footer className="mga-foot">
              <h2>How this is counted</h2>
              <ul>
                <li>
                  <strong>Activity Notes</strong>: Virtuous notes by the MGO on a donor in their portfolio, of type{" "}
                  {defs.outreachTypes.join(", ")}.
                </li>
                <li>
                  <strong>Face to Face</strong>: notes of type {defs.faceToFaceTypes.join(", ")}.
                </li>
                <li>
                  <strong>Proposal Documentation</strong> and <strong>Formal Proposal</strong>: notes of type{" "}
                  {defs.proposalTypes.join(", ")} this fiscal year.
                </li>
                <li>
                  <strong>Plan for FY27</strong>: the latest note of type {defs.planTypes.join(", ")} this fiscal
                  year.
                </li>
                <li>
                  <strong>Top FY27 Prospect</strong>: contact tag {defs.topProspectTag}.
                </li>
                <li>
                  <strong>Open Asks</strong>: gift asks not in status {defs.openAskExcludedStatuses.join(", ")}.{" "}
                  <strong>Funded</strong>: gift asks in status {defs.fundedStatuses.join(", ")}.
                </li>
                <li>
                  Weeks run Monday through Sunday. Fiscal quarters are Jul-Sep, Oct-Dec, Jan-Mar, and Apr-Jun. Team
                  totals count each donor and gift once; the donor list shows a donor once per assigned MGO.
                </li>
              </ul>
            </footer>
          )}
        </>
      )}
    </main>
  );
}
