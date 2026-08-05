import {
  buildDrilldownUrl,
  currency,
  escapeHtml,
  loadBaseData,
  renderColumnChart,
} from "./shared.js";


export async function bootMasActivity() {
  try {
    const data = await loadBaseData([
      ["scorecards", "data/scorecards.json"],
      ["trends", "data/trends.json"],
    ]);
    renderMonthlyCharts(data.trends);
    renderOwnerTable(data.scorecards);
    renderTypeTable(data.trends);
  } catch (error) {
    console.error(error);
    document.querySelector(".layout").innerHTML = `
      <section class="panel wide">
        <div class="empty-state">
          Failed to load activity artifacts. Check the latest refresh Lambda run and published <code>/data</code> objects.
        </div>
      </section>
    `;
  }

  function renderMonthlyCharts(trends) {
    const monthly = trends.monthly || [];
    renderColumnChart(
      "activity-engagement-chart",
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
      "activity-status-chart",
      monthly.map((row) => row.period_start),
      monthly.map((row) => Number(row.two_way_engagements || 0)),
      (value) => `${value} two-way`,
      "rgba(46, 95, 70, 0.88)",
    );
  }

  function renderOwnerTable(scorecards) {
    const host = document.getElementById("owner-activity-table");
    const rows = scorecards.owners || [];
    host.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Owner</th>
            <th>Notes</th>
            <th>Two-Way</th>
            <th>One-Way</th>
            <th>Failed</th>
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
              <td>${row.failed_contacts}</td>
              <td>${row.follow_on_donors_365}</td>
              <td>${currency.format(Number(row.follow_on_dollars_365 || 0))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderTypeTable(trends) {
    const host = document.getElementById("activity-type-table");
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
          ${rows.map(([type, value]) => `
            <tr>
              <td><a class="table-link" href="${escapeHtml(buildDrilldownUrl({ title: type, view: "engagements", predicates: [{ kind: "eq", key: "engagement_type", value: type }] }))}">${escapeHtml(type)}</a></td>
              <td>${value}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }
}
