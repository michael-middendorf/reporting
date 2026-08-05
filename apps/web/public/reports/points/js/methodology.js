/**
 * methodology.js — renders the scoring rubric, tiers, conflicts, and a live
 * coverage check (which MA note types in the raw data are unmapped).
 */
import { POINTS_MAP, CONFLICTS, TIERS, DAY_TARGETS, MA_ROSTER, EVENT_RULES } from "./config.js";
import { loadRaw } from "./data.js";

const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };

function rubric() {
  const rows = Object.entries(POINTS_MAP)
    .sort((a, b) => b[1].points - a[1].points)
    .map(([type, r]) => `<tr>
      <td>${r.label}</td>
      <td><code>${type}</code></td>
      <td class="p tabular">${r.points}</td>
      <td><span class="pill ${r.source.includes("assumed") ? "assumed" : "pdf"}">${r.source}</span>
          ${r.conflict ? `<a href="#c-${r.conflict}" class="pill assumed">⚑ flagged</a>` : ""}</td>
    </tr>`).join("");
  document.getElementById("rubric").append(el(`<table class="grid rubric">
    <thead><tr><th>Activity</th><th>Virtuous note type</th><th>Points</th><th>Source</th></tr></thead>
    <tbody>${rows}</tbody></table>`));
  const ev = EVENT_RULES.map((e) => `<li>${e.label} — <b>${e.points} pts</b> (matched by event name)</li>`).join("");
  document.getElementById("events").append(el(`<ul>${ev}</ul>`));
}

function tiers() {
  const rows = TIERS.map((t) => {
    const dt = DAY_TARGETS[t.id];
    return `<tr><td><span class="tier" style="background:${t.color}">${t.label}</span></td>
      <td>${t.min ? `≥ ${t.min}` : "< 100"} pts/weekday</td>
      <td class="tabular">$${t.annual.toLocaleString()}/yr</td>
      <td class="tabular">$${t.payout.toLocaleString()} on 12/1 &amp; 5/1</td>
      <td class="footnote">${dt ? `~${dt.points}-pt day: ${dt.blurb}` : ""}</td></tr>`;
  }).join("");
  document.getElementById("tiers").append(el(`<table class="grid">
    <thead><tr><th>Tier</th><th>Threshold</th><th>Annual</th><th>Payout</th><th>Example day</th></tr></thead>
    <tbody>${rows}</tbody></table>`));
}

function conflicts() {
  const node = document.getElementById("conflicts");
  Object.entries(CONFLICTS).forEach(([id, c]) => {
    node.append(el(`<div class="conflict" id="c-${id}">
      <h3>⚑ ${c.title}</h3>
      <dl>
        <dt>PDF rubric</dt><dd>${c.pdf}</dd>
        <dt>Spreadsheet</dt><dd>${c.spreadsheet}</dd>
        <dt>Currently scored</dt><dd><b>${c.resolved}</b></dd>
        <dt>Note</dt><dd>${c.note}</dd>
      </dl></div>`));
  });
}

async function coverage() {
  const node = document.getElementById("coverage");
  try {
    const raw = await loadRaw();
    const roster = new Set(MA_ROSTER.map((m) => m.name));
    const unmapped = {};
    for (const n of raw.notes) {
      if (!roster.has((n.createdByUser || "").trim())) continue;
      const key = (n.type || "").toLowerCase();
      if (!POINTS_MAP[key] && /mission advancement/i.test(n.type || "")) {
        unmapped[n.type] = (unmapped[n.type] || 0) + 1;
      }
    }
    const entries = Object.entries(unmapped).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      node.append(el(`<p class="callout">✓ Every Mission Advancement note type in the current data maps to a point value.</p>`));
    } else {
      const rows = entries.map(([t, n]) => `<tr><td><code>${t}</code></td><td class="tabular">${n}</td></tr>`).join("");
      node.append(el(`<p class="callout">These MA note types appear in the data but have no point mapping yet — they currently score 0. Add them to <code>POINTS_MAP</code> in <code>config.js</code>.</p>
        <table class="grid"><thead><tr><th>Unmapped note type</th><th>Count</th></tr></thead><tbody>${rows}</tbody></table>`));
    }
  } catch (e) {
    node.append(el(`<p class="footnote">Coverage check unavailable (${e.message}).</p>`));
  }
}

rubric(); tiers(); conflicts(); coverage();
