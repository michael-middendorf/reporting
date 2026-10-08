"use client";

import {
  CyberLoadView,
  EmptyState,
  KpiGrid,
  formatAsOf,
  manualToKpi,
  useCyberData,
  useCyberRegister,
} from "@/components/cyber/CyberUi";
import { RiskHeatmap, RiskTable, openRisks } from "@/components/cyber/RiskViews";
import { riskScore } from "@/lib/cyber/register";
import { CYBER_SECTIONS, SECTION_LABELS, kpisForSection } from "@/lib/cyber/shape";

/**
 * One print-styled page for the board (Print, then Save as PDF). Serves as
 * the annual written report to the board under 16 CFR 314.4(i) once the
 * Qualified Individual signs off on it.
 */
export default function BoardPacketPage() {
  const data = useCyberData();
  const register = useCyberRegister();
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });

  return (
    <main className="cy">
      <div className="cy-no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <p className="cy-sub" style={{ margin: 0 }}>
          Print this page and choose Save as PDF. The report bar and buttons are hidden in print.
        </p>
        <button type="button" className="cy-btn" style={{ marginTop: 0 }} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <section className="cy-section">
        <h1>Ave Maria University: Information Security Report to the Board</h1>
        <p className="cy-sub">
          Prepared {today}. Confidential: board use only. Counts and statuses only; no personal information.
        </p>
        <h2>Scorecard</h2>
        <CyberLoadView load={data}>
          {(d) => {
            const kpis = kpisForSection(d.snapshot, "overview");
            return (
              <>
                <p className="cy-sub">Data as of {formatAsOf(d.snapshot.generatedAt)}.</p>
                {kpis.length ? <KpiGrid kpis={kpis} /> : <EmptyState />}
                {d.snapshot.changes && d.snapshot.changes.length > 0 && (
                  <>
                    <h2>Changes since the last meeting</h2>
                    <ul className="cy-list">
                      {d.snapshot.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            );
          }}
        </CyberLoadView>
      </section>

      <section className="cy-section">
        <h2>Risk register</h2>
        <CyberLoadView load={register}>
          {(d) => {
            const active = openRisks(d.risks).sort((a, b) => riskScore(b) - riskScore(a));
            const accepted = d.risks.filter((r) => r.status === "accepted");
            return (
              <>
                <RiskHeatmap risks={d.risks} />
                <h2>Open and in progress ({active.length})</h2>
                <RiskTable risks={active} compact />
                <h2>Accepted ({accepted.length})</h2>
                <RiskTable risks={accepted} compact />
                {d.kpis.length > 0 && (
                  <>
                    <h2>Program and manual measures</h2>
                    <KpiGrid kpis={d.kpis.map(manualToKpi)} />
                  </>
                )}
              </>
            );
          }}
        </CyberLoadView>
      </section>

      {data.kind === "ok" && (
        (() => {
          const d = data.data;
          return (
          <>
            {CYBER_SECTIONS.filter((s) => s !== "overview").map((s) => {
              const kpis = kpisForSection(d.snapshot, s);
              if (!kpis.length) return null;
              return (
                <section key={s} className="cy-section">
                  <h2>{SECTION_LABELS[s]}</h2>
                  <KpiGrid kpis={kpis} />
                </section>
              );
            })}
            {d.history.length > 0 && (
              <p className="cy-sub">Trend snapshots on file: {d.history.length} (latest {d.history[0]}).</p>
            )}
          </>
          );
        })()
      )}
    </main>
  );
}
