/**
 * render.js — DOM rendering + hand-rolled SVG charts (no external libs, CSP-safe).
 */
import { BUCKETS, TIERS } from "./config.js";

const fmt = (n) => Math.round(n).toLocaleString();
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const bucketColor = (id) => (BUCKETS.find((b) => b.id === id) || {}).color || "var(--slate-400)";

export function renderKPIs(node, totals) {
  node.innerHTML = "";
  const cards = [
    { label: "Total Points", value: fmt(totals.points), foot: `${fmt(totals.count)} scored activities` },
    { label: "Conversations", value: fmt(totals.conversations), foot: `${pct(totals.convRate)} of dials` },
    { label: "Weekdays Covered", value: fmt(totals.weekdays), foot: `${fmt(totals.days)} calendar days` },
    { label: "Team Avg / Weekday", value: fmt(totals.weekdays ? totals.points / totals.weekdays : 0), foot: "points per weekday" },
  ];
  for (const c of cards) {
    node.append(el(`<div class="kpi"><div class="label">${c.label}</div>
      <div class="value tabular">${c.value}</div><div class="foot">${c.foot}</div></div>`));
  }
}

export function renderLeaderboard(node, owners, selected, onSelect) {
  node.innerHTML = "";
  owners.forEach((o, i) => {
    const card = el(`<div class="macard ${selected === o.name ? "selected" : ""}" data-ma="${o.name}">
      <div class="rank">${i + 1}</div>
      <div class="name">${o.name}</div>
      <div class="pts tabular">${fmt(o.points)} <small>pts</small></div>
      <span class="tier" style="background:${o.tier.color}">${o.tier.label}</span>
      <div class="statrow">
        <div class="s">Avg/weekday<b class="tabular">${fmt(o.avgPerWeekday)}</b></div>
        <div class="s">Conversations<b class="tabular">${fmt(o.conversations)}</b></div>
        <div class="s">Conv. rate<b class="tabular">${pct(o.convRate)}</b></div>
      </div>
      <div class="mix" title="activity mix by points"></div>
    </div>`);
    const mix = card.querySelector(".mix");
    const totalPts = o.points || 1;
    BUCKETS.forEach((b) => {
      const p = o.bucketPoints[b.id] || 0;
      if (p <= 0) return;
      const seg = document.createElement("span");
      seg.style.width = `${(p / totalPts) * 100}%`;
      seg.style.background = b.color;
      seg.title = `${b.label}: ${fmt(p)} pts`;
      mix.append(seg);
    });
    card.addEventListener("click", () => onSelect(selected === o.name ? null : o.name));
    node.append(card);
  });
}

/** Daily points bar chart. Weekend bars are muted. */
export function renderDailyChart(node, series, title) {
  node.innerHTML = "";
  if (!series.length) { node.append(el(`<p class="footnote">No activity in range.</p>`)); return; }
  const W = 1100, H = 260, padL = 44, padR = 12, padT = 14, padB = 40;
  const max = Math.max(...series.map((d) => d.points), 10);
  const bw = (W - padL - padR) / series.length;
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const ticks = 4;
  let bars = "", axis = "", labels = "";
  for (let t = 0; t <= ticks; t++) {
    const v = (max / ticks) * t; const yy = y(v);
    axis += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text x="${padL - 8}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  series.forEach((d, i) => {
    const x = padL + i * bw, h = (H - padT - padB) - (y(d.points) - padT);
    const wknd = d.date && (d.date.getDay() === 0 || d.date.getDay() === 6);
    bars += `<rect class="bar ${wknd ? "wknd" : ""}" x="${x + 1}" y="${y(d.points)}" width="${Math.max(1, bw - 2)}" height="${Math.max(0, h)}"><title>${d.day}: ${fmt(d.points)} pts</title></rect>`;
    if (series.length <= 32 || i % Math.ceil(series.length / 20) === 0) {
      const lab = d.day.slice(5);
      labels += `<text x="${x + bw / 2}" y="${H - padB + 16}" text-anchor="middle" transform="rotate(0 ${x + bw / 2} ${H - padB + 16})">${lab}</text>`;
    }
  });
  node.append(el(`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
    <g class="axis">${axis}</g><g>${bars}</g><g class="axis">${labels}</g></svg>`));
}

