import {
  buildDrilldownUrl,
  currency,
  escapeHtml,
  formatDate,
  loadBaseData,
  renderMeta,
} from "./shared.js";

const state = {
  window: "30",
  search: "",
  rows: [],
};

try {
  const data = await loadBaseData([
    ["metadata", "data/metadata.json"],
    ["followOnGifts", "data/follow_on_gifts.json"],
  ]);
  renderMeta(data.metadata);
  state.rows = buildRecentGiftRows(data.followOnGifts || []);
  setupFilters();
  renderTable();
} catch (error) {
  console.error(error);
  document.querySelector(".layout").innerHTML = `
    <section class="panel wide">
      <div class="empty-state">
        Failed to load follow-on gift artifacts. Check the latest refresh Lambda run and published <code>/data</code> objects.
      </div>
    </section>
  `;
}

function buildRecentGiftRows(rows) {
  const byGift = new Map();
  for (const row of rows) {
    const existing = byGift.get(row.gift_id);
    if (!existing) {
      byGift.set(row.gift_id, row);
      continue;
    }
    const existingTwoWay = existing.linked_engagement_bucket === "Two-way engagement";
    const currentTwoWay = row.linked_engagement_bucket === "Two-way engagement";
    if (currentTwoWay && !existingTwoWay) {
      byGift.set(row.gift_id, row);
      continue;
    }
    if (currentTwoWay === existingTwoWay && row.days_from_engagement < existing.days_from_engagement) {
      byGift.set(row.gift_id, row);
    }
  }
  return Array.from(byGift.values()).sort((left, right) => String(right.gift_date).localeCompare(String(left.gift_date)));
}

function setupFilters() {
  document.getElementById("gift-window-filter").addEventListener("change", (event) => {
    state.window = event.target.value;
    renderTable();
  });
  document.getElementById("gift-search").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderTable();
  });
}

function filteredRows() {
  return state.rows.filter((row) => {
    if (!row[`in_window_${state.window}`]) {
      return false;
    }
    if (!state.search) {
      return true;
    }
    const haystack = [
      row.contact_name,
      row.linked_ma_owner,
      row.linked_engagement_type,
      row.segment,
      row.project_name,
      row.project_code,
    ].join(" ").toLowerCase();
    return haystack.includes(state.search);
  });
}

function renderTable() {
  const rows = filteredRows();
  document.getElementById("gift-count").textContent = `${rows.length} gifts`;
  const tbody = document.getElementById("gift-table");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No gifts match the current window and search.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td><a class="table-link" href="${escapeHtml(buildDrilldownUrl({ title: row.contact_name, view: "contacts", predicates: [{ kind: "eq", key: "contact_id", value: row.contact_id }] }))}">${escapeHtml(row.contact_name)}</a></td>
      <td>${formatDate(row.gift_date)}</td>
      <td>${currency.format(Number(row.gift_amount || 0))}</td>
      <td>${escapeHtml(row.linked_ma_owner || "")}</td>
      <td>${escapeHtml(row.linked_engagement_type || "")}</td>
      <td>${row.days_from_engagement}</td>
      <td>${escapeHtml(row.segment || "")}</td>
      <td>${escapeHtml(row.project_name || row.project_code || "")}</td>
    </tr>
  `).join("");
}
