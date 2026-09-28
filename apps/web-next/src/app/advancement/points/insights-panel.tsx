"use client";

type Cell = { gifts: number; amount: number; rate: number | null };
type Best = { id: string; label: string; amount: number; gifts: number; share: number; rate: number | null };
type Group = {
  id: string;
  label: string;
  detail: string;
  donors: number;
  gifts: number;
  amount: number;
  avg: number;
  best: Best | null;
  cells: Record<string, Cell>;
};
type Channel = { id: string; label: string; short: string };
export type InsightsModel = {
  donors: number;
  findings: string[];
  knownRelationship: number;
  generations: Group[];
  relationships: Group[];
  donorTags: Group[];
  generationChannels: Channel[];
  relationshipChannels: Channel[];
};

const money = (n: number | undefined) => `$${Math.round(n || 0).toLocaleString("en-US")}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);

function SummaryTable({ groups }: { groups: Group[] }) {
  return (
    <div className="week-scroll">
    <table className="grid">
      <thead>
        <tr>
          <th>Group</th>
          <th>Donors</th>
          <th>Gifts</th>
          <th>Raised</th>
          <th>Avg gift</th>
          <th>Best contact</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.id}>
            <td>
              {group.label}
              {group.detail ? <div className="section-hint">{group.detail}</div> : null}
            </td>
            <td className="tabular">{group.donors}</td>
            <td className="tabular">{group.gifts}</td>
            <td className="pts tabular">{money(group.amount)}</td>
            <td className="tabular">{money(group.avg)}</td>
            <td>
              {group.best ? (
                <>
                  {group.best.label}
                  <div className="section-hint">
                    {money(group.best.amount)} · {pct(group.best.share)} of this row
                    {group.best.rate != null ? ` · ${pct(group.best.rate)} of people reached this way gave` : ""}
                  </div>
                </>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function Matrix({ groups, channels }: { groups: Group[]; channels: Channel[] }) {
  if (!groups.length || !channels.length) return null;
  return (
    <div className="week-scroll">
      <table className="grid insight-matrix">
        <thead>
          <tr>
            <th>Group</th>
            {channels.map((channel) => (
              <th key={channel.id} title={channel.label}>{channel.short}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.id}>
              <td>{group.label}</td>
              {channels.map((channel) => {
                const cell = group.cells[channel.id];
                const best = group.best?.id === channel.id && (cell?.gifts || 0) > 0;
                return (
                  <td key={channel.id} className={best ? "insight-best tabular" : "tabular"}>
                    {cell?.gifts ? money(cell.amount) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InsightsPanel({ insights }: { insights: InsightsModel }) {
  return (
    <section className="section" aria-labelledby="insights-heading">
      <h2 id="insights-heading">
        Insights <span className="section-hint">who gave, and which contact came before the gift</span>
      </h2>
      <div className="panel">
        <ul className="insight-findings">
          {insights.findings.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="footnote" style={{ marginTop: 0 }}>
          Same dates as the Points tab. Dollars match Raised. Age is the birth year of the primary person on the Virtuous contact.
          A donor can be alumni and a parent, so relationship rows overlap and will not add up to the donor count.
          Best contact is the outreach type tied to the most dollars in that row.
          The percent of people reached counts notes logged in these dates.
          {insights.knownRelationship === 0 && insights.donors > 0
            ? " University relationship is missing on every donor in this range."
            : ""}
        </p>

        {insights.generations.length > 0 ? (
          <>
            <h3 className="insight-head">Age</h3>
            <SummaryTable groups={insights.generations} />
            <h3 className="insight-head">Dollars by generation and contact type</h3>
            <Matrix groups={insights.generations} channels={insights.generationChannels} />
          </>
        ) : null}

        {insights.relationships.length > 0 ? (
          <>
            <h3 className="insight-head">Relationship to the university</h3>
            <SummaryTable groups={insights.relationships} />
            <h3 className="insight-head">Dollars by relationship and contact type</h3>
            <Matrix groups={insights.relationships} channels={insights.relationshipChannels} />
          </>
        ) : null}

        {insights.donorTags.length > 0 ? (
          <>
            <h3 className="insight-head">Giving history</h3>
            <SummaryTable groups={insights.donorTags} />
          </>
        ) : null}
      </div>
    </section>
  );
}
