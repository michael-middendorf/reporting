"use client";

import { useState } from "react";
import { CyberLoadView, PageHead, formatAsOf, useCyberRegister } from "@/components/cyber/CyberUi";
import { RiskEditor, RiskHeatmap, RiskTable, openRisks } from "@/components/cyber/RiskViews";
import { riskScore, type RiskItem } from "@/lib/cyber/register";

type Editing = { mode: "new" } | { mode: "edit"; risk: RiskItem } | null;

export default function RiskRegisterPage() {
  const register = useCyberRegister();
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <main className="cy">
      <PageHead
        title="Risk register"
        sub="Likelihood x impact, owner (by role), treatment, due date, status, and the KPI that tracks each risk. Every edit is recorded with who and when."
      />
      <CyberLoadView load={register}>
        {(d) => {
          const active = openRisks(d.risks).sort((a, b) => riskScore(b) - riskScore(a));
          const accepted = d.risks
            .filter((r) => r.status === "accepted")
            .sort((a, b) => (a.acceptedExpiry ?? "").localeCompare(b.acceptedExpiry ?? ""));
          const closed = d.risks.filter((r) => r.status === "closed");
          return (
            <>
              <div className="cy-two">
                <div>
                  <h2 style={{ marginTop: 0 }}>Heatmap</h2>
                  <RiskHeatmap risks={d.risks} />
                </div>
                <div>
                  <h2 style={{ marginTop: 0 }}>Summary</h2>
                  <ul className="cy-list">
                    <li>{active.length} open or in progress</li>
                    <li>{accepted.length} accepted</li>
                    <li>{closed.length} closed</li>
                  </ul>
                  {!editing && (
                    <button type="button" className="cy-btn cy-no-print" onClick={() => setEditing({ mode: "new" })}>
                      Add a risk
                    </button>
                  )}
                </div>
              </div>

              {editing && (
                <>
                  <h2>{editing.mode === "new" ? "New risk" : `Edit: ${editing.risk.title}`}</h2>
                  <RiskEditor
                    key={editing.mode === "edit" ? `${editing.risk.id}:${editing.risk.version}` : "new"}
                    existing={editing.mode === "edit" ? editing.risk : null}
                    onCancel={() => setEditing(null)}
                    onDone={() => {
                      setEditing(null);
                      register.reload();
                    }}
                  />
                </>
              )}

              <h2>Open and in progress</h2>
              <RiskTable risks={active} onEdit={(risk) => setEditing({ mode: "edit", risk })} />

              <h2>Accepted risks</h2>
              {accepted.length ? (
                <div className="cy-table-wrap">
                  <table className="cy-table">
                    <thead>
                      <tr>
                        <th>Risk</th>
                        <th>Owner</th>
                        <th>Accepted until</th>
                        <th>Notes</th>
                        <th className="cy-no-print" />
                      </tr>
                    </thead>
                    <tbody>
                      {accepted.map((r) => {
                        const expired = !!r.acceptedExpiry && r.acceptedExpiry < new Date().toISOString().slice(0, 10);
                        return (
                          <tr key={r.id}>
                            <td>{r.title}</td>
                            <td>{r.owner}</td>
                            <td>
                              {formatAsOf(r.acceptedExpiry)}
                              {expired && <div className="cy-delta is-worse">Expired: review</div>}
                            </td>
                            <td>{r.notes}</td>
                            <td className="cy-no-print">
                              <button
                                type="button"
                                className="cy-btn is-secondary"
                                style={{ marginTop: 0 }}
                                onClick={() => setEditing({ mode: "edit", risk: r })}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="cy-empty">No accepted risks.</div>
              )}

              {closed.length > 0 && (
                <>
                  <h2>Closed</h2>
                  <RiskTable risks={closed} onEdit={(risk) => setEditing({ mode: "edit", risk })} />
                </>
              )}
            </>
          );
        }}
      </CyberLoadView>
    </main>
  );
}
