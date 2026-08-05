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

const state = {
  allRows: [],
  segmentRows: [],
  search: "",
  spec: parseSpec(),
};

try {
  const [metadata, details, segmentIndex] = await Promise.all([
    fetchJson("data/metadata.json"),
    fetchJson("data/detail_index.json"),
    fetchJson("data/segment_index.json"),
  ]);
  state.allRows = details;
  state.segmentRows = applySegment(details, state.spec, segmentIndex);
  renderMeta(metadata);
  renderHeader();
  setupSearch();
  setupDownload();
  renderTable();
} catch (error) {
  console.error(error);
  document.querySelector(".layout").innerHTML = `
    <section class="panel wide">
      <div class="empty-state">
        Failed to load drilldown artifacts. Run the pipeline first with
        <code>python3 -m virt_reporting sync bootstrap</code>.
      </div>
    </section>
  `;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

function parseSpec() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("spec");
  if (!raw) {
    return { title: "All Alumni", segmentKey: "", predicates: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || "Alumni Segment",
      segmentKey: parsed.segmentKey || "",
      predicates: Array.isArray(parsed.predicates) ? parsed.predicates : [],
    };
  } catch {
    return { title: "Alumni Segment", segmentKey: "", predicates: [] };
  }
}

function renderMeta(metadata) {
  document.getElementById("generated-at").textContent =
    metadata.generated_at_display || formatDateTime(metadata.generated_at);
  document.getElementById("sync-mode").textContent = capitalize(metadata.mode || "unknown");
  document.getElementById("runtime-seconds").textContent = `${metadata.runtime_seconds ?? "?"}s`;
}

function renderHeader() {
  document.title = `${state.spec.title} | Alumni Segment Drilldown`;
  document.getElementById("segment-title").textContent = state.spec.title;
  document.getElementById("segment-subtitle").textContent =
    "Alumni rows matching the selected segment from the coverage report.";
  updateCountChip();
}

function setupSearch() {
  document.getElementById("search-input").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderTable();
  });
}

function setupDownload() {
  document.getElementById("download-csv").addEventListener("click", () => {
    const rows = filteredRows();
    const header = [
      "Contact Id",
      "Name",
      "Class Year",
      "Degree",
      "Major",
      "Donor Recency",
      "Assigned Solicitor Group",
      "Last Gift Date",
      "Life To Date Giving",
      "Year To Date Giving",
      "Touch Count 90",
      "Last Touch Date",
      "Opportunity Bucket",
    ];
    const lines = [
      header.join(","),
      ...rows.map((row) => [
        row.contact_id,
        csvValue(row.full_name),
        csvValue(detailClassYearLabel(row)),
        csvValue(row.degree || ""),
        csvValue(row.major || ""),
        csvValue(row.donor_recency_bucket || ""),
        csvValue(row.assigned_solicitor_group || ""),
        csvValue(row.last_gift_date || ""),
        csvValue(row.life_to_date_giving || ""),
        csvValue(row.year_to_date_giving || ""),
        csvValue(row.touch_count_90 || 0),
        csvValue(row.last_touch_date || ""),
        csvValue(row.opportunity_bucket || ""),
      ].join(",")),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(state.spec.title)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

function renderTable() {
  const tbody = document.getElementById("detail-table");
  const rows = filteredRows();
  updateCountChip(rows.length);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state">No rows match the current segment and search.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.full_name || "")}</td>
      <td>${escapeHtml(detailClassYearLabel(row))}</td>
      <td>${escapeHtml(row.degree || "")}</td>
      <td>${escapeHtml(row.major || "")}</td>
      <td><span class="pill ${pillToneForRecency(row.donor_recency_bucket)}">${escapeHtml(row.donor_recency_bucket || "")}</span></td>
      <td>${escapeHtml(row.assigned_solicitor_group || "")}</td>
      <td>${formatDate(row.last_gift_date)}</td>
      <td>${currency.format(Number(row.life_to_date_giving || 0))}</td>
      <td>${currency.format(Number(row.year_to_date_giving || 0))}</td>
      <td>${row.touch_count_90 ?? 0}</td>
      <td>${formatDate(row.last_touch_date)}</td>
      <td><span class="pill ${pillToneForOpportunity(row.opportunity_bucket || "")}">${escapeHtml(row.opportunity_bucket || "")}</span></td>
    </tr>
  `).join("");
}

function updateCountChip(currentCount = state.segmentRows.length) {
  const suffix = state.search ? ` matching search / ${state.segmentRows.length} in segment` : " alumni in segment";
  document.getElementById("segment-count").textContent = `${currentCount}${suffix}`;
}

function filteredRows() {
  if (!state.search) {
    return state.segmentRows;
  }
  return state.segmentRows.filter((row) => {
    const haystack = [
      row.full_name,
      detailClassYearLabel(row),
      row.degree,
      row.major,
      row.assigned_solicitor_group,
      row.donor_recency_bucket,
      row.opportunity_bucket,
    ].join(" ").toLowerCase();
    return haystack.includes(state.search);
  });
}

function applySegment(rows, spec, segmentIndex) {
  let scopedRows = rows;
  if (spec.segmentKey) {
    const segment = segmentIndex?.segments?.[spec.segmentKey];
    if (segment) {
      const contactIds = new Set((segment.contact_ids || []).map((value) => Number(value)));
      scopedRows = rows.filter((row) => contactIds.has(Number(row.contact_id)));
      if (!spec.title && segment.title) {
        spec.title = segment.title;
      }
    }
  }
  return scopedRows.filter((row) => spec.predicates.every((predicate) => matchesPredicate(row, predicate)));
}

function matchesPredicate(row, predicate) {
  if (!predicate || !predicate.kind || !predicate.key) {
    return true;
  }
  if (predicate.kind === "eq") {
    return String(row[predicate.key] || "") === String(predicate.value || "");
  }
  if (predicate.kind === "bool") {
    return Boolean(row[predicate.key]) === Boolean(predicate.value);
  }
  return true;
}

function detailClassYearLabel(row) {
  return row.class_year || row.class_year_issue || row.raw_class_year || "";
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

function csvValue(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

function slugify(value) {
  return String(value || "segment")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "segment";
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
