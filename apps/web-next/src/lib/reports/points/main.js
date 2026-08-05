import { loadRaw } from "./data.js";
import { scoreAll, scoreEventsForDisplay } from "./points.js";
import { aggregate, dailyTotals } from "./aggregate.js";
import * as R from "./render.js";

/**
 * main.js — dashboard controller. Wires raw data -> scoring -> aggregation -> UI.
 * All computation is client-side; the network only fetches raw JSON.
 */
const state = { rows: [], events: [], meta: {}, range: "all", customStart: null, customEnd: null, selected: null };

const RANGES = {
  today: { label: "Today", days: 1 },
  "7": { label: "Last 7 days", days: 7 },
  "14": { label: "Last 14 days", days: 14 },
  week: { label: "This week", days: null, weekToDate: true },
  all: { label: "All", days: null },
};

const isoToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

function rangeBounds(key) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cfg = RANGES[key];
  if (!cfg || (!cfg.days && !cfg.weekToDate)) return { start: null, end: null };
  if (cfg.weekToDate) {
    const day = (end.getDay() + 6) % 7;
    return { start: new Date(end.getFullYear(), end.getMonth(), end.getDate() - day), end: null };
  }
  return { start: new Date(end.getFullYear(), end.getMonth(), end.getDate() - cfg.days + 1), end: null };
}

/** Bounds for the active selection — a named preset, or a custom date range. */
function currentBounds() {
  if (state.range === "custom") {
    return {
      start: state.customStart ? new Date(state.customStart + "T00:00:00") : null,
      end: state.customEnd ? new Date(state.customEnd + "T00:00:00") : null,
    };
  }
  return rangeBounds(state.range);
}

function draw() {
  const { start, end } = currentBounds();
  const model = aggregate(state.rows, { start, end });
  const selectedOwner = model.owners.find((o) => o.name === state.selected) || null;

  R.renderKPIs(document.getElementById("kpis"), model.totals);
  R.renderLeaderboard(document.getElementById("leaderboard"), model.owners, state.selected, (name) => {
    state.selected = name; draw();
  });
  R.renderTierLegend(document.getElementById("tier-legend"));
  R.renderDailyChart(document.getElementById("daily-chart"), dailyTotals(model.rows), "Daily team points");
  R.renderActivityMix(document.getElementById("activity-mix"), model.owners);
  R.renderTable(document.getElementById("table"), model.owners);
  R.renderDetail(document.getElementById("detail"), selectedOwner);

  // Events are display-only and filtered by the same date range as the rest.
  const eventsInRange = state.events.filter((e) => {
    if (!e.date) return false;
    if (start && e.date < start) return false;
    if (end && e.date > end) return false;
    return true;
  });
  R.renderEvents(document.getElementById("events"), eventsInRange);
}

function buildControls() {
  const seg = document.getElementById("range-seg");
  Object.entries(RANGES).forEach(([key, cfg]) => {
    const b = document.createElement("button");
    b.textContent = cfg.label;
    b.dataset.key = key;
    b.className = key === state.range ? "active" : "";
    b.onclick = () => selectPreset(key);
    seg.append(b);
  });
  wireDateFilter();
}

/** Activate a named preset and clear any custom date range. */
function selectPreset(key) {
  state.range = key;
  state.customStart = state.customEnd = null;
  document.querySelectorAll("#range-seg button").forEach((c) => c.classList.toggle("active", c.dataset.key === key));
  document.getElementById("date-range").classList.remove("active");
  draw();
}

/** Wire the custom From/To date inputs. */
function wireDateFilter() {
  const start = document.getElementById("date-start");
  const end = document.getElementById("date-end");
  const box = document.getElementById("date-range");
  start.max = end.max = isoToday();

  const apply = () => {
    if (!start.value && !end.value) return;
    // Guard against an inverted range.
    if (start.value && end.value && start.value > end.value) {
      [start.value, end.value] = [end.value, start.value];
    }
    state.range = "custom";
    state.customStart = start.value || null;
    state.customEnd = end.value || null;
    document.querySelectorAll("#range-seg button").forEach((c) => c.classList.remove("active"));
    box.classList.add("active");
    draw();
  };

  document.getElementById("date-apply").onclick = apply;
  start.onchange = apply;
  end.onchange = apply;
  document.getElementById("date-clear").onclick = () => {
    start.value = end.value = "";
    selectPreset("all");
  };
}

async function init() {
  buildControls();
  const status = document.getElementById("status");
  try {
    const raw = await loadRaw();
    state.meta = raw.meta || {};
    state.rows = scoreAll({ notes: raw.notes });
    state.events = scoreEventsForDisplay(raw.events);
    // meta line
    const m = state.meta;
    const range = m.note_date_range ? ` · data ${m.note_date_range[0]} → ${m.note_date_range[1]}` : "";
    status.innerHTML = (m.sample ? `<span class="badge-sample">SAMPLE DATA</span> ` : "") +
      `<span class="meta">${(raw.notes.length).toLocaleString()} raw notes${range}${m.generated_at ? ` · refreshed ${m.generated_at}` : ""}</span>`;
    draw();
  } catch (err) {
    status.innerHTML = `<span class="meta">Could not load data: ${err.message}</span>`;
    console.error(err);
  }
}


export async function bootPoints() {
  await init();
}
