
export async function bootAlumni() {
  const state = {
    activeCohortTab: "class_year",
    filters: {
      search: "",
      classYear: "",
      decade: "",
      donorRecency: "",
      opportunity: "",
      assignment: "",
    },
  };

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const monthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
  });

  let data;

  try {
    data = await loadData();
    renderMeta(data.metadata);
    renderSummary(data.summary);
    renderDecisionCharts(data.trends);
    renderActivityCharts(data.trends);
    renderCohortTable();
    renderLeaders(data.leaders);
    setupFilters(data.details);
    setupTabs();
    renderDetailTable();
  } catch (error) {
    console.error(error);
    document.querySelector(".layout").innerHTML = `
      <section class="panel wide">
        <div class="empty-state">
          Failed to load report artifacts. Run the pipeline first with
          <code>python3 -m virt_reporting sync bootstrap</code>.
        </div>
      </section>
    `;
  }

  async function loadData() {
    const [metadata, summary, trends, cohorts, leaders, details] = await Promise.all([
      fetchJson("data/metadata.json"),
      fetchJson("data/summary.json"),
      fetchJson("data/trends.json"),
      fetchJson("data/cohorts.json"),
      fetchJson("data/leaders.json"),
      fetchJson("data/detail_index.json"),
    ]);
    return { metadata, summary, trends, cohorts, leaders, details };
  }

  async function fetchJson(path) {
    const rel = String(path || "").replace(/^data\//, "");
    const response = await fetch(`/api/reports/alumni/${rel}`);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }
    return response.json();
  }

  function renderMeta(metadata) {
    document.getElementById("generated-at").textContent =
      metadata.generated_at_display || formatDateTime(metadata.generated_at);
    document.getElementById("sync-mode").textContent = capitalize(metadata.mode || "unknown");
    document.getElementById("runtime-seconds").textContent = `${metadata.runtime_seconds ?? "?"}s`;
  }

  function renderSummary(summary) {
    const host = document.getElementById("summary-cards");
    host.innerHTML = "";
    for (const card of summary.cards || []) {
      const node = document.createElement("a");
      node.className = "metric-card metric-card-link";
      node.href = buildDrilldownUrl(summaryCardDrilldownSpec(card));
      node.innerHTML = `
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(String(card.value))}</strong>
        <div class="metric-subtext">${escapeHtml(card.context || "")}</div>
        <div class="metric-link-text">View alumni list</div>
      `;
      host.appendChild(node);
    }
  }

  function renderDecisionCharts(trends) {
    renderHorizontalBarChart(
      "donor-recency-chart",
      trends.donor_recency_distribution.labels,
      trends.donor_recency_distribution.values,
      (value) => `${value} contacts`,
      (label) => buildDrilldownUrl({
        title: `Donor Recency: ${label}`,
        predicates: [{ kind: "eq", key: "donor_recency_bucket", value: label }],
      }),
    );
    renderHorizontalBarChart(
      "opportunity-chart",
      trends.opportunity_distribution.labels,
      trends.opportunity_distribution.values,
      (value) => `${value} contacts`,
      (label) => buildDrilldownUrl({
        title: `Opportunity: ${label}`,
        predicates: [{ kind: "eq", key: "opportunity_bucket", value: label }],
      }),
    );
  }

  function renderActivityCharts(trends) {
    renderColumnChart(
      "gift-amounts-chart",
      trends.months,
      trends.monthly_gift_amounts.map(Number),
      (value) => currency.format(value || 0),
      "rgba(143, 45, 31, 0.82)",
      (label) => buildDrilldownUrl({
        title: `Gifts in ${formatMonthYearLabel(label)}`,
        segmentKey: `monthly_gift:${label}`,
        predicates: [],
      }),
    );
    renderColumnChart(
      "touched-contacts-chart",
      trends.months,
      trends.monthly_touched_contacts.map(Number),
      (value) => `${value} contacts`,
      "rgba(60, 112, 82, 0.84)",
      (label) => buildDrilldownUrl({
        title: `Touched alumni in ${formatMonthYearLabel(label)}`,
        segmentKey: `monthly_touch:${label}`,
        predicates: [],
      }),
    );
  }

  function renderColumnChart(hostId, labels, values, formatter, fill, linkBuilder = null) {
    const host = document.getElementById(hostId);
    const width = 720;
    const height = 244;
    const padding = { top: 16, right: 18, bottom: 52, left: 18 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(1, ...values);
    const barWidth = innerWidth / Math.max(1, values.length);
    const bars = values.map((value, index) => {
      const barHeight = (value / maxValue) * innerHeight;
      const x = padding.left + index * barWidth + 3;
      const y = padding.top + innerHeight - barHeight;
      const rect = `<rect x="${x}" y="${y}" width="${Math.max(barWidth - 6, 4)}" height="${barHeight}" rx="6" fill="${fill}"></rect>`;
      const href = linkBuilder && value ? linkBuilder(labels[index], value, index) : "";
      return href ? `<a href="${escapeHtml(href)}" class="chart-link">${rect}</a>` : rect;
    }).join("");
    const ticks = [0, 0.5, 1].map((ratio) => {
      const y = padding.top + innerHeight - innerHeight * ratio;
      return `<line x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}" stroke="rgba(23,38,31,0.1)" stroke-width="1"></line>`;
    }).join("");
    const labelTicks = labels.map((label, index) => {
      const x = padding.left + index * barWidth + barWidth / 2;
      return `
        <text
          x="${x}"
          y="${height - 10}"
          text-anchor="middle"
          font-size="11"
          fill="#55665a"
        >${escapeHtml(formatMonthLabel(label))}</text>
      `;
    }).join("");
    host.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${hostId}">
        ${ticks}
        ${bars}
        ${labelTicks}
        <text x="${width - padding.right}" y="${padding.top + 4}" text-anchor="end" font-size="12" fill="#17261f">${escapeHtml(formatter(maxValue))}</text>
      </svg>
    `;
  }

  function renderHorizontalBarChart(hostId, labels, values, formatter, linkBuilder = null) {
    const host = document.getElementById(hostId);
    const longestLabel = labels.reduce((max, label) => Math.max(max, String(label).length), 0);
    const padding = {
      top: 16,
      right: 108,
      bottom: 12,
      left: Math.max(220, longestLabel * 7 + 28),
    };
    const width = Math.max(780, padding.left + padding.right + 340);
    const rowHeight = 28;
    const height = Math.max(180, labels.length * rowHeight + padding.top + padding.bottom);
    const innerWidth = width - padding.left - padding.right;
    const maxValue = Math.max(1, ...values);
    const rows = labels.map((label, index) => {
      const y = padding.top + index * rowHeight;
      const barWidth = (values[index] / maxValue) * innerWidth;
      const content = `
        <text x="${padding.left - 10}" y="${y + 14}" text-anchor="end" font-size="11" fill="#17261f">${escapeHtml(label)}</text>
        <rect x="${padding.left}" y="${y}" width="${barWidth}" height="18" rx="8" fill="rgba(214, 122, 81, 0.82)"></rect>
        <text x="${padding.left + Math.max(barWidth + 8, 8)}" y="${y + 14}" font-size="11" fill="#55665a">${escapeHtml(formatter(values[index]))}</text>
      `;
      const href = linkBuilder && values[index] ? linkBuilder(label, values[index], index) : "";
      return href ? `<a href="${escapeHtml(href)}" class="chart-link">${content}</a>` : content;
    }).join("");
    host.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${hostId}">
        ${rows}
      </svg>
    `;
  }

  function renderCohortTable() {
    const rows = data.cohorts[state.activeCohortTab] || [];
    const host = document.getElementById("cohort-table");
    if (!rows.length) {
      host.innerHTML = `<div class="empty-state">No cohort rows available.</div>`;
      return;
    }
    const body = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${renderCohortCell(row, "alumni_count", "Alumni")}</td>
        <td>${renderCohortCell(row, "lifetime_donor_count", "Lifetime Donors")}</td>
        <td>${renderCohortCell(row, "recent_donor_365_count", "Recent Donors 365")}</td>
        <td>${renderCohortCell(row, "touched_90_count", "Touched 90")}</td>
        <td>${renderCohortCell(row, "recent_donor_untouched_90_count", "Untouched Recent Donors")}</td>
        <td>${renderCohortCell(row, "assigned_count", "Assigned")}</td>
        <td>${renderCohortCell(row, "unassigned_count", "Unassigned")}</td>
      </tr>
    `).join("");
    host.innerHTML = `
      <table class="cohort-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Alumni</th>
            <th>Lifetime Donors</th>
            <th>Recent Donors 365</th>
            <th>Touched 90</th>
            <th>Untouched Recent Donors</th>
            <th>Assigned</th>
            <th>Unassigned</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function renderLeaders(leaders) {
    const groups = [
      ["Top Note Types (90 Days)", leaders.top_note_types_90],
      ["Top Note Creators (90 Days)", leaders.top_note_creators_90],
      ["Unassigned Recent Donor Decades", leaders.unassigned_recent_donor_decades],
      ["Recent Donor Solicitor Groups", leaders.recent_donor_solicitor_groups],
    ];
    const host = document.getElementById("leaders-grid");
    host.innerHTML = groups.map(([title, rows]) => `
      <article class="leader-card">
        <h3>${escapeHtml(title)}</h3>
        ${rows && rows.length ? `
          <table class="leader-list">
            <tbody>
              ${rows.map(([label, value]) => `
                <tr>
                  <td>${escapeHtml(label)}</td>
                  <td>${renderLeaderValue(title, label, value)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="empty-state">No data.</div>`}
      </article>
    `).join("");
  }

  function setupFilters(details) {
    populateSelect("class-year-filter", classYearOptions(details));
    populateSelect("decade-filter", uniqueValues(details, "decade"));
    populateSelect("donor-recency-filter", uniqueValues(details, "donor_recency_bucket"));
    populateSelect("opportunity-filter", uniqueValues(details, "opportunity_bucket"));
    populateSelect("assignment-filter", uniqueValues(details, "assignment_status"));

    document.getElementById("search-input").addEventListener("input", (event) => {
      state.filters.search = event.target.value.trim().toLowerCase();
      renderDetailTable();
    });
    document.getElementById("class-year-filter").addEventListener("change", (event) => {
      state.filters.classYear = event.target.value;
      renderDetailTable();
    });
    document.getElementById("decade-filter").addEventListener("change", (event) => {
      state.filters.decade = event.target.value;
      renderDetailTable();
    });
    document.getElementById("donor-recency-filter").addEventListener("change", (event) => {
      state.filters.donorRecency = event.target.value;
      renderDetailTable();
    });
    document.getElementById("opportunity-filter").addEventListener("change", (event) => {
      state.filters.opportunity = event.target.value;
      renderDetailTable();
    });
    document.getElementById("assignment-filter").addEventListener("change", (event) => {
      state.filters.assignment = event.target.value;
      renderDetailTable();
    });
  }

  function populateSelect(id, values) {
    const select = document.getElementById(id);
    select.innerHTML = `<option value="">All</option>${values.map((value) => `
      <option value="${escapeHtml(value)}">${escapeHtml(value)}</option>
    `).join("")}`;
  }

  function uniqueValues(details, key) {
    return [...new Set(details.map((row) => row[key]).filter(Boolean))].sort();
  }

  function classYearOptions(details) {
    return [...new Set(details.map(detailClassYearLabel).filter(Boolean))].sort((left, right) => {
      const leftYear = /^\d{4}$/.test(left) ? Number(left) : Number.POSITIVE_INFINITY;
      const rightYear = /^\d{4}$/.test(right) ? Number(right) : Number.POSITIVE_INFINITY;
      if (leftYear !== rightYear) {
        return leftYear - rightYear;
      }
      return left.localeCompare(right);
    });
  }

  function setupTabs() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab-button").forEach((candidate) => {
          candidate.classList.toggle("active", candidate === button);
        });
        state.activeCohortTab = button.dataset.tab;
        renderCohortTable();
      });
    });
  }

  function renderDetailTable() {
    const tbody = document.getElementById("detail-table");
    const filtered = applyFilters(data.details).slice(0, 300);
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">No rows match the current filters.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map((row) => `
      <tr>
        <td>${escapeHtml(row.full_name || "")}</td>
        <td>${escapeHtml(detailClassYearLabel(row))}</td>
        <td><span class="pill ${pillToneForRecency(row.donor_recency_bucket)}">${escapeHtml(row.donor_recency_bucket)}</span></td>
        <td>${row.touched_90_flag ? "Yes" : "No"}</td>
        <td>${row.assigned_flag ? "Yes" : "No"}</td>
        <td><span class="pill ${pillToneForOpportunity(row.opportunity_bucket)}">${escapeHtml(row.opportunity_bucket)}</span></td>
        <td>${formatDate(row.last_gift_date)}</td>
        <td>${currency.format(Number(row.life_to_date_giving || 0))}</td>
        <td>${currency.format(Number(row.year_to_date_giving || 0))}</td>
        <td>${formatDate(row.last_touch_date)}</td>
      </tr>
    `).join("");
  }

  function applyFilters(details) {
    return details.filter((row) => {
      if (state.filters.classYear && detailClassYearLabel(row) !== state.filters.classYear) {
        return false;
      }
      if (state.filters.decade && row.decade !== state.filters.decade) {
        return false;
      }
      if (state.filters.donorRecency && row.donor_recency_bucket !== state.filters.donorRecency) {
        return false;
      }
      if (state.filters.opportunity && row.opportunity_bucket !== state.filters.opportunity) {
        return false;
      }
      if (state.filters.assignment && row.assignment_status !== state.filters.assignment) {
        return false;
      }
      if (state.filters.search) {
        const haystack = [
          row.full_name,
          detailClassYearLabel(row),
          row.degree,
          row.major,
          row.assigned_solicitor_group,
          row.opportunity_bucket,
        ].join(" ").toLowerCase();
        if (!haystack.includes(state.filters.search)) {
          return false;
        }
      }
      return true;
    });
  }

  function pillToneForRecency(value) {
    if (value === "Gave in last 90 days") {
      return "cool";
    }
    if (value === "Gave in last 365 days") {
      return "warm";
    }
    if (value === "Never gave") {
      return "neutral";
    }
    return "alert";
  }

  function pillToneForOpportunity(value) {
    if (value.includes("untouched")) {
      return "alert";
    }
    if (value.includes("Recent donor, touched")) {
      return "cool";
    }
    if (value.includes("Never donor")) {
      return "neutral";
    }
    return "warm";
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function formatMonthLabel(value) {
    if (!value) {
      return "";
    }
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : monthFormatter.format(date);
  }

  function formatMonthYearLabel(value) {
    if (!value) {
      return "";
    }
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return `${monthFormatter.format(date)} ${date.getFullYear()}`;
  }

  function detailClassYearLabel(row) {
    return row.class_year || row.class_year_issue || row.raw_class_year || "";
  }

  function buildDrilldownUrl(spec) {
    const params = new URLSearchParams({ spec: JSON.stringify(spec) });
    return `/alumni/drilldown?${params.toString()}`;
  }

  function summaryCardDrilldownSpec(card) {
    const byId = {
      alumni_base: {
        title: "Alumni Base",
        predicates: [],
      },
      lifetime_donors: {
        title: "Lifetime Donors",
        predicates: [{ kind: "bool", key: "lifetime_donor_flag", value: true }],
      },
      ytd_donors: {
        title: "YTD Donors",
        predicates: [{ kind: "bool", key: "ytd_donor_flag", value: true }],
      },
      recent_donors_365: {
        title: "Recent Donors (365)",
        predicates: [{ kind: "bool", key: "recent_donor_365_flag", value: true }],
      },
      recent_donors_90: {
        title: "Recent Donors (90)",
        predicates: [{ kind: "bool", key: "recent_donor_90_flag", value: true }],
      },
      lapsed_donors_366_730: {
        title: "Lapsed Donors (366-730)",
        predicates: [{ kind: "bool", key: "lapsed_donor_366_730_flag", value: true }],
      },
      touched_90: {
        title: "Touched in 90 Days",
        predicates: [{ kind: "bool", key: "touched_90_flag", value: true }],
      },
      recent_donors_touched_90: {
        title: "Recent Donors Touched 90",
        predicates: [{ kind: "bool", key: "recent_donor_touched_90_flag", value: true }],
      },
      recent_donors_untouched_90: {
        title: "Recent Donors Untouched 90",
        predicates: [{ kind: "bool", key: "recent_donor_untouched_90_flag", value: true }],
      },
      assigned_recent_donors: {
        title: "Assigned Recent Donors",
        predicates: [{ kind: "bool", key: "recent_donor_assigned_flag", value: true }],
      },
      unassigned_recent_donors: {
        title: "Unassigned Recent Donors",
        predicates: [{ kind: "bool", key: "recent_donor_unassigned_flag", value: true }],
      },
      active_recurring: {
        title: "Active Recurring",
        predicates: [{ kind: "bool", key: "active_recurring_flag", value: true }],
      },
      planned_giving: {
        title: "Planned Giving",
        predicates: [{ kind: "bool", key: "planned_giving_flag", value: true }],
      },
    };
    return byId[card.id] || { title: card.label, predicates: [] };
  }

  function renderCohortCell(row, metricKey, metricLabel) {
    const spec = cohortDrilldownSpec(state.activeCohortTab, row, metricKey, metricLabel);
    return `<a class="drilldown-link" href="${escapeHtml(buildDrilldownUrl(spec))}">${row[metricKey]}</a>`;
  }

  function cohortDrilldownSpec(tabKey, row, metricKey, metricLabel) {
    const predicates = [];
    const detailField = cohortTabDetailField(tabKey);
    if (detailField) {
      predicates.push({ kind: "eq", key: detailField, value: row.label });
    }

    const metricPredicate = cohortMetricPredicate(metricKey);
    if (metricPredicate) {
      predicates.push(metricPredicate);
    }

    return {
      title: `${row.label} · ${metricLabel}`,
      predicates,
    };
  }

  function cohortTabDetailField(tabKey) {
    if (tabKey === "class_year") {
      return "cohort_label";
    }
    return tabKey;
  }

  function cohortMetricPredicate(metricKey) {
    const map = {
      lifetime_donor_count: { kind: "bool", key: "lifetime_donor_flag", value: true },
      recent_donor_365_count: { kind: "bool", key: "recent_donor_365_flag", value: true },
      touched_90_count: { kind: "bool", key: "touched_90_flag", value: true },
      recent_donor_untouched_90_count: { kind: "bool", key: "recent_donor_untouched_90_flag", value: true },
      assigned_count: { kind: "bool", key: "assigned_flag", value: true },
      unassigned_count: { kind: "bool", key: "assigned_flag", value: false },
    };
    return map[metricKey] || null;
  }

  function renderLeaderValue(groupTitle, label, value) {
    const spec = leaderDrilldownSpec(groupTitle, label);
    if (!spec || !value) {
      return `${value}`;
    }
    return `<a class="drilldown-link" href="${escapeHtml(buildDrilldownUrl(spec))}">${value}</a>`;
  }

  function leaderDrilldownSpec(groupTitle, label) {
    const byGroup = {
      "Top Note Types (90 Days)": {
        title: `Top Note Type (90 Days): ${label}`,
        segmentKey: `leader_note_type_90:${label}`,
        predicates: [],
      },
      "Top Note Creators (90 Days)": {
        title: `Top Note Creator (90 Days): ${label}`,
        segmentKey: `leader_note_creator_90:${label}`,
        predicates: [],
      },
      "Unassigned Recent Donor Decades": {
        title: `Unassigned Recent Donor Decade: ${label}`,
        segmentKey: `leader_unassigned_recent_donor_decade:${label}`,
        predicates: [],
      },
      "Recent Donor Solicitor Groups": {
        title: `Recent Donor Solicitor Group: ${label}`,
        segmentKey: `leader_recent_donor_solicitor_group:${label}`,
        predicates: [],
      },
    };
    return byGroup[groupTitle] || null;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }
}
