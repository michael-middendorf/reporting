"use client";

function FlowBox({
  x, y, w, h, title, lines, tone,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines?: string[];
  tone: "start" | "count" | "raised" | "review" | "stop";
}) {
  const textStart = lines && lines.length ? y + 24 : y + h / 2 + 4;
  return (
    <g className={`flow-box flow-box-${tone}`}>
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <text x={x + 14} y={textStart}>
        <tspan className="flow-box-title" x={x + 14} dy={0}>{title}</tspan>
        {(lines || []).map((line) => (
          <tspan key={line} className="flow-box-line" x={x + 14} dy={16}>{line}</tspan>
        ))}
      </text>
    </g>
  );
}

function FlowDiamond({ cx, cy, lines }: { cx: number; cy: number; lines: string[] }) {
  const w = 340;
  const h = 104;
  const points = `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`;
  const start = cy - ((lines.length - 1) * 15) / 2 + 4;
  return (
    <g className="flow-diamond">
      <polygon points={points} />
      <text x={cx} y={start} textAnchor="middle">
        {lines.map((line, i) => (
          <tspan key={line} x={cx} dy={i === 0 ? 0 : 16}>{line}</tspan>
        ))}
      </text>
    </g>
  );
}

function FlowEdge({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g className="flow-edge">
      <path d={d} />
      {label && lx != null && ly != null ? <text x={lx} y={ly}>{label}</text> : null}
    </g>
  );
}

export function GiftFlowGraph() {
  return (
    <div className="gift-graph-scroll">
      <svg className="gift-graph" viewBox="0 0 980 1080" role="img" aria-labelledby="gift-flow-title gift-flow-desc">
        <title id="gift-flow-title">How a posted gift is recorded</title>
        <desc id="gift-flow-desc">
          A gift follows the checks in order. Same monthly amount stops. A higher monthly gift counts only the increase over the recent monthly amount, including a monthly gift cancelled within 45 days. A gala ticket purchase with a conversation on or before the gift is Raised. An MGO-coded gift counts when the donor is on that MA’s portfolio, and is not counted otherwise. A New Donation note within 90 days is Raised, including a note logged after the gift posts. Any other contact on or before the gift within 90 days is Raised. Otherwise the gift is not attributed.
        </desc>
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 0 1 L 9 5 L 0 9 z" />
          </marker>
        </defs>

        <FlowEdge d="M230 68 L230 108" />
        <FlowEdge d="M400 160 L468 160" label="Yes" lx={418} ly={152} />
        <FlowEdge d="M230 212 L230 236" label="No" lx={240} ly={230} />
        <FlowEdge d="M230 308 L230 338" />
        <FlowEdge d="M400 390 L468 390" label="Yes" lx={418} ly={382} />
        <FlowEdge d="M230 442 L230 498" label="No" lx={240} ly={474} />
        <FlowEdge d="M400 550 L468 550" label="Yes" lx={418} ly={542} />
        <FlowEdge d="M230 602 L230 668" label="No" lx={240} ly={640} />
        <FlowEdge d="M400 720 L468 720" label="Yes" lx={418} ly={712} />
        <FlowEdge d="M230 772 L230 838" label="No" lx={240} ly={810} />
        <FlowEdge d="M400 890 L468 890" label="Yes" lx={418} ly={882} />
        <FlowEdge d="M230 942 L230 988" label="No" lx={240} ly={970} />

        <FlowBox x={60} y={16} w={340} h={52} tone="start" title="Gift posts in Virtuous" />
        <FlowDiamond cx={230} cy={160} lines={["Same monthly amount", "as the monthly gift", "they were already giving?"]} />
        <FlowBox x={468} y={128} w={470} h={64} tone="stop" title="Not recorded again" lines={["A continuing monthly payment is not a new gift."]} />
        <FlowBox x={60} y={236} w={340} h={72} tone="count" title="Count the new dollars" lines={["One-time as posted. New monthly × 12.", "Increase is (new − prior) × 12."]} />
        <FlowDiamond cx={230} cy={390} lines={["Gala tickets, and an MA", "spoke within 90 days?"]} />
        <FlowBox x={468} y={358} w={470} h={64} tone="raised" title="Raised · gala tickets" lines={["Dollars and 100 points for the MA who spoke."]} />
        <FlowDiamond cx={230} cy={550} lines={["MGO coded, or the", "solicitor is not an MA?"]} />
        <FlowBox x={468} y={502} w={470} h={64} tone="raised" title="Raised · MA portfolio" lines={["The donor is on that officer’s portfolio."]} />
        <FlowBox x={468} y={574} w={470} h={56} tone="stop" title="Not on a portfolio" lines={["The gift is not counted."]} />
        <FlowDiamond cx={230} cy={720} lines={["New Donation note within", "90 days, even if logged", "after the gift posted?"]} />
        <FlowBox x={468} y={688} w={470} h={64} tone="raised" title="Raised · donation note" lines={["Dollars and 100 points for the MA who logged it."]} />
        <FlowDiamond cx={230} cy={890} lines={["Any contact on or before", "the gift, within 90 days?"]} />
        <FlowBox x={468} y={858} w={470} h={64} tone="raised" title="Raised · that contact" lines={["A note after the gift date does not count."]} />
        <FlowBox x={60} y={988} w={340} h={64} tone="stop" title="Not attributed" lines={["The gift stays off the MA’s Raised total."]} />
      </svg>
    </div>
  );
}

