import {
  currency,
  escapeHtml,
  formatDate,
  loadBaseData,
} from "./shared.js";


export async function bootMasDrilldown() {
  const state = {
    view: "engagements",
    rows: [],
    search: "",
    spec: parseSpec(),
  };

  try {
    const data = await loadBaseData([
      ["engagements", "data/engagements.json"],
      ["rollups", "data/contact_rollup.json"],
      ["followOnGifts", "data/follow_on_gifts.json"],
    ]);
    state.view = state.spec.view || "engagements";
    state.rows = resolveRows(data);
    renderHeader();
    setupSearch();
    renderTable();
  } catch (error) {
    console.error(error);
    document.querySelector(".layout").innerHTML = `
      <section class="panel wide">
        <div class="empty-state">
          Failed to load drilldown artifacts. Check the latest refresh Lambda run and published <code>/data</code> objects.
        </div>
      </section>
    `;
  }

  function parseSpec() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("spec");
    const fallback = { title: "All Outreach Notes", view: "engagements", predicates: [] };
    if (!raw) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(raw);
      return { ...fallback, ...parsed, predicates: parsed.predicates || [] };
    } catch {
      return fallback;
    }
  }

  function resolveRows(data) {
    if (state.view === "donors") {
      return buildDonorRows(data.rollups || [], data.followOnGifts || [], state.spec.predicates || []);
    }
    if (state.view === "contacts") {
      return buildContactRows(data.rollups || [], state.spec.predicates || []);
    }
    return buildEngagementRows(data.engagements || [], state.spec.predicates || []);
  }

  function buildEngagementRows(rows, predicates) {
    return rows.filter((row) => predicates.every((predicate) => matchesPredicate(row, predicate)));
  }

  function buildContactRows(rows, predicates) {
    return rows.filter((row) => predicates.every((predicate) => matchesPredicate(row, predicate)));
  }

  function buildDonorRows(rollups, followOnGifts, predicates) {
    const filtered = followOnGifts.filter((row) => predicates.every((predicate) => matchesPredicate(row, predicate)));
    const rollupsById = new Map(rollups.map((row) => [String(row.contact_id), row]));
    const grouped = new Map();

    for (const row of filtered) {
      const key = String(row.contact_id);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(row);
    }

    const donorRows = [];
    for (const [contactId, rows] of grouped.entries()) {
      const rollup = rollupsById.get(contactId) || {};
      const bestMatch = [...rows].sort((left, right) => {
        if (left.days_from_engagement !== right.days_from_engagement) {
          return left.days_from_engagement - right.days_from_engagement;
        }
        return String(right.gift_date).localeCompare(String(left.gift_date));
      })[0];

      const uniqueGifts = new Map();
      for (const row of rows) {
        if (!uniqueGifts.has(row.gift_id)) {
          uniqueGifts.set(row.gift_id, row);
        }
      }
      const uniqueGiftRows = [...uniqueGifts.values()];
      const sortedGiftDates = uniqueGiftRows
        .map((row) => row.gift_date)
        .filter(Boolean)
        .sort((left, right) => String(left).localeCompare(String(right)));
      const total = uniqueGiftRows.reduce((sum, row) => sum + Number(row.gift_amount || 0), 0);

      donorRows.push({
        contact_id: bestMatch.contact_id,
        contact_name: bestMatch.contact_name || rollup.contact_name || "",
        matched_engagement_date: bestMatch.linked_engagement_date,
        matched_engagement_type: bestMatch.linked_engagement_type,
        matched_engagement_bucket: bestMatch.linked_engagement_bucket,
        matched_ma_owner: bestMatch.linked_ma_owner,
        unique_gift_count: uniqueGiftRows.length,
        total_follow_on_giving: total.toFixed(2),
        first_follow_on_gift_date: sortedGiftDates[0] || "",
        last_follow_on_gift_date: sortedGiftDates[sortedGiftDates.length - 1] || "",
      });
    }

    donorRows.sort((left, right) => {
      if (left.last_follow_on_gift_date !== right.last_follow_on_gift_date) {
        return String(right.last_follow_on_gift_date).localeCompare(String(left.last_follow_on_gift_date));
      }
      return String(left.contact_name).localeCompare(String(right.contact_name));
    });
    return donorRows;
  }

  function matchesPredicate(row, predicate) {
    if (!predicate || !predicate.key) {
      return true;
    }
    const current = row[predicate.key];
    if (predicate.kind === "eq") {
      return String(current ?? "") === String(predicate.value ?? "");
    }
    if (predicate.kind === "prefix") {
      return String(current ?? "").startsWith(String(predicate.value ?? ""));
    }
    if (predicate.kind === "truthy") {
      return Boolean(current);
    }
    return true;
  }

  function renderHeader() {
    document.title = `${state.spec.title} | Contact Drilldown`;
    document.getElementById("segment-title").textContent = state.spec.title || "Contact Drilldown";
    const subtitle =
      state.view === "engagements"
        ? "Matching outreach-note rows for the selected report segment."
        : state.view === "donors"
          ? "Matching donor contacts derived from the filtered follow-on gift ledger."
          : "Matching contact rows for the selected report segment.";
    document.getElementById("segment-subtitle").textContent = subtitle;
    document.getElementById("detail-search").placeholder =
      state.view === "engagements"
        ? "Name, owner, type, note text"
        : state.view === "donors"
          ? "Name, owner, engagement type"
          : "Name, owner, engagement type, email";
  }

  function setupSearch() {
    document.getElementById("detail-search").addEventListener("input", (event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderTable();
    });
  }

  function filteredRows() {
    if (!state.search) {
      return state.rows;
    }
    return state.rows.filter((row) => {
      const haystack =
        state.view === "engagements"
          ? [
              row.contact_name,
              row.ma_owner,
              row.engagement_type,
              row.engagement_bucket,
              row.outreach_note_type,
              row.outreach_note_snippet,
            ]
          : state.view === "donors"
            ? [
                row.contact_name,
                row.matched_ma_owner,
                row.matched_engagement_type,
                row.matched_engagement_bucket,
              ]
            : [
                row.contact_name,
                row.latest_ma_owner,
                row.latest_engagement_type,
                row.latest_engagement_bucket,
                row.primary_email,
              ];
      return haystack.join(" ").toLowerCase().includes(state.search);
    });
  }

  function renderTable() {
    const rows = filteredRows();
    const countLabel = state.view === "engagements" ? "notes" : "contacts";
    document.getElementById("segment-count").textContent = `${rows.length} ${countLabel}`;
    renderHead();
    const tbody = document.getElementById("detail-table");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">No rows match the current drilldown.</div></td></tr>`;
      return;
    }
    if (state.view === "engagements") {
      tbody.innerHTML = rows.map(renderEngagementRow).join("");
      return;
    }
    if (state.view === "donors") {
      tbody.innerHTML = rows.map(renderDonorRow).join("");
      return;
    }
    tbody.innerHTML = rows.map(renderContactRow).join("");
  }

  function renderHead() {
    const head = document.getElementById("detail-head");
    if (state.view === "engagements") {
      head.innerHTML = `
        <tr>
          <th>Contact</th>
          <th>Engagement Date</th>
          <th>Owner</th>
          <th>Type</th>
          <th>Bucket</th>
          <th>Note Type</th>
          <th>Snippet</th>
        </tr>
      `;
      return;
    }
    if (state.view === "donors") {
      head.innerHTML = `
        <tr>
          <th>Contact</th>
          <th>Matched Engagement</th>
          <th>Owner</th>
          <th>Gift Count</th>
          <th>Total Follow-On</th>
          <th>First Gift</th>
          <th>Last Gift</th>
        </tr>
      `;
      return;
    }
    head.innerHTML = `
      <tr>
        <th>Contact</th>
        <th>Latest Engagement</th>
        <th>Owner</th>
        <th>Bucket</th>
        <th>30-Day Donor</th>
        <th>90-Day Donor</th>
        <th>365-Day Donor</th>
        <th>Total Follow-On</th>
        <th>Ambiguous Same-Day Gifts</th>
      </tr>
    `;
  }

  function renderEngagementRow(row) {
    return `
      <tr>
        <td>${escapeHtml(row.contact_name || "")}</td>
        <td>${formatDate(row.engagement_date)}</td>
        <td>${escapeHtml(row.ma_owner || "")}</td>
        <td>${escapeHtml(row.engagement_type || "")}</td>
        <td>${escapeHtml(row.engagement_bucket || "")}</td>
        <td>${escapeHtml(row.outreach_note_type || "")}</td>
        <td>${escapeHtml(row.outreach_note_snippet || "")}</td>
      </tr>
    `;
  }

  function renderDonorRow(row) {
    return `
      <tr>
        <td>${escapeHtml(row.contact_name || "")}</td>
        <td>${formatDate(row.matched_engagement_date)} · ${escapeHtml(row.matched_engagement_type || "")}</td>
        <td>${escapeHtml(row.matched_ma_owner || "")}</td>
        <td>${row.unique_gift_count}</td>
        <td>${escapeHtml(row.total_follow_on_giving || "0.00")}</td>
        <td>${formatDate(row.first_follow_on_gift_date)}</td>
        <td>${formatDate(row.last_follow_on_gift_date)}</td>
      </tr>
    `;
  }

  function renderContactRow(row) {
    return `
      <tr>
        <td>${escapeHtml(row.contact_name || "")}</td>
        <td>${formatDate(row.latest_engagement_date)} · ${escapeHtml(row.latest_engagement_type || "")}</td>
        <td>${escapeHtml(row.latest_ma_owner || "")}</td>
        <td>${escapeHtml(row.latest_engagement_bucket || "")}</td>
        <td>${row.follow_on_donor_30 ? "Yes" : "No"}</td>
        <td>${row.follow_on_donor_90 ? "Yes" : "No"}</td>
        <td>${row.follow_on_donor_365 ? "Yes" : "No"}</td>
        <td>${escapeHtml(row.total_follow_on_giving || "0.00")}</td>
        <td>${row.same_day_ambiguous_gift_count || 0}</td>
      </tr>
    `;
  }
}
