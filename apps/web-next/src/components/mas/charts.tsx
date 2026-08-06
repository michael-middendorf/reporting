"use client";

/** Simple SVG column chart with optional bar click links. */
export function ColumnChart({
  labels,
  values,
  hrefForIndex,
  color = "rgba(180, 83, 45, 0.86)",
  formatValue,
  height = 160,
}: {
  labels: string[];
  values: number[];
  hrefForIndex?: (i: number, label: string) => string | undefined;
  color?: string;
  formatValue?: (n: number) => string;
  height?: number;
}) {
  const peak = Math.max(1, ...values.map((v) => Number(v) || 0));
  const n = Math.max(labels.length, 1);
  const gap = 4;
  const barW = Math.max(8, Math.floor((640 - gap * (n + 1)) / n));
  const width = gap + n * (barW + gap);
  const fmt = formatValue || ((x: number) => String(Math.round(x)));

  return (
    <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid #e0d4c0", padding: 12 }}>
      <svg viewBox={`0 0 ${width} ${height + 36}`} width="100%" style={{ minWidth: Math.min(width, 640), maxWidth: 900 }}>
        {values.map((v, i) => {
          const h = ((Number(v) || 0) / peak) * height;
          const x = gap + i * (barW + gap);
          const y = height - h;
          const label = String(labels[i] || "").slice(0, 7);
          const href = hrefForIndex?.(i, String(labels[i] || ""));
          const bar = (
            <g key={i}>
              <title>{`${label}: ${fmt(Number(v) || 0)}`}</title>
              <rect x={x} y={y} width={barW} height={Math.max(h, 1)} fill={color} rx={2} />
              <text x={x + barW / 2} y={height + 14} textAnchor="middle" fontSize={9} fill="#6b5a4a">
                {label.slice(5) || label}
              </text>
            </g>
          );
          return href ? (
            <a key={i} href={href} style={{ cursor: "pointer" }}>
              {bar}
            </a>
          ) : (
            bar
          );
        })}
      </svg>
    </div>
  );
}

export function summaryCardHref(cardId: string, label: string) {
  const encode = (spec: Record<string, unknown>) =>
    `/mas/drilldown?spec=${encodeURIComponent(JSON.stringify(spec))}`;

  if (cardId === "ma_outreach_notes") {
    return encode({ title: "All Outreach Notes", view: "engagements", predicates: [] });
  }
  if (cardId === "two_way_engagements") {
    return encode({
      title: "Two-Way Engagements",
      view: "engagements",
      predicates: [{ kind: "eq", key: "engagement_bucket", value: "Two-way engagement" }],
    });
  }
  if (cardId === "one_way_outreach") {
    return encode({
      title: "One-Way Outreach",
      view: "engagements",
      predicates: [{ kind: "eq", key: "engagement_bucket", value: "One-way outreach" }],
    });
  }
  if (cardId === "failed_contacts") {
    return encode({
      title: "Failed Contacts",
      view: "engagements",
      predicates: [{ kind: "eq", key: "engagement_bucket", value: "Failed / unreachable" }],
    });
  }
  const windowMatch = cardId.match(/_(30|90|365)$/);
  if (windowMatch) {
    return encode({
      title: `Follow-On Donors ${windowMatch[1]}`,
      view: "donors",
      predicates: [
        { kind: "eq", key: `in_window_${windowMatch[1]}`, value: true },
        { kind: "eq", key: "linked_engagement_bucket", value: "Two-way engagement" },
      ],
    });
  }
  return encode({ title: label || "All Outreach Notes", view: "engagements", predicates: [] });
}

export function matchesPredicate(
  row: Record<string, unknown>,
  p: { kind: string; key: string; value: unknown },
) {
  const cell = row[p.key];
  if (p.kind === "eq") return cell === p.value || String(cell) === String(p.value);
  if (p.kind === "prefix") return String(cell ?? "").startsWith(String(p.value ?? ""));
  if (p.kind === "truthy") return Boolean(cell);
  return true;
}