/** Team activity mix — horizontal bars by bucket (points). */
export function renderActivityMix(node, owners) {
  const totals = {};
  owners.forEach((o) => BUCKETS.forEach((b) => { totals[b.id] = (totals[b.id] || 0) + (o.bucketPoints[b.id] || 0); }));
  const max = Math.max(...BUCKETS.map((b) => totals[b.id] || 0), 1);
  node.innerHTML = "";
  const rows = BUCKETS.filter((b) => (totals[b.id] || 0) > 0).map((b) => {
    const v = totals[b.id] || 0;
    return `<tr><td>${b.label} <span class="pill">${b.points} pt</span></td>
      <td style="width:60%"><div style="background:${b.color};height:14px;border-radius:4px;width:${(v / max) * 100}%"></div></td>
      <td class="pts tabular">${fmt(v)}</td></tr>`;
  }).join("");
  node.append(el(`<table class="grid"><tbody>${rows}</tbody></table>`));
}

export function renderTable(node, owners) {
  node.innerHTML = "";
  const body = owners.map((o) => `<tr>
    <td>${o.name}</td>
    <td class="pts tabular">${fmt(o.points)}</td>
    <td class="tabular">${fmt(o.avgPerWeekday)}</td>
    <td><span class="tier" style="background:${o.tier.color}">${o.tier.label.split(" ")[0]}</span></td>
    <td class="tabular">${fmt(o.conversations)}</td>
    <td class="tabular">${fmt(o.dials)}</td>
    <td class="tabular">${pct(o.convRate)}</td>
    <td class="tabular">${fmt(o.count)}</td>
  </tr>`).join("");
  node.append(el(`<table class="grid">
    <thead><tr><th>Mission Advancement</th><th>Points</th><th>Avg/wkdy</th><th>Tier</th>
      <th>Convos</th><th>Dials</th><th>Rate</th><th>Activities</th></tr></thead>
    <tbody>${body}</tbody></table>`));
}

/** Per-MA weekly breakdown (shown when a card is selected). */
export function renderDetail(node, owner) {
  node.innerHTML = "";
  if (!owner) { node.style.display = "none"; return; }
  node.style.display = "";
  const weeks = owner.weekList.map((w) => `<tr>
    <td>Week of ${w.key.slice(5)}</td>
    <td class="pts tabular">${fmt(w.points)}</td>
    <td class="tabular">${fmt(w.conversations)}</td>
    <td class="tabular">${fmt(w.dials)}</td>
    <td class="tabular">${w.dials ? pct(w.conversations / w.dials) : "—"}</td>
  </tr>`).join("");
  node.append(el(`<div class="panel">
    <h2>${owner.name} <span class="hint">${owner.tier.label} · ${fmt(owner.avgPerWeekday)} pts/weekday</span></h2>
    <table class="grid"><thead><tr><th>Week</th><th>Points</th><th>Convos</th><th>Dials</th><th>Rate</th></tr></thead>
    <tbody>${weeks || '<tr><td colspan="5">No weeks in range.</td></tr>'}</tbody></table>
  </div>`));
}

/**
 * Events reference table. Display-only: these are name-matched Virtuous events
 * shown for context. They are NOT attributed to an MA and never affect totals.
 * `events` is a list of scored event rows (from scoreEvent).
 */
export function renderEvents(node, events) {
  node.innerHTML = "";
  if (!events || !events.length) {
    node.append(el(`<p class="footnote">No matching events in range.</p>`));
    return;
  }
  const rows = [...events]
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .map((e) => `<tr>
      <td>${e.eventName || "—"}</td>
      <td class="tabular">${e.day || "—"}</td>
      <td>${e.unmatched ? '<span class="pill">untagged</span>' : e.label}</td>
      <td class="pts tabular">${e.unmatched ? "—" : `${fmt(e.points)} pt`}</td>
    </tr>`).join("");
  node.append(el(`<table class="grid">
    <thead><tr><th>Event</th><th>Date</th><th>Rule</th><th>Reference pts</th></tr></thead>
    <tbody>${rows}</tbody></table>`));
}

export function renderTierLegend(node) {
  node.innerHTML = "";
  const items = TIERS.map((t) => `<span class="k"><span class="dot" style="background:${t.color}"></span>
    ${t.label} — ${t.min ? `≥${t.min}` : "<100"} pts/wkdy · $${t.annual.toLocaleString()}/yr</span>`).join("");
  node.append(el(`<div class="legend">${items}</div>`));
}
