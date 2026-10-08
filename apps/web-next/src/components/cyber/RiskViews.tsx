"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  RISK_CATEGORIES,
  RISK_STATUSES,
  TREATMENTS,
  riskBand,
  riskScore,
  type RiskInput,
  type RiskItem,
} from "@/lib/cyber/register";
import { formatAsOf } from "./CyberUi";

const STATUS_LABEL: Record<RiskItem["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  accepted: "Accepted",
  closed: "Closed",
};

export function openRisks(risks: RiskItem[]): RiskItem[] {
  return risks.filter((r) => r.status === "open" || r.status === "in_progress");
}

export function topRisks(risks: RiskItem[], n = 5): RiskItem[] {
  return openRisks(risks)
    .slice()
    .sort((a, b) => riskScore(b) - riskScore(a) || a.title.localeCompare(b.title))
    .slice(0, n);
}

export function isOverdue(r: RiskItem, today = new Date().toISOString().slice(0, 10)): boolean {
  return !!r.dueDate && r.dueDate < today && r.status !== "closed" && r.status !== "accepted";
}

/** 5x5 likelihood (rows, 5 at top) by impact (columns). Counts open + in-progress risks. */
export function RiskHeatmap({ risks }: { risks: RiskItem[] }) {
  const counts = new Map<string, number>();
  for (const r of openRisks(risks)) {
    const k = `${r.likelihood}:${r.impact}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rows = [5, 4, 3, 2, 1];
  const cols = [1, 2, 3, 4, 5];
  return (
    <div>
      <div className="cy-heat" role="table" aria-label="Open risks by likelihood and impact">
        {rows.map((l) => (
          <div key={`row-${l}`} style={{ display: "contents" }} role="row">
            <div className="cy-heat-axis" role="rowheader">
              L{l}
            </div>
            {cols.map((i) => {
              const n = counts.get(`${l}:${i}`) ?? 0;
              return (
                <div
                  key={`${l}:${i}`}
                  role="cell"
                  className={`cy-heat-cell is-${riskBand(l * i)}`}
                  title={`Likelihood ${l}, impact ${i}: ${n} open`}
                >
                  {n || ""}
                </div>
              );
            })}
          </div>
        ))}
        <div />
        {cols.map((i) => (
          <div key={`col-${i}`} className="cy-heat-axis">
            I{i}
          </div>
        ))}
      </div>
      <div className="cy-heat-caption">Rows: likelihood. Columns: impact. Open and in-progress risks only.</div>
    </div>
  );
}

export function RiskTable({
  risks,
  onEdit,
  compact,
}: {
  risks: RiskItem[];
  onEdit?: (r: RiskItem) => void;
  compact?: boolean;
}) {
  if (!risks.length) return <div className="cy-empty">No risks in this list.</div>;
  return (
    <div className="cy-table-wrap">
      <table className="cy-table">
        <thead>
          <tr>
            <th>Risk</th>
            <th className="cy-num">Score</th>
            {!compact && <th>Category</th>}
            <th>Owner</th>
            <th>Treatment</th>
            <th>Due</th>
            <th>Status</th>
            {!compact && <th>KPI</th>}
            {onEdit && <th className="cy-no-print" />}
          </tr>
        </thead>
        <tbody>
          {risks.map((r) => {
            const score = riskScore(r);
            return (
              <tr key={r.id}>
                <td>
                  {r.title}
                  {!compact && r.notes && <div className="cy-tile-meta">{r.notes}</div>}
                </td>
                <td className="cy-num">
                  <span className={`cy-pill is-${riskBand(score)}`}>{score}</span>
                </td>
                {!compact && <td>{r.category}</td>}
                <td>{r.owner}</td>
                <td>{r.treatment}</td>
                <td>
                  {r.dueDate ? formatAsOf(r.dueDate) : "None"}
                  {isOverdue(r) && <div className="cy-delta is-worse">Overdue</div>}
                </td>
                <td>{STATUS_LABEL[r.status]}</td>
                {!compact && <td>{r.kpiId ?? ""}</td>}
                {onEdit && (
                  <td className="cy-no-print">
                    <button type="button" className="cy-btn is-secondary" style={{ marginTop: 0 }} onClick={() => onEdit(r)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const BLANK: RiskInput = {
  id: "",
  title: "",
  category: "governance",
  likelihood: 3,
  impact: 3,
  owner: "",
  treatment: "mitigate",
  dueDate: null,
  status: "open",
  kpiId: null,
  acceptedExpiry: null,
  notes: "",
  source: "",
};

function toInput(r: RiskItem): RiskInput {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    likelihood: r.likelihood,
    impact: r.impact,
    owner: r.owner,
    treatment: r.treatment,
    dueDate: r.dueDate,
    status: r.status,
    kpiId: r.kpiId,
    acceptedExpiry: r.acceptedExpiry,
    notes: r.notes,
    source: r.source,
  };
}

/** Create or edit one risk. PATCH sends the loaded version (409 when stale). */
export function RiskEditor({
  existing,
  onDone,
  onCancel,
}: {
  existing: RiskItem | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RiskInput>(existing ? toInput(existing) : BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof RiskInput>(key: K, value: RiskInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = existing
        ? await apiFetch("/api/cybersecurity-register", {
            method: "PATCH",
            body: JSON.stringify({ kind: "risk", id: existing.id, version: existing.version, changes: { ...form, id: existing.id } }),
          })
        : await apiFetch("/api/cybersecurity-register", {
            method: "POST",
            body: JSON.stringify({ kind: "risk", item: form }),
          });
      const body = (await res.json().catch(() => null)) as { error?: string; details?: string[] } | null;
      if (!res.ok) {
        setError([body?.error, ...(body?.details ?? [])].filter(Boolean).join(". ") || `Save failed (${res.status})`);
        return;
      }
      onDone();
    } catch {
      setError("Unable to reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="cy-form cy-no-print" onSubmit={save}>
      <label>
        Id
        <input
          value={form.id}
          disabled={!!existing}
          required
          pattern="[a-z0-9][a-z0-9\-]{1,63}"
          placeholder="risk-short-name"
          onChange={(e) => set("id", e.target.value)}
        />
      </label>
      <label className="is-wide">
        Title
        <input value={form.title} required maxLength={200} onChange={(e) => set("title", e.target.value)} />
      </label>
      <label>
        Category
        <select value={form.category} onChange={(e) => set("category", e.target.value as RiskInput["category"])}>
          {RISK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Likelihood (1 to 5)
        <input type="number" min={1} max={5} value={form.likelihood} onChange={(e) => set("likelihood", Number(e.target.value))} />
      </label>
      <label>
        Impact (1 to 5)
        <input type="number" min={1} max={5} value={form.impact} onChange={(e) => set("impact", Number(e.target.value))} />
      </label>
      <label>
        Owner (role, not a person)
        <input value={form.owner} required maxLength={100} onChange={(e) => set("owner", e.target.value)} />
      </label>
      <label>
        Treatment
        <select value={form.treatment} onChange={(e) => set("treatment", e.target.value as RiskInput["treatment"])}>
          {TREATMENTS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={form.status} onChange={(e) => set("status", e.target.value as RiskInput["status"])}>
          {RISK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input type="date" value={form.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
      </label>
      <label>
        Accepted until
        <input type="date" value={form.acceptedExpiry ?? ""} onChange={(e) => set("acceptedExpiry", e.target.value || null)} />
      </label>
      <label>
        Tracking KPI id
        <input value={form.kpiId ?? ""} onChange={(e) => set("kpiId", e.target.value || null)} />
      </label>
      <label>
        Source
        <input value={form.source} required maxLength={200} onChange={(e) => set("source", e.target.value)} />
      </label>
      <label className="is-wide">
        Notes (no names, emails, IPs, or secrets)
        <textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="cy-form-actions">
        <button type="submit" className="cy-btn" style={{ marginTop: 0 }} disabled={saving}>
          {saving ? "Saving…" : existing ? "Save changes" : "Add risk"}
        </button>
        <button type="button" className="cy-btn is-secondary" style={{ marginTop: 0 }} onClick={onCancel}>
          Cancel
        </button>
        {error && <span className="cy-form-error">{error}</span>}
      </div>
    </form>
  );
}
