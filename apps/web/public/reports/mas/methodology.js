import { escapeHtml, loadBaseData } from "./shared.js";

try {
  const data = await loadBaseData([
    ["methodology", "data/methodology.json"],
  ]);
  renderMethodology(data.methodology);
} catch (error) {
  console.error(error);
  document.getElementById("methodology-host").innerHTML = `
    <div class="empty-state">
      Failed to load methodology artifacts. Check the latest refresh Lambda run and published <code>/data</code> objects.
    </div>
  `;
}

function renderMethodology(methodology) {
  const host = document.getElementById("methodology-host");
  host.innerHTML = `
    <div class="methodology-grid">
      <article class="method-card">
        <h2>Source of Truth</h2>
        <p>${escapeHtml(methodology.source_of_truth.task_source_status || "")}</p>
        <ul>
          <li>${escapeHtml(methodology.source_of_truth.primary_activity_source || "")}</li>
          <li>${escapeHtml(methodology.source_of_truth.gift_source || "")}</li>
          <li>${escapeHtml(methodology.source_of_truth.contact_enrichment_source || "")}</li>
        </ul>
      </article>
      <article class="method-card">
        <h2>Windows</h2>
        <ul>
          <li>Fetch scope: ${methodology.windows.fetch_days} days</li>
          <li>Default activity lens: ${methodology.windows.activity_default_days} days</li>
          <li>Default recent-gift lens: ${methodology.windows.recent_gift_default_days} days</li>
          <li>Follow-on windows: ${(methodology.windows.follow_on_windows_days || []).join(" / ")}</li>
        </ul>
      </article>
      <article class="method-card">
        <h2>Scoped Owners</h2>
        <ul>
          ${(methodology.scoped_owners || []).map((owner) => `<li>${escapeHtml(owner.name)} · ${escapeHtml(owner.identity)}</li>`).join("")}
        </ul>
      </article>
      <article class="method-card">
        <h2>Caveats</h2>
        <p>Recurring-backed gifts reviewed: ${escapeHtml(String(methodology.recurring_backed_follow_on_gifts_reviewed ?? 0))}</p>
        <p>Existing recurring gifts excluded: ${escapeHtml(String(methodology.existing_recurring_gifts_excluded ?? 0))}</p>
        <ul>
          ${(methodology.caveats || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
      <article class="method-card wide-card">
        <h2>Type Definitions</h2>
        <div class="definition-columns">
          ${renderDefinitionColumn("Two-Way Engagement", methodology.definitions?.two_way_engagement || [])}
          ${renderDefinitionColumn("One-Way Outreach", methodology.definitions?.one_way_outreach || [])}
          ${renderDefinitionColumn("Failed / Unreachable", methodology.definitions?.failed_unreachable || [])}
        </div>
      </article>
      <article class="method-card wide-card">
        <h2>Smoke Checks</h2>
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${(methodology.query_option_smoke_checks || []).map((check) => `
              <tr>
                <td>${escapeHtml(check.path || "")}</td>
                <td>${check.ok ? "OK" : "Needs Review"}</td>
                <td>${escapeHtml(check.error || (check.expected ? `Expected ${check.expected.join(", ")}` : ""))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </article>
    </div>
  `;
}

function renderDefinitionColumn(title, rows) {
  return `
    <section>
      <h3>${escapeHtml(title)}</h3>
      <ul>
        ${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}
      </ul>
    </section>
  `;
}
