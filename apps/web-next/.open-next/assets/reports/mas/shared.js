export const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const easternDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

const appConfig = window.MAS_REPORT_CONFIG || {};
const dataBasePath = String(appConfig.dataBasePath || "data").replace(/\/+$/, "");

export function dataPath(path) {
  const value = String(path || "");
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("/")) {
    return value;
  }
  if (value.startsWith("data/")) {
    return `${dataBasePath}/${value.slice("data/".length)}`;
  }
  return `${dataBasePath}/${value}`;
}

export async function fetchJson(path) {
  const response = await fetch(dataPath(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

export async function loadBaseData(paths) {
  const entries = await Promise.all(paths.map(async ([key, path]) => [key, await fetchJson(path)]));
  return Object.fromEntries(entries);
}

export function renderMeta(metadata) {
  const generated = document.getElementById("generated-at");
  const mode = document.getElementById("sync-mode");
  const runtime = document.getElementById("runtime-seconds");
  if (generated) {
    generated.textContent = displayGeneratedAt(metadata);
  }
  if (mode) {
    mode.textContent = capitalize(metadata.mode || "unknown");
  }
  if (runtime) {
    runtime.textContent = `${metadata.runtime_seconds ?? "?"}s`;
  }
}

function displayGeneratedAt(metadata) {
  const generatedAtDisplay = String(metadata.generated_at_display || "").trim();
  if (/\b(EDT|EST)\b/.test(generatedAtDisplay)) {
    return generatedAtDisplay;
  }
  return formatDateTime(metadata.generated_at) || generatedAtDisplay;
}

export function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

export function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) ? `${value}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : easternDateTimeFormatter.format(date);
}

export function capitalize(value) {
  return String(value || "").replace(/^\w/, (char) => char.toUpperCase());
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildDrilldownUrl(spec) {
  return `drilldown.html?spec=${encodeURIComponent(JSON.stringify(spec))}`;
}

export function renderColumnChart(hostId, labels, values, formatter, fill, linkBuilder = null) {
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
  const labelTicks = labels.map((label, index) => {
    const x = padding.left + index * barWidth + barWidth / 2;
    return `<text x="${x}" y="${height - 10}" text-anchor="middle" font-size="11" fill="#6d705d">${escapeHtml(shortMonthLabel(label))}</text>`;
  }).join("");
  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${hostId}">
      ${bars}
      ${labelTicks}
      <text x="${width - padding.right}" y="${padding.top + 4}" text-anchor="end" font-size="12" fill="#1d2b21">${escapeHtml(formatter(maxValue))}</text>
    </svg>
  `;
}

function shortMonthLabel(value) {
  if (!value) {
    return "";
  }
  const normalized = value.length === 10 ? `${value}T00:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 7);
  }
  return date.toLocaleDateString("en-US", { month: "short" });
}
