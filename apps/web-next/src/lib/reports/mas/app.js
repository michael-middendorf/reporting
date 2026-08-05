import {
  buildDrilldownUrl,
  currency,
  escapeHtml,
  loadBaseData,
  renderColumnChart,
  renderMeta,
} from "./shared.js";


export async function bootMas() {
  try {
    const data = await loadBaseData([
      ["metadata", "data/metadata.json"],
      ["scorecards", "data/scorecards.json"],
      ["trends", "data/trends.json"],
    ]);
    renderMeta(data.metadata);
    renderSummaryCards(data.scorecards);
    renderLeaderboard(data.scorecards);
    renderTypeMix(data.trends);
    renderMomentum(data.trends);
  } catch (error) {
    console.error(error);
    document.querySelector(".layout").innerHTML = `
      <section class="panel wide">
        <div class="empty-state">
          Failed to load report artifacts. Check the latest refresh Lambda run and published <code>/data</code> objects.
        </div>
      </section>
    `;
  }

  function renderSummaryCards(scorecards) {
    const host = document.getElementById("summary-cards");
    const cards = scorecards.summary_cards || [];
    host.innerHTML = cards.map((card) => `
      <a class="metric-card metric-card-link" href="${escapeHtml(summaryCardLink(card.id))}">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(String(card.value))}</strong>
        <div class="metric-subtext">${escapeHtml(card.context || "")}</div>
        <div class="metric-link-text">View contacts</div>
      </a>
    `).join("");
  }

  function summaryCardLink(cardId) {
    if (cardId === "ma_outreach_notes") {
      return buildDrilldownUrl({ title: "All Outreach Notes", view: "engagements", predicates: [] });
    }
    if (cardId === "two_way_engagements") {
      return buildDrilldownUrl({
        title: "Two-Way Engagements",
        view: "engagements",
        predicates: [{ kind: "eq", key: "engagement_bucket", value: "Two-way engagement" }],
      });
    }
    if (cardId === "one_way_outreach") {
      return buildDrilldownUrl({
        title: "One-Way Outreach",
        view: "engagements",
        predicates: [{ kind: "eq", key: "engagement_bucket", value: "One-way outreach" }],
      });
    }
    if (cardId === "failed_contacts") {
      return buildDrilldownUrl({
        title: "Failed Contacts",
        view: "engagements",
        predicates: [{ kind: "eq", key: "engagement_bucket", value: "Failed / unreachable" }],
      });
    }
    const windowMatch = cardId.match(/_(30|90|365)$/);
    if (windowMatch) {
      return buildDrilldownUrl({
        title: `Follow-On Donors ${windowMatch[1]}`,
        view: "donors",
        predicates: [
          { kind: "eq", key: `in_window_${windowMatch[1]}`, value: true },
          { kind: "eq", key: "linked_engagement_bucket", value: "Two-way engagement" },
        ],
      });
    }
    return buildDrilldownUrl({ title: "All Outreach Notes", view: "engagements", predicates: [] });
  }

  function renderLeaderboard(scorecards) {
    const host = document.getElementById("leaderboard-table");
    const rows = scorecards.leaderboard || [];
    host.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Owner</th>
            <th>Notes</th>
            <th>Two-Way</th>
            <th>One-Way</th>
            <th>Donors 365</th>
            <th>Dollars 365</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><a class="table-link" href="${escapeHtml(buildDrilldownUrl({ title: row.ma_owner, view: "engagements", predicates: [{ kind: "eq", key: "ma_owner", value: row.ma_owner }] }))}">${escapeHtml(row.ma_owner)}</a></td>
              <td>${row.outreach_notes}</td>
              <td>${row.two_way_engagements}</td>
              <td>${row.one_way_outreach}</td>
              <td>${row.follow_on_donors_365}</td>
              <td>${currency.format(Number(row.follow_on_dollars_365 || 0))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderTypeMix(trends) {
    const host = document.getElementById("type-mix-table");
    const rows = Object.entries(trends.type_mix || {}).sort((left, right) => right[1] - left[1]);
    host.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Outreach Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([label, value]) => `
            <tr>
              <td><a class="table-link" href="${escapeHtml(buildDrilldownUrl({ title: label, view: "engagements", predicates: [{ kind: "eq", key: "engagement_type", value: label }] }))}">${escapeHtml(label)}</a></td>
              <td>${value}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderMomentum(trends) {
    const monthly = trends.monthly || [];
    renderColumnChart(
      "engagement-chart",
      monthly.map((row) => row.period_start),
      monthly.map((row) => Number(row.outreach_notes || 0)),
      (value) => `${value} outreach notes`,
      "rgba(180, 83, 45, 0.86)",
      (label) => buildDrilldownUrl({
        title: `Engagements in ${label.slice(0, 7)}`,
        view: "engagements",
        predicates: [{ kind: "prefix", key: "engagement_date", value: label.slice(0, 7) }],
      }),
    );
    renderColumnChart(
      "follow-on-dollar-chart",
      monthly.map((row) => row.period_start),
      monthly.map((row) => Number(row.recent_follow_on_dollars || 0)),
      (value) => currency.format(value || 0),
      "rgba(46, 95, 70, 0.88)",
    );
  }
}
