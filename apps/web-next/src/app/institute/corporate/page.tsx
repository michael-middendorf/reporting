"use client";

import { useMemo, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { INSTITUTE_NAV } from "@/lib/report-nav";
import {
  type AnnualTargets,
  type KpiSummaryCard,
  COMPANIES_DATA,
  DEFAULT_ANNUAL_TARGETS,
  DELIVERY_PIPELINE_SNAPSHOTS,
  exportCompaniesToCsv,
  exportOpportunitiesToCsv,
  formatCurrency,
  HISTORICAL_FUNDING,
  MEETING_REFERENCE,
  OPPORTUNITIES_DATA,
  OUTREACH_STATS,
  RELATIONSHIP_PIPELINE_SNAPSHOTS,
  computeKpiCards,
} from "@/lib/reports/institute/corporate-model";
import "@/styles/institute.css";
import "@/styles/institute-corporate.css";

const TARGETS_STORAGE_KEY = "amu_institute_ce_targets_v1";

function loadInitialTargets(): AnnualTargets {
  if (typeof window === "undefined") return DEFAULT_ANNUAL_TARGETS;
  try {
    const stored = window.localStorage.getItem(TARGETS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AnnualTargets>;
      return { ...DEFAULT_ANNUAL_TARGETS, ...parsed };
    }
  } catch {
    // Ignore localStorage errors
  }
  return DEFAULT_ANNUAL_TARGETS;
}

export default function CorporateEngagementPage() {
  return (
    <AccessGate report="institute">
      <CorporateEngagementContent />
    </AccessGate>
  );
}

function CorporateEngagementContent() {
  const [activeTab, setActiveTab] = useState<"kpis" | "relationship" | "opportunities" | "reference">("kpis");
  const [timeframe, setTimeframe] = useState<"week" | "month" | "ytd">("ytd");
  const [weekIdx, setWeekIdx] = useState<number>(HISTORICAL_FUNDING.length - 1);
  const [selectedKpi, setSelectedKpi] = useState<KpiSummaryCard | null>(null);
  const [selectedStage, setSelectedStage] = useState<string>("All");
  const [companySearch, setCompanySearch] = useState<string>("");
  const [oppCategory, setOppCategory] = useState<string>("All");
  const [showTargetModal, setShowTargetModal] = useState<boolean>(false);
  const [targets, setTargets] = useState<AnnualTargets>(loadInitialTargets);
  const [tempTargets, setTempTargets] = useState<AnnualTargets>(loadInitialTargets);

  const saveTargets = () => {
    setTargets(tempTargets);
    try {
      localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(tempTargets));
    } catch {
      // Ignore localStorage errors
    }
    setShowTargetModal(false);
  };

  const resetTargets = () => {
    setTempTargets(DEFAULT_ANNUAL_TARGETS);
    setTargets(DEFAULT_ANNUAL_TARGETS);
    try {
      localStorage.removeItem(TARGETS_STORAGE_KEY);
    } catch {
      // Ignore localStorage errors
    }
    setShowTargetModal(false);
  };

  const kpiCards = useMemo(
    () => computeKpiCards(timeframe, weekIdx, targets),
    [timeframe, weekIdx, targets],
  );

  const currentSnapshotKey = "2026-06-15";
  const relationshipStages = RELATIONSHIP_PIPELINE_SNAPSHOTS[currentSnapshotKey] || [];
  const deliveryStages = DELIVERY_PIPELINE_SNAPSHOTS[currentSnapshotKey] || [];

  const filteredCompanies = useMemo(() => {
    return COMPANIES_DATA.filter((comp) => {
      if (selectedStage !== "All" && comp.stage !== selectedStage) {
        return false;
      }
      if (companySearch.trim()) {
        const q = companySearch.toLowerCase();
        const matchesName = comp.name.toLowerCase().includes(q);
        const matchesInd = comp.industry.toLowerCase().includes(q);
        const matchesCity = comp.headquartersCity.toLowerCase().includes(q);
        const matchesRel = comp.instituteRelationship.toLowerCase().includes(q);
        return matchesName || matchesInd || matchesCity || matchesRel;
      }
      return true;
    });
  }, [selectedStage, companySearch]);

  const filteredOpportunities = useMemo(() => {
    return OPPORTUNITIES_DATA.filter((opp) => {
      if (oppCategory !== "All" && opp.category !== oppCategory) {
        return false;
      }
      return true;
    });
  }, [oppCategory]);

  const handleDownloadCompanies = () => {
    const csv = exportCompaniesToCsv(filteredCompanies);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `corporate-engagement-companies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadOpportunities = () => {
    const csv = exportOpportunitiesToCsv(filteredOpportunities);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `corporate-engagement-opportunities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="institute-root">
      <ReportTopBar
        title="The Institute: Corporate Engagement"
        nav={INSTITUTE_NAV}
        actions={
          <button
            type="button"
            className="rc-btn"
            onClick={() => setShowTargetModal(true)}
          >
            Edit Annual Targets
          </button>
        }
      />

      <header className="top">
        <div className="wrap">
          <div className="brand">
            <div>
              <div className="mark">THE</div>
              <h1>INSTITUTE</h1>
              <div className="tag">Ave Maria University: Corporate Engagement & KPI Dashboard</div>
            </div>
          </div>
          <div className="meta">
            <div>
              <strong>Department:</strong> The Institute (Corporate Engagement)
            </div>
            <div>
              <strong>Tasks:</strong> DST-910 / DST-28
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Sub-bar */}
      <div className="ce-header-bar">
        <div className="ce-subnav">
          <button
            type="button"
            className={`ce-subnav-btn ${activeTab === "kpis" ? "active" : ""}`}
            onClick={() => setActiveTab("kpis")}
          >
            KPI Dashboard
          </button>
          <button
            type="button"
            className={`ce-subnav-btn ${activeTab === "relationship" ? "active" : ""}`}
            onClick={() => setActiveTab("relationship")}
          >
            Company Relationship Pipeline
          </button>
          <button
            type="button"
            className={`ce-subnav-btn ${activeTab === "opportunities" ? "active" : ""}`}
            onClick={() => setActiveTab("opportunities")}
          >
            Opportunity Tracking
          </button>
          <button
            type="button"
            className={`ce-subnav-btn ${activeTab === "reference" ? "active" : ""}`}
            onClick={() => setActiveTab("reference")}
          >
            Weekly Meeting Reference
          </button>
        </div>

        <div className="ce-controls">
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
            Timeframe:
          </label>
          <select
            className="ce-select"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as "week" | "month" | "ytd")}
          >
            <option value="week">Current Week</option>
            <option value="month">Current Month (4 Wks)</option>
            <option value="ytd">Year to Date (YTD)</option>
          </select>

          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
            As Of Week:
          </label>
          <select
            className="ce-select"
            value={weekIdx}
            onChange={(e) => setWeekIdx(Number(e.target.value))}
          >
            {HISTORICAL_FUNDING.map((w, idx) => (
              <option key={w.weekEnding} value={idx}>
                {w.weekEnding} (Wk {idx + 1})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="body">
        {/* ==================== 1. KPI DASHBOARD ==================== */}
        {activeTab === "kpis" && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h2 style={{ margin: "0 0 4px 0", color: "var(--navy)", fontSize: 20 }}>
                    Corporate Engagement KPIs ({timeframe.toUpperCase()})
                  </h2>
                  <p className="muted" style={{ margin: 0 }}>
                    Tracking targets, actuals, and pacing for the Institute Corporate Engagement team. Click any card to see data details.
                  </p>
                </div>
              </div>
            </div>

            <div className="ce-kpi-grid">
              {kpiCards.map((card) => {
                const pct = card.targetValue > 0 ? Math.min(100, Math.round((card.actualValue / card.targetValue) * 100)) : 100;
                return (
                  <div
                    key={card.id}
                    className="ce-kpi-card"
                    onClick={() => setSelectedKpi(card)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSelectedKpi(card);
                    }}
                  >
                    <div className="ce-kpi-header">
                      <div className="ce-kpi-title">{card.title}</div>
                      <span className={`ce-badge ${card.status}`}>
                        {card.status === "on-target" ? "On Target" : "Behind"}
                      </span>
                    </div>

                    <div className="ce-kpi-val">
                      {card.unit === "currency" ? formatCurrency(card.actualValue) : card.actualValue.toLocaleString()}
                    </div>

                    <div className="ce-kpi-sub">
                      <span>Target: {card.unit === "currency" ? formatCurrency(card.targetValue) : card.targetValue.toLocaleString()}</span>
                      <span>
                        Var: {card.variance >= 0 ? "+" : ""}
                        {card.unit === "currency" ? formatCurrency(card.variance) : card.variance.toLocaleString()}
                      </span>
                    </div>

                    <div className="ce-progress-bar">
                      <div
                        className={`ce-progress-fill ${card.status}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="ce-kpi-foot">
                      <span>{card.goalLabel}</span>
                      <span style={{ color: "var(--teal)", fontWeight: 600 }}>View Data &rarr;</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pacing Table */}
            <div className="card tablecard" style={{ marginTop: 24 }}>
              <div className="thead-row">
                <h3>Historical Pacing: Weekly Revenue &amp; Cases (Adaptive Dept 6181 &amp; 3012)</h3>
              </div>
              <div className="tbl-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Week Ending</th>
                      <th className="num">High School Target</th>
                      <th className="num">High School Actual</th>
                      <th className="num">Individual Target</th>
                      <th className="num">Individual Actual</th>
                      <th className="num">Org Target</th>
                      <th className="num">Org Actual</th>
                      <th className="num">Cum. Target</th>
                      <th className="num">Cum. Actual</th>
                      <th className="num">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {HISTORICAL_FUNDING.map((row, idx) => (
                      <tr key={row.weekEnding} style={idx === weekIdx ? { background: "#eef7f6", fontWeight: 600 } : undefined}>
                        <td>{row.weekEnding} {idx === weekIdx ? "(Selected)" : ""}</td>
                        <td className="num">{formatCurrency(row.targetHighSchool)}</td>
                        <td className="num">{row.actualHighSchool != null ? formatCurrency(row.actualHighSchool) : "-"}</td>
                        <td className="num">{formatCurrency(row.targetIndividual)}</td>
                        <td className="num">{row.actualIndividual != null ? formatCurrency(row.actualIndividual) : "-"}</td>
                        <td className="num">{formatCurrency(row.targetOrganization)}</td>
                        <td className="num">{row.actualOrganization != null ? formatCurrency(row.actualOrganization) : "-"}</td>
                        <td className="num">{formatCurrency(row.cumTarget)}</td>
                        <td className="num">{row.cumActual != null ? formatCurrency(row.cumActual) : "-"}</td>
                        <td className="num" style={{ color: (row.variance || 0) >= 0 ? "var(--green)" : "#dc3545" }}>
                          {row.variance != null ? `${(row.variance >= 0 ? "+" : "")}${formatCurrency(row.variance)}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 2. COMPANY RELATIONSHIP PIPELINE ==================== */}
        {activeTab === "relationship" && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ margin: "0 0 4px 0", color: "var(--navy)", fontSize: 20 }}>
                Company Relationship Pipeline (7-Stage Deal Funnel)
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                Data source: HubSpot &quot;Company Relationship&quot; Deal Pipeline. Click any stage to filter companies below.
              </p>
            </div>

            {/* Funnel Row */}
            <div className="ce-funnel-row">
              <div
                className={`ce-stage-card ${selectedStage === "All" ? "selected" : ""}`}
                onClick={() => setSelectedStage("All")}
              >
                <div className="ce-stage-name">All Deals</div>
                <div className="ce-stage-count">{COMPANIES_DATA.length}</div>
                <div className="ce-stage-net zero">Total active</div>
              </div>

              {relationshipStages.map((st) => (
                <div
                  key={st.stage}
                  className={`ce-stage-card ${selectedStage === st.stage ? "selected" : ""}`}
                  onClick={() => setSelectedStage(st.stage)}
                >
                  <div className="ce-stage-name">{st.stage}</div>
                  <div className="ce-stage-count">{st.total}</div>
                  <div className={`ce-stage-net ${st.netChange > 0 ? "pos" : st.netChange < 0 ? "neg" : "zero"}`}>
                    {st.netChange > 0 ? `+${st.netChange}` : st.netChange} net wk
                  </div>
                </div>
              ))}
            </div>

            {/* Company Table Window */}
            <div className="card tablecard">
              <div className="thead-row">
                <div>
                  <h3>
                    Companies in Pipeline {selectedStage !== "All" ? `: ${selectedStage}` : ": All Stages"}
                    <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
                      ({filteredCompanies.length} companies)
                    </span>
                  </h3>
                </div>
                <div className="thead-actions">
                  <input
                    type="search"
                    placeholder="Search company, industry, city..."
                    value={companySearch}
                    onChange={(e) => setCompanySearch(e.target.value)}
                    style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                  <button type="button" className="ce-btn" onClick={handleDownloadCompanies}>
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="tbl-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Stage</th>
                      <th>Headquarters</th>
                      <th>Relationship</th>
                      <th className="num">$$ Given</th>
                      <th>Students (App / Int / Hire)</th>
                      <th>Alumni Working There</th>
                      <th>AMU Vendor</th>
                      <th>Completed Opps</th>
                      <th>Events (Attended / Sponsored)</th>
                      <th>Recent Touchpoint</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompanies.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.name}</strong>
                          <div className="muted" style={{ fontSize: 12 }}>{c.industry}</div>
                        </td>
                        <td>
                          <span className="pill" style={{ background: "#eef2f6", fontWeight: 600 }}>
                            {c.stage}
                          </span>
                        </td>
                        <td>{c.headquartersCity}, {c.headquartersState}</td>
                        <td>{c.instituteRelationship}</td>
                        <td className="num">{c.fundingGiven > 0 ? formatCurrency(c.fundingGiven) : "-"}</td>
                        <td>
                          {c.studentsApplied} applied · {c.studentsInterviewed} int · <strong>{c.studentsHired} hired</strong>
                        </td>
                        <td style={{ fontSize: 12 }}>{c.alumniWorking}</td>
                        <td>{c.amuVendor}</td>
                        <td>{c.completedOpportunities}</td>
                        <td style={{ fontSize: 12 }}>
                          <div>Attended: {c.eventsAttended}</div>
                          <div className="muted">Sponsored: {c.eventsSponsored}</div>
                        </td>
                        <td style={{ fontSize: 12 }}>{c.lastCommunication}</td>
                      </tr>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: 24 }} className="muted">
                          No companies found matching the current stage or search filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Third Window: Communications & Heatmap Distribution */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 20, marginTop: 24 }}>
              <div className="card">
                <h3>Pipeline Communications by Deal Stage</h3>
                <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  Standard communication cadences and active sequences tied to deal stages.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="ce-meeting-card">
                    <h4>Lead: New Business Cold Call Playbook</h4>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                      Initial target company identification and qualification call sequence.
                    </p>
                  </div>
                  <div className="ce-meeting-card">
                    <h4>Contact: Qualified New Business Sequence</h4>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                      Multi-touch email sequence + follow-up call to schedule Discovery.
                    </p>
                  </div>
                  <div className="ce-meeting-card">
                    <h4>Discovery: Corporate Exploration Playbook</h4>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                      45-minute discovery call exploring talent recruitment, project cases, and sponsorships.
                    </p>
                  </div>
                  <div className="ce-meeting-card">
                    <h4>Opportunity &amp; Sponsorship: Action Items &amp; Agreement</h4>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                      Partnership scope proposal, formal invoicing, and website logo onboarding.
                    </p>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>Headquarters Geographic Distribution</h3>
                <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  Headquarters location concentration for corporate partners.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#f8fafc", borderRadius: 6 }}>
                    <span><strong>Florida (FL)</strong>: Southwest Florida &amp; Regional</span>
                    <span className="pill" style={{ background: "var(--teal)", color: "#fff" }}>11 companies (78%)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#f8fafc", borderRadius: 6 }}>
                    <span><strong>Texas (TX)</strong>: Dallas &amp; Irving</span>
                    <span className="pill" style={{ background: "var(--teal)", color: "#fff" }}>2 companies (14%)</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#f8fafc", borderRadius: 6 }}>
                    <span><strong>Illinois (IL)</strong>: Chicago Metro</span>
                    <span className="pill" style={{ background: "var(--teal)", color: "#fff" }}>1 company (8%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 3. OPPORTUNITY TRACKING PIPELINE ==================== */}
        {activeTab === "opportunities" && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ margin: "0 0 4px 0", color: "var(--navy)", fontSize: 20 }}>
                Opportunity Tracking Pipeline (HubSpot Delivery Pipeline)
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                Delivery stages and scope across Talent, Project Solutions, and Employer Platform.
              </p>
            </div>

            {/* Stage Summary Cards */}
            <div className="ce-funnel-row">
              {deliveryStages.map((dst) => (
                <div key={dst.stage} className="card" style={{ padding: 16 }}>
                  <div className="ce-stage-name">{dst.stage}</div>
                  <div className="ce-stage-count" style={{ marginBottom: 8 }}>{dst.total}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                    {dst.breakdown.map((b) => (
                      <div key={b.category} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{b.category}:</span>
                        <strong>{b.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Opportunity Records Table */}
            <div className="card tablecard" style={{ marginTop: 20 }}>
              <div className="thead-row">
                <div>
                  <h3>Opportunity Records Behind Stages</h3>
                </div>
                <div className="thead-actions">
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Category:</label>
                    <select
                      className="ce-select"
                      value={oppCategory}
                      onChange={(e) => setOppCategory(e.target.value)}
                    >
                      <option value="All">All Categories</option>
                      <option value="Talent">Talent</option>
                      <option value="Solutions">Solutions</option>
                      <option value="Platform">Platform</option>
                    </select>
                  </div>
                  <button type="button" className="ce-btn" onClick={handleDownloadOpportunities}>
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="tbl-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Opportunity Type</th>
                      <th>Company</th>
                      <th>Category</th>
                      <th>Pipeline Stage</th>
                      <th>Status</th>
                      <th>Owner</th>
                      <th>Due Date</th>
                      <th>Scope Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOpportunities.map((o) => (
                      <tr key={o.id}>
                        <td><code>{o.id}</code></td>
                        <td><strong>{o.type}</strong></td>
                        <td>{o.company}</td>
                        <td>
                          <span className="pill" style={{ background: "#eef2f6" }}>{o.category}</span>
                        </td>
                        <td>
                          <span className="pill" style={{ background: "var(--teal)", color: "#fff" }}>
                            {o.stage}
                          </span>
                        </td>
                        <td>{o.status}</td>
                        <td>{o.owner}</td>
                        <td>{o.dueDate}</td>
                        <td style={{ fontSize: 12 }}>{o.scope}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 4. WEEKLY MEETING REFERENCE ==================== */}
        {activeTab === "reference" && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ margin: "0 0 4px 0", color: "var(--navy)", fontSize: 20 }}>
                Weekly KPI Meeting Reference Guide (Overview Cadence)
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                Reference workflow for the Corporate Engagement team weekly review and priority execution items.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20 }}>
              {/* Meeting Cadence */}
              <div className="card">
                <h3>Meeting Cadence &amp; Operating Rhythm</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
                  {MEETING_REFERENCE.cadence.map((m) => (
                    <div key={m.title} className="ce-meeting-card">
                      <h4>{m.title}</h4>
                      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{m.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rally Cry Action Items */}
              <div className="card">
                <h3>Rally Cry: Active Priority Execution</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                  {MEETING_REFERENCE.rallyCry.map((rc) => (
                    <div key={rc.id} className="ce-rally-item">
                      <div>
                        <strong>{rc.text}</strong>
                      </div>
                      <span className="pill" style={{ background: rc.status === "Completed" ? "#e6f7ef" : "#fef3c7", color: rc.status === "Completed" ? "#157347" : "#b45309", fontWeight: 600 }}>
                        {rc.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Weekly Outreach Stats */}
            <div className="card tablecard" style={{ marginTop: 24 }}>
              <div className="thead-row">
                <h3>Weekly Outreach Activity Stats (HubSpot Playbooks &amp; Sequences)</h3>
              </div>
              <div className="tbl-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Outreach Playbook / Sequence</th>
                      <th className="num">Wk 1 (May 10)</th>
                      <th className="num">Wk 2 (May 17)</th>
                      <th className="num">Wk 3 (May 24)</th>
                      <th className="num">Wk 4 (May 31)</th>
                      <th className="num">Wk 5 (Jun 07)</th>
                      <th className="num">Wk 6 (Jun 14)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OUTREACH_STATS.map((s) => (
                      <tr key={s.activity}>
                        <td><strong>{s.activity}</strong></td>
                        {s.counts.map((cnt, i) => (
                          <td key={i} className="num">{cnt}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Target Numbers Editor Modal */}
      {showTargetModal && (
        <div className="ce-modal-overlay" onClick={() => setShowTargetModal(false)}>
          <div className="ce-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ce-modal-header">
              <h3>Update Annual KPI Targets</h3>
              <button
                type="button"
                className="ce-close-btn"
                onClick={() => setShowTargetModal(false)}
              >
                &times;
              </button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
              Adjust annual target numbers for the Corporate Engagement team. Weekly and cumulative targets will automatically recalculate across the fiscal year.
            </p>

            <div className="ce-form-group">
              <label>Corporate Funding Target ($ Annual)</label>
              <input
                type="number"
                value={tempTargets.funding}
                onChange={(e) => setTempTargets({ ...tempTargets, funding: Number(e.target.value) })}
              />
            </div>

            <div className="ce-form-group">
              <label>New Corporate Sponsors Target</label>
              <input
                type="number"
                value={tempTargets.sponsors}
                onChange={(e) => setTempTargets({ ...tempTargets, sponsors: Number(e.target.value) })}
              />
            </div>

            <div className="ce-form-group">
              <label>Total Opportunities Target</label>
              <input
                type="number"
                value={tempTargets.opportunities}
                onChange={(e) => setTempTargets({ ...tempTargets, opportunities: Number(e.target.value) })}
              />
            </div>

            <div className="ce-form-group">
              <label>Internships Target</label>
              <input
                type="number"
                value={tempTargets.internships}
                onChange={(e) => setTempTargets({ ...tempTargets, internships: Number(e.target.value) })}
              />
            </div>

            <div className="ce-form-group">
              <label>Full-time Jobs Target</label>
              <input
                type="number"
                value={tempTargets.fullTimeJobs}
                onChange={(e) => setTempTargets({ ...tempTargets, fullTimeJobs: Number(e.target.value) })}
              />
            </div>

            <div className="ce-form-group">
              <label>Project Solutions Target (Cases)</label>
              <input
                type="number"
                value={tempTargets.projectSolutions}
                onChange={(e) => setTempTargets({ ...tempTargets, projectSolutions: Number(e.target.value) })}
              />
            </div>

            <div className="ce-form-group">
              <label>New Advisors Target</label>
              <input
                type="number"
                value={tempTargets.advisors}
                onChange={(e) => setTempTargets({ ...tempTargets, advisors: Number(e.target.value) })}
              />
            </div>

            <div className="ce-modal-actions">
              <button type="button" className="ce-btn" onClick={resetTargets}>
                Reset to Defaults
              </button>
              <button type="button" className="ce-btn primary" onClick={saveTargets}>
                Save Targets
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPI Details Drawer / Modal */}
      {selectedKpi && (
        <div className="ce-modal-overlay" onClick={() => setSelectedKpi(null)}>
          <div className="ce-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ce-modal-header">
              <h3>{selectedKpi.title}: Details Behind the Number</h3>
              <button
                type="button"
                className="ce-close-btn"
                onClick={() => setSelectedKpi(null)}
              >
                &times;
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Current Actual ({timeframe.toUpperCase()})</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--navy)" }}>
                  {selectedKpi.unit === "currency" ? formatCurrency(selectedKpi.actualValue) : selectedKpi.actualValue.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Pacing Target</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>
                  {selectedKpi.unit === "currency" ? formatCurrency(selectedKpi.targetValue) : selectedKpi.targetValue.toLocaleString()}
                </div>
              </div>
              <div>
                <span className={`ce-badge ${selectedKpi.status}`} style={{ fontSize: 13, padding: "6px 12px" }}>
                  {selectedKpi.status === "on-target" ? "On Target" : "Behind"}
                </span>
              </div>
            </div>

            <div style={{ background: "#f8fafc", padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
              <strong>Data Source:</strong> {selectedKpi.dataSource}
            </div>

            <h4 style={{ margin: "16px 0 8px 0" }}>Category Breakdown</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {selectedKpi.details.map((d) => (
                <div
                  key={d.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                  }}
                >
                  <span><strong>{d.label}</strong></span>
                  <span>
                    Actual: {selectedKpi.unit === "currency" ? formatCurrency(d.actual) : d.actual.toLocaleString()}
                    {" "}(Target: {selectedKpi.unit === "currency" ? formatCurrency(d.target) : d.target.toLocaleString()})
                  </span>
                </div>
              ))}
            </div>

            <div className="ce-modal-actions">
              <button type="button" className="ce-btn" onClick={() => setSelectedKpi(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
