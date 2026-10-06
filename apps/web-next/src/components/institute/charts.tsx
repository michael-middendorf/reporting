"use client";

/**
 * The Institute dashboard — React chart primitives ported from the standalone
 * institute_dashboard.html (bars / donut / column chart / histogram / gauge /
 * bottleneck funnel / conversion funnel / activity feed). Pure presentational
 * components; all filtering state lives in the page.
 */

import { COLORS, colorFor, type Item } from "@/lib/reports/institute/process";

/* ---------- horizontal bars (optionally click-to-filter) ---------- */
export function Bars({
  items,
  colorMap,
  active,
  onSelect,
  fmt,
}: {
  items: Item[];
  colorMap?: (k: string) => string | undefined;
  active?: string;
  onSelect?: (k: string) => void;
  fmt?: (v: number) => string | number;
}) {
  if (!items.length) return <div className="empty">No data</div>;
  const mx = Math.max(...items.map((i) => i.v), 1);
  return (
    <>
      {items.map((it, i) => {
        const w = ((it.v / mx) * 100).toFixed(1);
        const col = colorMap ? colorMap(it.k) || colorFor(i) : colorFor(i);
        const on = onSelect && active === it.k ? "on" : "";
        return (
          <div
            key={it.k}
            className={`barrow ${onSelect ? "clk" : ""} ${on}`}
            onClick={onSelect ? () => onSelect(it.k) : undefined}
          >
            <div className="bar-lbl" title={it.k}>
              {it.k}
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${w}%`, background: col }} />
            </div>
            <div className="bar-val">{fmt ? fmt(it.v) : it.v}</div>
          </div>
        );
      })}
    </>
  );
}

/* ---------- donut w/ legend ---------- */
export function Donut({
  items,
  colorMap,
  center,
}: {
  items: Item[];
  colorMap?: (k: string) => string | undefined;
  center?: number | string;
}) {
  const total = items.reduce((s, i) => s + i.v, 0) || 1;
  const R = 50,
    r = 31,
    cx = 60,
    cy = 60;
  // Start angle of each segment from a running total, computed up front so the
  // render callback does not reassign an outer variable (react-hooks/immutability).
  const starts: number[] = [];
  items.reduce((angle, it) => {
    starts.push(angle);
    return angle + (it.v / total) * 2 * Math.PI;
  }, -Math.PI / 2);
  const segs = items.map((it, i) => {
    const a0 = starts[i];
    const f = it.v / total;
    const a1 = a0 + f * 2 * Math.PI;
    const col = colorMap ? colorMap(it.k) || colorFor(i) : colorFor(i);
    const lg = a1 - a0 > Math.PI ? 1 : 0;
    const p = `M${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} A${R} ${R} 0 ${lg} 1 ${
      cx + R * Math.cos(a1)
    } ${cy + R * Math.sin(a1)} L${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} A${r} ${r} 0 ${lg} 0 ${
      cx + r * Math.cos(a0)
    } ${cy + r * Math.sin(a0)} Z`;
    return <path key={i} d={p} fill={col} />;
  });
  return (
    <div className="donutwrap">
      <svg width="120" height="120" viewBox="0 0 120 120">
        {segs}
        <text x="60" y="57" textAnchor="middle" fontSize="19" fontWeight="800" fill={COLORS.navy}>
          {center != null ? center : total}
        </text>
        <text x="60" y="73" textAnchor="middle" fontSize="9" fill={COLORS.muted}>
          total
        </text>
      </svg>
      <div className="legend">
        {items.map((it, i) => (
          <div className="li" key={it.k}>
            <span
              className="sw"
              style={{ background: colorMap ? colorMap(it.k) || colorFor(i) : colorFor(i) }}
            />
            <span className="lname" title={it.k}>
              {it.k}
            </span>
            <span className="lval">
              {it.v} · {Math.round((it.v / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- vertical column chart ---------- */
export function ColChart({ items }: { items: Item[] }) {
  if (!items.length) return <div className="empty">No data</div>;
  const mx = Math.max(...items.map((i) => i.v), 1);
  return (
    <div className="colchart">
      {items.map((it, i) => (
        <div className="cb" key={`${it.k}-${i}`}>
          <div className="cnum">{it.v || ""}</div>
          <div className="cbar" style={{ height: `${Math.max(2, (it.v / mx) * 100)}px` }} />
          <div className="cx">{it.k}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- score histogram ---------- */
export function Histogram({
  vals,
  lo = 0,
  hi = 30,
  bins = 30,
}: {
  vals: (number | null)[];
  lo?: number;
  hi?: number;
  bins?: number;
}) {
  const clean = vals.filter((v): v is number => v != null && !isNaN(v));
  if (!clean.length) return <div className="empty">No scores</div>;
  const step = (hi - lo) / bins;
  const buck = new Array(bins).fill(0);
  clean.forEach((v) => {
    let i = Math.floor((v - lo) / step);
    i = Math.max(0, Math.min(bins - 1, i));
    buck[i]++;
  });
  const mx = Math.max(...buck, 1);
  return (
    <div className="colchart" style={{ height: 110, gap: 2 }}>
      {buck.map((c, i) => (
        <div className="cb" key={i}>
          <div
            className="cbar"
            style={{ height: `${(c / mx) * 90}px` }}
            title={`${Math.round(lo + i * step)}: ${c}`}
          />
          <div className="cx">{i % 5 === 0 ? Math.round(lo + i * step) : " "}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- gauge with YoY-pace marker ---------- */
function GaugeArc({
  fillFrac,
  markerFrac,
  color,
}: {
  fillFrac: number;
  markerFrac: number | null;
  color: string;
}) {
  const R = 34,
    cx = 42,
    cy = 42,
    C0 = -Math.PI * 1.25,
    C1 = Math.PI * 0.25,
    span = C1 - C0; // 270deg
  const pt = (a: number, rad: number): [number, number] => [
    cx + rad * Math.cos(a),
    cy + rad * Math.sin(a),
  ];
  const arc = (a0: number, a1: number) => {
    const lg = a1 - a0 > Math.PI ? 1 : 0;
    const s = pt(a0, R),
      e = pt(a1, R);
    return `M${s[0]} ${s[1]} A${R} ${R} 0 ${lg} 1 ${e[0]} ${e[1]}`;
  };
  const vEnd = C0 + span * Math.max(0, Math.min(1, fillFrac));
  let marker = null;
  if (markerFrac != null) {
    const a = C0 + span * Math.max(0, Math.min(1, markerFrac));
    const i = pt(a, R - 7),
      o = pt(a, R + 3);
    marker = (
      <line
        x1={i[0]}
        y1={i[1]}
        x2={o[0]}
        y2={o[1]}
        stroke={COLORS.navy}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    );
  }
  return (
    <svg width="84" height="76" viewBox="0 0 84 78">
      <path d={arc(C0, C1)} fill="none" stroke="#e7edf1" strokeWidth="8" strokeLinecap="round" />
      <path d={arc(C0, vEnd)} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
      {marker}
    </svg>
  );
}

export type GaugeVM = {
  key: string;
  name: string;
  col: string;
  value: number;
  fillFrac: number;
  markerFrac: number | null;
  yoy: { up: boolean; pct: number } | null;
  sub: string;
  on: boolean;
  info?: string;
};

/** Hover/focus “i” badge. Reused on gauges and on the pipeline/prospect cards. */
export function InfoTip({
  text,
  wide,
  flip,
}: {
  text: string;
  wide?: boolean;
  flip?: boolean;
}) {
  return (
    <span
      className={`g-info${wide ? " wide" : ""}${flip ? " flip" : ""}`}
      tabIndex={0}
      aria-label={text}
      onClick={(e) => e.stopPropagation()}
    >
      i<span className="g-tip">{text}</span>
    </span>
  );
}

/** Gauge dial. Pass `onSelect` to make it click-to-filter; omit it for a
 * static display dial (e.g. the recruiting KPIs). `g.info` renders an "i"
 * badge whose hover/focus tooltip explains exactly what the number pulls. */
export function Gauge({ g, onSelect }: { g: GaugeVM; onSelect?: (key: string) => void }) {
  return (
    <div
      className={`gauge ${g.on ? "on" : ""} ${onSelect ? "" : "static"}`}
      onClick={onSelect ? () => onSelect(g.key) : undefined}
    >
      {g.info ? <InfoTip text={g.info} /> : null}
      <GaugeArc fillFrac={g.fillFrac} markerFrac={g.markerFrac} color={g.col} />
      <div className="g-name">{g.name}</div>
      <div className="g-val" style={{ color: g.col }}>
        {g.value}
      </div>
      <div className="g-yoy">
        {g.yoy ? (
          <span className={g.yoy.up ? "up" : "down"}>
            {g.yoy.up ? "▲" : "▼"} {g.yoy.pct}% of pace
          </span>
        ) : (
          " "
        )}
      </div>
      <div className="g-sub">{g.sub}</div>
    </div>
  );
}

/* ---------- conversion funnel (bottom of gauge card) ---------- */
export function Funnel({ stages }: { stages: [string, number, string][] }) {
  const mx = Math.max(...stages.map((s) => s[1]), 1);
  return (
    <div className="funnel">
      {stages.map(([label, value, color]) => (
        <div className="fseg" key={label}>
          <div className="fnum" style={{ color }}>
            {value}
          </div>
          <div
            className="fbar"
            style={{ height: `${Math.max(5, (value / mx) * 44)}px`, background: color }}
          />
          <div className="flbl">{label}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- pipeline bottleneck (5-stage funnel, click to filter) ---------- */
export function Bottleneck({
  items,
  active,
  onSelect,
  colorMap,
}: {
  items: Item[];
  active: string;
  onSelect: (k: string) => void;
  colorMap: Record<string, string>;
}) {
  const mx = Math.max(...items.map((i) => i.v), 1);
  return (
    <div className="bottleneck">
      {items.map((it) => {
        const w = Math.max(7, (it.v / mx) * 100);
        const dim = active && active !== it.k ? "dim" : "";
        const on = active === it.k ? "on" : "";
        return (
          <div className={`bnrow ${on} ${dim}`} key={it.k} onClick={() => onSelect(it.k)}>
            <div
              className="bnbar"
              style={{ width: `${w}%`, background: colorMap[it.k] || COLORS.slate }}
            >
              <span className="bnnum">{it.v}</span>
            </div>
            <div className="bnlbl">{it.k}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- activity feed (q5) ---------- */
export type FeedRow = { summary: string; code: string; date: string; user: string; pcid: string };
export function Feed({ rows }: { rows: FeedRow[] }) {
  if (!rows.length) return <div className="empty">No interactions</div>;
  return (
    <div className="feed">
      {rows.map((r, i) => {
        const col = /Cold|Wrong|voicemail|VM/i.test(r.summary) ? COLORS.amber : COLORS.teal;
        return (
          <div className="fi" key={i}>
            <div className="fdot" style={{ background: col }} />
            <div>
              <div>{r.summary || r.code || "—"}</div>
              <div className="fmeta">
                {r.date} · {r.code} · {r.user} · {r.pcid}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
