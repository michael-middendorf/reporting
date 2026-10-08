"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ManualKpi, ManualKpiInput } from "@/lib/cyber/register";
import {
  CYBER_SECTIONS,
  RAGS,
  SECTION_LABELS,
  kpisForSection,
  type CyberSection,
} from "@/lib/cyber/shape";
import {
  CyberLoadView,
  EmptyState,
  KpiGrid,
  PageHead,
  formatAsOf,
  manualToKpi,
  useCyberData,
  useCyberRegister,
} from "./CyberUi";

/** One dashboard section: published KPIs for the section, then manual KPIs. */
export function SectionPage({
  section,
  sub,
  planned,
}: {
  section: Exclude<CyberSection, "overview">;
  sub: string;
  planned: string[];
}) {
  const data = useCyberData();
  const register = useCyberRegister();
  return (
    <main className="cy">
      <PageHead title={SECTION_LABELS[section]} sub={sub} />
      <CyberLoadView load={data} planned={planned}>
        {(d) => {
          const kpis = kpisForSection(d.snapshot, section);
          return kpis.length ? (
            <>
              <p className="cy-sub">Snapshot published {formatAsOf(d.snapshot.generatedAt)}.</p>
              <KpiGrid kpis={kpis} />
            </>
          ) : (
            <EmptyState planned={planned} />
          );
        }}
      </CyberLoadView>
      {register.kind === "ok" && (
        <ManualKpis kpis={register.data.kpis.filter((k) => k.section === section)} />
      )}
    </main>
  );
}

function ManualKpis({ kpis }: { kpis: ManualKpi[] }) {
  if (!kpis.length) return null;
  return (
    <>
      <h2>Manual entries</h2>
      <KpiGrid kpis={kpis.map(manualToKpi)} />
    </>
  );
}

const BLANK_KPI: ManualKpiInput = {
  id: "kpi-",
  label: "",
  section: "program",
  value: null,
  unit: "",
  target: "",
  rag: null,
  asOf: null,
  notes: "",
};

function kpiInput(k: ManualKpi): ManualKpiInput {
  return {
    id: k.id,
    label: k.label,
    section: k.section,
    value: k.value,
    unit: k.unit,
    target: k.target,
    rag: k.rag,
    asOf: k.asOf,
    notes: k.notes,
  };
}

/** Create or edit a manual KPI (training %, tabletop date, GLBA items). */
export function ManualKpiEditor({
  existing,
  preset,
  onDone,
  onCancel,
}: {
  existing: ManualKpi | null;
  preset?: Partial<ManualKpiInput>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ManualKpiInput>(
    existing ? kpiInput(existing) : { ...BLANK_KPI, ...preset },
  );
  const [valueText, setValueText] = useState(
    form.value === null || form.value === undefined ? "" : String(form.value),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ManualKpiInput>(key: K, value: ManualKpiInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const trimmed = valueText.trim();
    const value = trimmed === "" ? null : /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
    const item = { ...form, value };
    try {
      const res = existing
        ? await apiFetch("/api/cybersecurity-register", {
            method: "PATCH",
            body: JSON.stringify({ kind: "kpi", id: existing.id, version: existing.version, changes: { ...item, id: existing.id } }),
          })
        : await apiFetch("/api/cybersecurity-register", {
            method: "POST",
            body: JSON.stringify({ kind: "kpi", item }),
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
        <input value={form.id} disabled={!!existing} required onChange={(e) => set("id", e.target.value)} />
      </label>
      <label className="is-wide">
        Label
        <input value={form.label} required maxLength={120} onChange={(e) => set("label", e.target.value)} />
      </label>
      <label>
        Section
        <select value={form.section} onChange={(e) => set("section", e.target.value as ManualKpiInput["section"])}>
          {CYBER_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {SECTION_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value
        <input value={valueText} maxLength={60} onChange={(e) => setValueText(e.target.value)} />
      </label>
      <label>
        Unit
        <input value={form.unit} maxLength={20} onChange={(e) => set("unit", e.target.value)} />
      </label>
      <label>
        Target
        <input value={form.target} maxLength={60} onChange={(e) => set("target", e.target.value)} />
      </label>
      <label>
        RAG
        <select value={form.rag ?? ""} onChange={(e) => set("rag", (e.target.value || null) as ManualKpiInput["rag"])}>
          <option value="">Not rated</option>
          {RAGS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        As of
        <input type="date" value={form.asOf ?? ""} onChange={(e) => set("asOf", e.target.value || null)} />
      </label>
      <label className="is-wide">
        Notes (no names, emails, IPs, or secrets)
        <textarea rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="cy-form-actions">
        <button type="submit" className="cy-btn" style={{ marginTop: 0 }} disabled={saving}>
          {saving ? "Saving…" : existing ? "Save changes" : "Add KPI"}
        </button>
        <button type="button" className="cy-btn is-secondary" style={{ marginTop: 0 }} onClick={onCancel}>
          Cancel
        </button>
        {error && <span className="cy-form-error">{error}</span>}
      </div>
    </form>
  );
}
