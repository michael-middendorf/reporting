"use client";

import { useState } from "react";
import {
  CyberLoadView,
  KpiGrid,
  PageHead,
  RagPill,
  formatAsOf,
  formatValue,
  manualToKpi,
  useCyberData,
  useCyberRegister,
} from "@/components/cyber/CyberUi";
import { ManualKpiEditor } from "@/components/cyber/SectionPage";
import type { ManualKpi, ManualKpiInput } from "@/lib/cyber/register";
import { SECTION_LABELS, kpisForSection } from "@/lib/cyber/shape";

/** GLBA Safeguards Rule (16 CFR 314.4) elements, each a manual KPI kpi-glba-<key>. */
const GLBA_ITEMS: { key: string; label: string }[] = [
  { key: "qualified-individual", label: "Qualified Individual named" },
  { key: "written-program", label: "Written information security program" },
  { key: "risk-assessment", label: "Written risk assessment" },
  { key: "access-controls", label: "Access controls reviewed" },
  { key: "encryption", label: "Customer information encrypted in transit and at rest" },
  { key: "mfa", label: "MFA for anyone accessing customer information" },
  { key: "monitoring", label: "Continuous monitoring or annual pen test plus vulnerability scans" },
  { key: "training", label: "Security awareness training" },
  { key: "vendor-oversight", label: "Service provider oversight" },
  { key: "ir-plan", label: "Written incident response plan" },
  { key: "board-report", label: "Annual written report to the board" },
];

type Editing = { existing: ManualKpi | null; preset?: Partial<ManualKpiInput> } | null;

export default function CyberProgramPage() {
  const data = useCyberData();
  const register = useCyberRegister();
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <main className="cy">
      <PageHead
        title={SECTION_LABELS.program}
        sub="GLBA Safeguards checklist, incident response, training, phishing, vendor and policy reviews. These are manual entries until a source exists."
      />

      <CyberLoadView load={register}>
        {(d) => {
          const byId = new Map(d.kpis.map((k) => [k.id, k]));
          const other = d.kpis.filter((k) => k.section === "program" && !k.id.startsWith("kpi-glba-"));
          return (
            <>
              <h2 style={{ marginTop: 0 }}>GLBA Safeguards checklist</h2>
              <div className="cy-table-wrap">
                <table className="cy-table">
                  <thead>
                    <tr>
                      <th>Element</th>
                      <th>Status</th>
                      <th>RAG</th>
                      <th>As of</th>
                      <th className="cy-no-print" />
                    </tr>
                  </thead>
                  <tbody>
                    {GLBA_ITEMS.map((item) => {
                      const id = `kpi-glba-${item.key}`;
                      const k = byId.get(id);
                      return (
                        <tr key={id}>
                          <td>{item.label}</td>
                          <td>{k ? formatValue(k.value) : "Not recorded"}</td>
                          <td>
                            <RagPill rag={k?.rag ?? null} />
                          </td>
                          <td>{k ? formatAsOf(k.asOf ?? k.updatedAt) : ""}</td>
                          <td className="cy-no-print">
                            <button
                              type="button"
                              className="cy-btn is-secondary"
                              style={{ marginTop: 0 }}
                              onClick={() =>
                                setEditing(
                                  k
                                    ? { existing: k }
                                    : { existing: null, preset: { id, label: item.label, section: "program" } },
                                )
                              }
                            >
                              {k ? "Edit" : "Record"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {editing && (
                <>
                  <h2>{editing.existing ? `Edit: ${editing.existing.label}` : "New manual KPI"}</h2>
                  <ManualKpiEditor
                    key={editing.existing ? `${editing.existing.id}:${editing.existing.version}` : editing.preset?.id ?? "new"}
                    existing={editing.existing}
                    preset={editing.preset}
                    onCancel={() => setEditing(null)}
                    onDone={() => {
                      setEditing(null);
                      register.reload();
                    }}
                  />
                </>
              )}

              <h2>Program KPIs</h2>
              {other.length ? (
                <>
                  <KpiGrid kpis={other.map(manualToKpi)} />
                  <div className="cy-no-print" style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {other.map((k) => (
                      <button key={k.id} type="button" className="cy-btn is-secondary" onClick={() => setEditing({ existing: k })}>
                        Edit {k.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="cy-empty">
                  No program KPIs recorded yet (IR tabletop date, training completion %, phishing click rate,
                  vendor reviews, policy review dates).
                </div>
              )}
              {!editing && (
                <button type="button" className="cy-btn cy-no-print" onClick={() => setEditing({ existing: null })}>
                  Add a manual KPI
                </button>
              )}
            </>
          );
        }}
      </CyberLoadView>

      <h2>Published program measures</h2>
      <CyberLoadView load={data}>
        {(d) => {
          const kpis = kpisForSection(d.snapshot, "program");
          return kpis.length ? <KpiGrid kpis={kpis} /> : <div className="cy-empty">None in the latest snapshot.</div>;
        }}
      </CyberLoadView>

      <h2>Recent access</h2>
      <div className="cy-empty">
        Every Cybersecurity API call is logged (CloudWatch, event cyber_access). The last-30-views panel
        arrives with the publisher in a later release.
      </div>
    </main>
  );
}
