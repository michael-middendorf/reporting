"use client";

type ColumnProps = {
  labels: string[];
  values: number[];
  formatValue: (n: number) => string;
  formatLabel?: (label: string) => string;
  fill: string;
  hrefFor?: (label: string) => string | null;
};

export function ColumnChart({
  labels,
  values,
  formatValue,
  formatLabel = (l) => l,
  fill,
  hrefFor,
}: ColumnProps) {
  const width = 720;
  const height = 244;
  const padding = { top: 16, right: 18, bottom: 52, left: 18 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...values);
  const barWidth = innerWidth / Math.max(1, values.length);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" style={{ width: "100%", height: "auto" }}>
      {[0, 0.5, 1].map((ratio) => {
        const y = padding.top + innerHeight - innerHeight * ratio;
        return (
          <line
            key={ratio}
            x1={padding.left}
            x2={width - padding.right}
            y1={y}
            y2={y}
            stroke="rgba(23,38,31,0.1)"
            strokeWidth={1}
          />
        );
      })}
      {values.map((value, index) => {
        const barHeight = (value / maxValue) * innerHeight;
        const x = padding.left + index * barWidth + 3;
        const y = padding.top + innerHeight - barHeight;
        const rect = (
          <rect
            x={x}
            y={y}
            width={Math.max(barWidth - 6, 4)}
            height={barHeight}
            rx={6}
            fill={fill}
          />
        );
        const href = hrefFor?.(labels[index]) || null;
        return (
          <g key={`${labels[index]}-${index}`}>
            {href && value ? <a href={href}>{rect}</a> : rect}
            <text
              x={padding.left + index * barWidth + barWidth / 2}
              y={height - 10}
              textAnchor="middle"
              fontSize={11}
              fill="#55665a"
            >
              {formatLabel(labels[index])}
            </text>
          </g>
        );
      })}
      <text
        x={width - padding.right}
        y={padding.top + 4}
        textAnchor="end"
        fontSize={12}
        fill="#17261f"
      >
        {formatValue(maxValue)}
      </text>
    </svg>
  );
}

type HBarProps = {
  labels: string[];
  values: number[];
  formatValue: (n: number) => string;
  hrefFor?: (label: string) => string | null;
};

export function HorizontalBarChart({ labels, values, formatValue, hrefFor }: HBarProps) {
  const longest = labels.reduce((m, l) => Math.max(m, String(l).length), 0);
  const padding = {
    top: 16,
    right: 108,
    bottom: 12,
    left: Math.max(220, longest * 7 + 28),
  };
  const width = Math.max(780, padding.left + padding.right + 340);
  const rowHeight = 28;
  const height = Math.max(180, labels.length * rowHeight + padding.top + padding.bottom);
  const innerWidth = width - padding.left - padding.right;
  const maxValue = Math.max(1, ...values);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" style={{ width: "100%", height: "auto" }}>
      {labels.map((label, index) => {
        const y = padding.top + index * rowHeight;
        const barW = (values[index] / maxValue) * innerWidth;
        const content = (
          <>
            <text x={padding.left - 10} y={y + 14} textAnchor="end" fontSize={11} fill="#17261f">
              {label}
            </text>
            <rect
              x={padding.left}
              y={y}
              width={barW}
              height={18}
              rx={8}
              fill="rgba(214, 122, 81, 0.82)"
            />
            <text
              x={padding.left + Math.max(barW + 8, 8)}
              y={y + 14}
              fontSize={11}
              fill="#55665a"
            >
              {formatValue(values[index])}
            </text>
          </>
        );
        const href = hrefFor?.(label) || null;
        return (
          <g key={`${label}-${index}`}>
            {href && values[index] ? <a href={href}>{content}</a> : content}
          </g>
        );
      })}
    </svg>
  );
}
